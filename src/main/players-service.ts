import type Database from "better-sqlite3";

import type { Player } from "../shared/models";
import type { repository } from "./repository";
import { getUserSessionClient, getSessionUserId, isNetworkErrorMessage } from "./supabase";

/**
 * ============================================================================
 * ETAPA 2 — Serviço de "players": Supabase como fonte de verdade + espelho
 * local no SQLite.
 * ============================================================================
 * Decisões de projeto (aprovadas pelo usuário):
 *  - Autenticação: sessão do usuário; autorização remota pelas políticas RLS.
 *  - Fallback: LEITURAS caem para o espelho SQLite quando o Supabase está
 *    indisponível; ESCRITAS/exclusões exigem Supabase (sem divergência).
 *  - Sem sessão, escritas são recusadas; leituras podem usar o espelho local.
 *  - O espelho local mantém os MESMOS ids do Supabase, preservando as FKs e
 *    JOINs de matches/fixtures/championship_participants/ranking/dashboard,
 *    que continuam 100% SQLite nesta etapa.
 *  - O schema SQLite de players NÃO foi alterado (fica como está para
 *    rollback futuro). repository.ts permanece intocado.
 *
 * As assinaturas expostas via IPC/preload continuam idênticas:
 *  list() -> Player[] | save(Partial<Player>) -> Player | remove(id) -> void
 */

type Repository = ReturnType<typeof repository>;

/** Linha de public.players no Supabase (snake_case). */
type SupabasePlayerRow = {
  id: number | string;
  room_id?: string | null;
  name: string;
  nickname: string;
  avatar: string | null;
  created_at?: string | null;
};

/** Erro devolvido pelo PostgREST (supabase-js). */
type PostgrestErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const LOG_PREFIX = "[players]";
const PLAYER_COLUMNS = "id,room_id,name,nickname,avatar,created_at";

export type PlayersService = {
  /** Lista jogadores (Supabase quando disponível; espelho local como fallback). */
  list(): Promise<Player[]>;
  /** Cria/edita jogador no Supabase e sincroniza o espelho local. */
  save(player: Partial<Player>, requestedRoomId?: string | null): Promise<Player>;
  /** Exclui jogador no Supabase (com cascata local de partidas/confrontos). */
  remove(id: number): Promise<void>;
  /** Sincroniza o espelho local a partir do Supabase (boot). Retorna nº de linhas. */
  syncMirror(roomId: string | null): Promise<number>;
};

/** Normaliza timestamps para o mesmo formato usado pelo SQLite (UTC "YYYY-MM-DD HH:MM:SS"). */
function normalizeTs(value: unknown): string {
  const fallback = () => new Date().toISOString().slice(0, 19).replace("T", " ");
  if (typeof value !== "string" || !value) return fallback();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 19);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().slice(0, 19).replace("T", " ");
}

/** Converte a linha Supabase para o tipo Player já usado pelo renderer. */
function mapPlayer(row: SupabasePlayerRow): Player {
  // avatar: o SQLite devolve `null` para sem-avatar desde sempre; mantemos o
  // mesmo formato para não mudar nada para o renderer.
  return {
    id: Number(row.id),
    name: row.name,
    nickname: row.nickname,
    avatar: row.avatar ?? null,
    createdAt: normalizeTs(row.created_at),
  } as Player;
}

function isPostgrestErrorLike(err: unknown): err is PostgrestErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

