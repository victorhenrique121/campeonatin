import type Database from "better-sqlite3";

import type { Player } from "../shared/models";
import type { repository } from "./repository";
import { ensureAuthenticated, getSupabase, isNetworkErrorMessage } from "./supabase";

/**
 * ============================================================================
 * ETAPA 2 — Serviço de "players": Supabase como fonte de verdade + espelho
 * local no SQLite.
 * ============================================================================
 * Decisões de projeto (aprovadas pelo usuário):
 *  - Autenticação: conta de serviço do app via Supabase Auth (RLS exige o
 *    papel 'authenticated'; escrita exige profile 'admin').
 *  - Fallback: LEITURAS caem para o espelho SQLite quando o Supabase está
 *    indisponível; ESCRITAS/exclusões exigem Supabase (sem divergência).
 *  - Sem .env configurado: modo legado 100% SQLite (repository), idêntico ao
 *    comportamento anterior à Etapa 2.
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
const PLAYER_COLUMNS = "id,name,nickname,avatar,created_at";

export type PlayersService = {
  /** Lista jogadores (Supabase quando disponível; espelho local como fallback). */
  list(): Promise<Player[]>;
  /** Cria/edita jogador no Supabase e sincroniza o espelho local. */
  save(player: Partial<Player>): Promise<Player>;
  /** Exclui jogador no Supabase (com cascata local de partidas/confrontos). */
  remove(id: number): Promise<void>;
  /** Sincroniza o espelho local a partir do Supabase (boot). Retorna nº de linhas. */
  syncMirror(): Promise<number>;
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
    return err;
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
        "Sessão recusada pelo Supabase. Verifique as credenciais da conta de serviço (SUPABASE_APP_EMAIL/SUPABASE_APP_PASSWORD) no .env.",
      );
    }
    if (code === "42501" || /row-level security/i.test(err.message)) {
      return new Error(
        "Permissão negada pelo Supabase (RLS). Confirme que o profile da conta de serviço tem papel 'admin' (veja supabase/SETUP.md).",
      );
    }
    if (code === "23503") {
      return new Error(`Operação bloqueada por vínculos no Supabase: ${err.message}`);
    }
    if (isNetworkErrorMessage(err.message)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return new Error(`Erro no Supabase: ${err.message}${code ? ` (código ${code})` : ""}`);
  }
  return new Error(`Erro inesperado ao acessar o Supabase: ${String(err)}`);
}

function isAuthRejection(err: unknown): boolean {
  return isPostgrestErrorLike(err) && (err.code === "PGRST301" || err.code === "401");
}

export function createPlayersService(
  db: Database.Database,
  repo: Repository,
): PlayersService {
  // ---------------------------------------------------------------------------
  // Espelho local (SQLite): mesmos ids do Supabase. O schema de players NÃO foi
  // alterado; apenas escrevemos nas colunas que já existem.
  // ---------------------------------------------------------------------------
  const mirrorUpsert = db.prepare(`
    INSERT INTO players(id,name,nickname,avatar,created_at)
    VALUES (@id,@name,@nickname,@avatar,@created_at)
    ON CONFLICT(id) DO UPDATE SET
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

  /** Garante sessão autenticada; lança erro amigável quando impossível. */
  async function requireAuth(): Promise<void> {
    const auth = await ensureAuthenticated();
    if (!auth.ok) throw new Error(auth.message);
  }

  /**
   * Executa uma consulta Supabase com retry único: se a sessão for recusada
   * (token expirado/revogado), força novo login e tenta outra vez.
   * `make` precisa criar um builder NOVO a cada tentativa (builders são de uso único).
   */
  async function execWithAuthRetry<T>(
    make: () => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>,
  ): Promise<T> {
    await requireAuth();
    const run = async (): Promise<T> => {
      const { data, error } = await make();
      if (error) throw error;
      return data as T;
    };
    try {
      return await run();
    } catch (err) {
      if (isAuthRejection(err)) {
        const reauth = await ensureAuthenticated({ force: true });
        if (!reauth.ok) throw new Error(reauth.message);
        try {
          return await run();
        } catch (retryErr) {
          throw toFriendlyError(retryErr);
        }
      }
      throw toFriendlyError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // API pública (mesmas assinaturas dos handlers IPC existentes)
  // ---------------------------------------------------------------------------

  async function list(): Promise<Player[]> {
    const supabase = getSupabase();
    if (!supabase) return repo.players(); // modo legado: 100% SQLite

    try {
      // requireAuth acontece dentro de execWithAuthRetry; qualquer falha de
      // rede/credencial cai no fallback gracioso de leitura (espelho local).
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

  async function save(player: Partial<Player>): Promise<Player> {
    const name = player.name?.trim();
    const nickname = player.nickname?.trim();
    if (!name || !nickname) {
      // Mesma validação/mensagem do repository (paridade de comportamento).
      throw new Error("Nome e apelido são obrigatórios.");
    }

    const supabase = getSupabase();
    if (!supabase) return repo.savePlayer({ ...player, name, nickname }); // modo legado

    const payload = { name, nickname, avatar: player.avatar ?? null };

    const result = player.id
      ? await execWithAuthRetry<SupabasePlayerRow[] | SupabasePlayerRow>(() =>
          supabase
            .from("players")
            .update(payload)
            .eq("id", player.id as number)
            .select(PLAYER_COLUMNS),
        )
      : await execWithAuthRetry<SupabasePlayerRow[] | SupabasePlayerRow>(() =>
          supabase.from("players").insert(payload).select(PLAYER_COLUMNS),
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
    const supabase = getSupabase();
    if (!supabase) {
      repo.deletePlayer(id); // modo legado: cascata local, como antes
      return;
    }

    // Cascata remota: no schema Supabase, matches/fixtures referenciam players
    // com ON DELETE RESTRICT (assim como a UI local avisa que partidas e
    // participações serão removidas). championship_participants ainda não
    // existe no Supabase (championships continuam 100% SQLite nesta etapa).
    await execWithAuthRetry<Array<{ id: number }>>(() =>
      supabase.from("matches").delete().or(`player1_id.eq.${id},player2_id.eq.${id}`).select("id"),
    );
    await execWithAuthRetry<Array<{ id: number }>>(() =>
      supabase.from("fixtures").delete().or(`player1_id.eq.${id},player2_id.eq.${id}`).select("id"),
    );

    const deleted = await execWithAuthRetry<SupabasePlayerRow[]>(() =>
      supabase.from("players").delete().eq("id", id).select("id"),
    );
    if (!deleted || deleted.length === 0) {
      console.warn(
        `${LOG_PREFIX} Supabase não retornou linhas ao excluir id=${id} (pode já não existir remotamente). Seguindo com a exclusão local.`,
      );
    }

    // Cascata local (idêntica à atual): remove matches, fixtures,
    // participações e o jogador do espelho. Lança "Jogador não encontrado."
    // se não existir localmente — mesma UX de hoje.
    repo.deletePlayer(id);
  }

  async function syncMirror(): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return 0; // modo legado: espelho É o banco, nada a sincronizar

    const auth = await ensureAuthenticated();
    if (!auth.ok) return 0; // boot: teste de conexão já logou o motivo

    let rows: SupabasePlayerRow[];
    try {
      const { data, error } = await supabase
        .from("players")
        .select(PLAYER_COLUMNS)
        .order("id", { ascending: true });
      if (error) throw error;
      rows = (data ?? []) as SupabasePlayerRow[];
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível sincronizar o espelho local:`,
        err instanceof Error ? err.message : err,
      );
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