/** Converte erros do Supabase em mensagens amigáveis (PT-BR) para a UI. */
function toFriendlyError(err: unknown): Error {
  if (err instanceof Error) {
    if (isNetworkErrorMessage(err.message)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return err.message === "Sua sessão expirou. Entre novamente para continuar."
      ? err : new Error("Não foi possível concluir a operação. Tente novamente.");
  }
  if (isPostgrestErrorLike(err)) {
    const code = err.code || "";
    const text = `${err.message} ${err.details ?? ""}`;
    if (code === "23505" && /nickname/i.test(text)) {
      return new Error("Já existe um jogador com esse apelido.");
    }
    if (code === "23505") {
      return new Error("Registro duplicado no Supabase.");
    }
    if (code === "PGRST205") {
      return new Error(
        "A tabela public.players não existe no projeto Supabase. " +
          "Aplique a migration supabase/migrations/20260827160000_initial_schema.sql no SQL Editor.",
      );
    }
    if (code === "PGRST301") {
      return new Error(
        "Sua sessão expirou. Entre novamente para continuar.",
      );
    }
    if (code === "42501" || /row-level security/i.test(err.message)) {
      return new Error(
        "Você não tem permissão para realizar esta ação.",
      );
    }
    if (code === "23503") {
      return new Error("Não foi possível concluir a operação porque existem registros vinculados.");
    }
    if (isNetworkErrorMessage(err.message)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return new Error("Não foi possível concluir a operação. Tente novamente.");
  }
  return new Error("Não foi possível concluir a operação. Tente novamente.");
}

export function createPlayersService(
  db: Database.Database,
  repo: Repository,
  roomId: string | null = null,
): PlayersService {
  // ---------------------------------------------------------------------------
  // Espelho local (SQLite): mesmos ids do Supabase. O schema de players NÃO foi
  // alterado; apenas escrevemos nas colunas que já existem.
  // ---------------------------------------------------------------------------
  const mirrorUpsert = db.prepare(`
    INSERT INTO players(id,room_id,name,nickname,avatar,created_at)
    VALUES (@id,@room_id,@name,@nickname,@avatar,@created_at)
    ON CONFLICT(id) DO UPDATE SET
      room_id=excluded.room_id,
      name=excluded.name,
      nickname=excluded.nickname,
      avatar=excluded.avatar
  `);
  const driftDelete = db.prepare(
    "DELETE FROM players WHERE nickname=@nickname AND id<>@id",
  );
  const driftRename = db.prepare(
    "UPDATE players SET nickname=nickname || '~local' || id WHERE nickname=@nickname AND id<>@id",
  );

  /**
   * Espelha uma linha vinda do Supabase. Se existir linha local antiga com o
   * mesmo apelido e outro id (drift pré-migração), tenta removê-la; se ela
   * estiver referenciada por matches/fixtures (FK RESTRICT), apenas renomeia o
   * apelido local para liberar o UNIQUE sem perder o histórico.
   * Deve rodar dentro de uma transação do chamador.
   */
  function mirrorUpsertRow(row: SupabasePlayerRow) {
    const values = {
      id: Number(row.id),
      room_id: row.room_id ?? null,
      name: row.name,
      nickname: row.nickname,
      avatar: row.avatar ?? null,
      created_at: normalizeTs(row.created_at),
    };
    try {
      driftDelete.run({ nickname: values.nickname, id: values.id });
    } catch {
      driftRename.run({ nickname: values.nickname, id: values.id });
    }
    mirrorUpsert.run(values);
  }

  const mirrorOne = (row: SupabasePlayerRow) => {
    db.transaction(() => mirrorUpsertRow(row))();
  };

  /** Executa uma consulta e converte falhas em mensagens amigáveis. */
  async function execWithAuthRetry<T>(
    make: () => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const { data, error } = await make();
      if (error) throw error;
      return data as T;
    };
    try {
      return await run();
    } catch (err) {
      throw toFriendlyError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // API pública (mesmas assinaturas dos handlers IPC existentes)
  // ---------------------------------------------------------------------------

  async function list(): Promise<Player[]> {
    try {
      const supabase = await getUserSessionClient();
      // Uma falha de sessão ou rede permite leitura pelo espelho local.
      const rows = await execWithAuthRetry<SupabasePlayerRow[]>(() =>
        supabase
          .from("players")
          .select(PLAYER_COLUMNS)
          .order("name", { ascending: true }),
      );
      return (rows ?? []).map(mapPlayer);
    } catch (err) {
      // Fallback gracioso de LEITURA: espelho local.
      console.warn(
        `${LOG_PREFIX} Supabase indisponível para leitura — usando espelho local SQLite.`,
        err instanceof Error ? err.message : err,
      );
      return repo.players();
    }
  }

  async function save(player: Partial<Player>, requestedRoomId = roomId): Promise<Player> {
    if (requestedRoomId !== roomId) throw new Error("A sala selecionada foi alterada. Tente novamente.");
    const targetRoomId = requestedRoomId ?? null;
    const name = player.name?.trim();
    const nickname = player.nickname?.trim();
    if (!name || !nickname) {
      // Mesma validação/mensagem do repository (paridade de comportamento).
      throw new Error("Nome e apelido são obrigatórios.");
    }

    const supabase = await getUserSessionClient();
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    if (targetRoomId !== null) {
      const { data: role, error } = await supabase.rpc("room_member_role", { p_room_id: targetRoomId });
      if (error || (role !== "owner" && role !== "admin")) {
        throw new Error("Você não tem permissão para realizar esta ação.");
      }
    }

    const payload = { name, nickname, avatar: player.avatar ?? null };

    const result = player.id
      ? await execWithAuthRetry<SupabasePlayerRow[] | SupabasePlayerRow>(() => {
          const query = supabase.from("players").update(payload).eq("id", player.id as number);
          return (targetRoomId === null ? query.is("room_id", null) : query.eq("room_id", targetRoomId)).select(PLAYER_COLUMNS);
        })
      : await execWithAuthRetry<SupabasePlayerRow[] | SupabasePlayerRow>(() =>
          supabase.from("players").insert({ ...payload, room_id: targetRoomId, created_by: userId }).select(PLAYER_COLUMNS),
        );

    // Defensivo: o PostgREST responde array, mas normalizamos por segurança.
    const rows = Array.isArray(result) ? result : result ? [result] : [];

    if (rows.length === 0) {
      throw new Error(
        player.id ? "Jogador não encontrado." : "Não foi possível salvar o jogador.",
      );
    }

    const row = rows[0];
    mirrorOne(row); // mantém FKs/JOINs locais íntegros com o mesmo id
    return mapPlayer(row);
  }

  async function remove(id: number): Promise<void> {
    const supabase = await getUserSessionClient();
    if (roomId !== null) {
      const { data: role, error } = await supabase.rpc("room_member_role", { p_room_id: roomId });
      if (error || (role !== "owner" && role !== "admin")) {
        throw new Error("Você não tem permissão para realizar esta ação.");
      }
    }

    // Cascata remota: no schema Supabase, matches/fixtures referenciam players
    // com ON DELETE RESTRICT (assim como a UI local avisa que partidas e
    // participações serão removidas). championship_participants ainda não
    // existe no Supabase (championships continuam 100% SQLite nesta etapa).
    await execWithAuthRetry<Array<{ id: number }>>(() => {
      const query = supabase.from("matches").delete().or(`player1_id.eq.${id},player2_id.eq.${id}`);
      return (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId)).select("id");
    });
    await execWithAuthRetry<Array<{ id: number }>>(() => {
      const query = supabase.from("fixtures").delete().or(`player1_id.eq.${id},player2_id.eq.${id}`);
      return (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId)).select("id");
    });

    const deleted = await execWithAuthRetry<SupabasePlayerRow[]>(() => {
      const query = supabase.from("players").delete().eq("id", id);
      return (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId)).select("id");
    });
    if (!deleted || deleted.length === 0) {
      throw new Error("Jogador não encontrado ou sem permissão para excluí-lo.");
    }

    // Cascata local (idêntica à atual): remove matches, fixtures,
    // participações e o jogador do espelho. Lança "Jogador não encontrado."
    // se não existir localmente — mesma UX de hoje.
    repo.deletePlayer(id);
  }

  async function syncMirror(roomId: string | null): Promise<number> {
    const supabase = await getUserSessionClient();

    let rows: SupabasePlayerRow[];
    try {
      const query = supabase
        .from("players")
        .select(PLAYER_COLUMNS);
      const { data, error } = await (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId))
        .order("id", { ascending: true });
      if (error) throw error;
      rows = (data ?? []) as SupabasePlayerRow[];
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível sincronizar o espelho local:`,
        err instanceof Error ? err.message : err,
      );
      if (roomId !== null) throw new Error("Não foi possível sincronizar os jogadores da sala.");
      return 0;
    }

    if (rows.length === 0) return 0;

    const apply = db.transaction(() => {
      for (const row of rows) mirrorUpsertRow(row);
      return rows.length;
    });
    const count = apply();
    console.info(`${LOG_PREFIX} espelho local sincronizado com o Supabase: ${count} jogador(es).`);
    return count;
  }

  return { list, save, remove, syncMirror };
}
