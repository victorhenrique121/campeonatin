import type Database from "better-sqlite3";

import type { MatchInput } from "../shared/models";
import type { repository } from "./repository";
import {
  ensureAuthenticated,
  getSupabase,
  isNetworkErrorMessage,
} from "./supabase";

type Repository = ReturnType<typeof repository>;

/** Linha de public.matches no Supabase (snake_case). */
type SupabaseMatchRow = {
  id: number | string;
  player1_id: number | string;
  player2_id: number | string;
  team1_id: number | string;
  team2_id: number | string;
  score1: number;
  score2: number;
  championship_id: number | string | null;
  played_at: string | null;
  created_by?: string | null;
};

/** Erro devolvido pelo PostgREST (supabase-js). */
type PostgrestErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

const LOG_PREFIX = "[matches]";
const MATCH_COLUMNS =
  "id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at";

export type MatchesService = {
  /** Registra partida: Supabase primeiro (id remoto) + transação local intacta. */
  save(match: MatchInput): Promise<number>;
  /** Edita partida: Supabase primeiro + atualização local. */
  update(match: MatchInput & { id: number }): Promise<number>;
  /** Exclui partida no Supabase e no SQLite (fixtures.match_id -> NULL). */
  remove(id: number): Promise<void>;
  /** Limpeza em massa LOCAL-ONLY. */
  clear(): void;
  /** Sincroniza o espelho local a partir do Supabase (boot). Retorna nº de linhas. */
  syncMirror(): Promise<number>;
};

function normalizePlayedAt(value: unknown): string {
  const fallback = () => new Date().toISOString();
  if (typeof value !== "string" || !value) return fallback();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isPostgrestErrorLike(err: unknown): err is PostgrestErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  );
}

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
    if (code === "PGRST205") {
      return new Error(
        "A tabela public.matches não existe no projeto Supabase.",
      );
    }
    if (code === "PGRST301") {
      return new Error(
        "Sessão recusada pelo Supabase. Verifique as credenciais da conta de serviço no .env.",
      );
    }
    if (code === "42501" || /row-level security/i.test(err.message)) {
      return new Error(
        "Permissão negada pelo Supabase (RLS). Confirme as permissões de acesso.",
      );
    }
    if (code === "23514") {
      return new Error(
        "Dados da partida recusados pelo Supabase (placar negativo ou jogadores/times repetidos).",
      );
    }
    if (code === "23503") {
      return new Error(
        "Jogador, time ou campeonato da partida não existe no Supabase (FK).",
      );
    }
    if (code === "23505") {
      return new Error(
        "Conflito de identificadores no Supabase (sequência de ids desalinhada).",
      );
    }
    if (isNetworkErrorMessage(text)) {
      return new Error(
        "Não foi possível conectar ao Supabase. Verifique sua conexão com a internet e tente novamente.",
      );
    }
    return new Error(
      `Erro no Supabase: ${err.message}${code ? ` (código ${code})` : ""}`,
    );
  }
  return new Error(`Erro inesperado ao acessar o Supabase: ${String(err)}`);
}

function isAuthRejection(err: unknown): boolean {
  return (
    isPostgrestErrorLike(err) && (err.code === "PGRST301" || err.code === "401")
  );
}

export function createMatchesService(
  db: Database.Database,
  repo: Repository,
): MatchesService {
  const mirrorUpsert = db.prepare(`
    INSERT INTO matches(id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at)
    VALUES (@id,@player1_id,@player2_id,@team1_id,@team2_id,@score1,@score2,@championship_id,@played_at)
    ON CONFLICT(id) DO UPDATE SET
      player1_id=excluded.player1_id,
      player2_id=excluded.player2_id,
      team1_id=excluded.team1_id,
      team2_id=excluded.team2_id,
      score1=excluded.score1,
      score2=excluded.score2,
      championship_id=COALESCE(excluded.championship_id, matches.championship_id),
      played_at=excluded.played_at
  `);

  async function requireAuth(force = false): Promise<string> {
    const auth = await ensureAuthenticated(force ? { force: true } : {});
    if (!auth.ok) throw new Error(auth.message);
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase não configurado.");
    const { data, error } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (error || !userId) {
      throw new Error(
        "Sessão da conta de serviço indisponível — não foi possível registrar created_by no Supabase.",
      );
    }
    return userId;
  }

  async function execWithAuthRetry<T>(
    make: (
      userId: string,
    ) => PromiseLike<{ data: T | null; error: PostgrestErrorLike | null }>,
  ): Promise<T> {
    const run = async (userId: string): Promise<T> => {
      const { data, error } = await make(userId);
      if (error) throw error;
      return data as T;
    };
    const userId = await requireAuth();
    try {
      return await run(userId);
    } catch (err) {
      if (isAuthRejection(err)) {
        const freshUserId = await requireAuth(true);
        try {
          return await run(freshUserId);
        } catch (retryErr) {
          throw toFriendlyError(retryErr);
        }
      }
      throw toFriendlyError(err);
    }
  }

  function prevalidateSave(m: MatchInput, championshipId: number | null): void {
    if (!m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");

    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");

    const player1Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player1Id);
    const player2Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player2Id);
    const team1Exists = db
      .prepare("SELECT 1 FROM teams WHERE id=?")
      .get(m.team1Id);
    const team2Exists = db
      .prepare("SELECT 1 FROM teams WHERE id=?")
      .get(m.team2Id);

    if (!player1Exists || !player2Exists)
      throw new Error("Um dos jogadores selecionados não existe.");
    if (!team1Exists || !team2Exists)
      throw new Error("Um dos times selecionados não existe.");

    if (championshipId !== null) {
      const championshipExists = db
        .prepare("SELECT 1 FROM championships WHERE id=?")
        .get(championshipId);
      if (!championshipExists)
        throw new Error("O campeonato selecionado não existe.");

      const fixture = db
        .prepare(
          "SELECT id,stage FROM fixtures WHERE championship_id=? AND match_id IS NULL AND ((player1_id=? AND player2_id=?) OR (player1_id=? AND player2_id=?))",
        )
        .get(
          championshipId,
          m.player1Id,
          m.player2Id,
          m.player2Id,
          m.player1Id,
        ) as { id: number; stage: string } | undefined;
      if (!fixture)
        throw new Error("Este confronto não está pendente neste campeonato.");
      if (fixture.stage !== "league" && m.score1 === m.score2)
        throw new Error(
          "No mata-mata informe um vencedor; empates não são permitidos.",
        );
    }
  }

  function renumberLocalMatch(fromId: number, toId: number): void {
    if (fromId === toId) return;
    const tx = db.transaction(() => {
      const links = db
        .prepare("SELECT id FROM fixtures WHERE match_id=?")
        .all(fromId) as Array<{ id: number }>;
      db.prepare("UPDATE fixtures SET match_id=NULL WHERE match_id=?").run(
        fromId,
      );
      db.prepare("UPDATE matches SET id=? WHERE id=?").run(toId, fromId);
      const relink = db.prepare("UPDATE fixtures SET match_id=? WHERE id=?");
      for (const link of links) relink.run(toId, link.id);
    });
    tx();
  }

  async function compensateRemoteDelete(remoteId: number): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error } = await supabase
        .from("matches")
        .delete()
        .eq("id", remoteId);
      if (error) {
        console.warn(
          `${LOG_PREFIX} compensação remota falhou para id=${remoteId}:`,
          error.message,
        );
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} compensação remota falhou para id=${remoteId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  function toLocalSaveError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /UNIQUE constraint failed: matches\.id|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(
        message,
      )
    ) {
      return new Error(
        "Conflito de identificadores: o id gerado pelo Supabase já existe no banco local. Rode `npm run migrate:matches` para realinhar os ids e tente novamente.",
      );
    }
    return err instanceof Error ? err : new Error(message);
  }

  async function save(m: MatchInput): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return repo.saveMatch(m);

    const championshipId = m.championshipId ? Number(m.championshipId) : null;

    prevalidateSave(m, championshipId);

    const playedAt = m.playedAt ?? new Date().toISOString();

    // 1) Insere a partida no Supabase
    const result = await execWithAuthRetry<
      SupabaseMatchRow[] | SupabaseMatchRow
    >((userId) =>
      supabase
        .from("matches")
        .insert({
          player1_id: m.player1Id,
          player2_id: m.player2Id,
          team1_id: m.team1Id,
          team2_id: m.team2Id,
          score1: m.score1,
          score2: m.score2,
          championship_id: championshipId,
          played_at: playedAt,
          created_by: userId,
        })
        .select(MATCH_COLUMNS),
    );
    const inserted = Array.isArray(result) ? result : result ? [result] : [];
    if (inserted.length === 0)
      throw new Error("O Supabase não retornou a partida criada.");
    const remoteId = Number(inserted[0].id);

    try {
      // 2) Executa a gravação e renumeração local
      const localId = repo.saveMatch({
        ...m,
        championshipId: championshipId ?? undefined,
        playedAt,
      });
      renumberLocalMatch(localId, remoteId);

      // 3) Atualiza o match_id na fixture do Supabase (se for partida de campeonato)
      if (championshipId !== null) {
        const localFixture = db
          .prepare("SELECT id FROM fixtures WHERE match_id = ?")
          .get(remoteId) as { id: number } | undefined;

        if (localFixture) {
          await supabase
            .from("fixtures")
            .update({ match_id: remoteId })
            .eq("id", localFixture.id);
        }
      }

      return remoteId;
    } catch (err) {
      await compensateRemoteDelete(remoteId);
      throw toLocalSaveError(err);
    }
  }

  async function update(m: MatchInput & { id: number }): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return repo.updateMatch(m);

    if (!m.id || !m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
      throw new Error("Selecione os dois jogadores e os dois times.");

    if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
      throw new Error("Escolha jogadores e times diferentes.");

    const player1Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player1Id);
    const player2Exists = db
      .prepare("SELECT 1 FROM players WHERE id=?")
      .get(m.player2Id);
    const team1Exists = db
      .prepare("SELECT 1 FROM teams WHERE id=?")
      .get(m.team1Id);
    const team2Exists = db
      .prepare("SELECT 1 FROM teams WHERE id=?")
      .get(m.team2Id);

    if (!player1Exists || !player2Exists)
      throw new Error("Um dos jogadores selecionados não existe.");
    if (!team1Exists || !team2Exists)
      throw new Error("Um dos times selecionados não existe.");

    const existing = db
      .prepare("SELECT id, championship_id FROM matches WHERE id=?")
      .get(m.id) as { id: number; championship_id: number | null } | undefined;
    if (!existing) throw new Error("Partida não encontrada.");

    const playedAt = m.playedAt ?? new Date().toISOString();
    const championshipId = m.championshipId
      ? Number(m.championshipId)
      : existing.championship_id;

    const patched = await execWithAuthRetry<
      SupabaseMatchRow[] | SupabaseMatchRow
    >(() =>
      supabase
        .from("matches")
        .update({
          player1_id: m.player1Id,
          player2_id: m.player2Id,
          team1_id: m.team1Id,
          team2_id: m.team2Id,
          score1: m.score1,
          score2: m.score2,
          championship_id: championshipId,
          played_at: playedAt,
        })
        .eq("id", m.id)
        .select(MATCH_COLUMNS),
    );
    const patchedRows = Array.isArray(patched)
      ? patched
      : patched
        ? [patched]
        : [];

    if (patchedRows.length === 0) {
      await execWithAuthRetry<SupabaseMatchRow[] | SupabaseMatchRow>((userId) =>
        supabase
          .from("matches")
          .insert({
            id: m.id,
            player1_id: m.player1Id,
            player2_id: m.player2Id,
            team1_id: m.team1Id,
            team2_id: m.team2Id,
            score1: m.score1,
            score2: m.score2,
            championship_id: championshipId,
            played_at: playedAt,
            created_by: userId,
          })
          .select(MATCH_COLUMNS),
      );
    }

    return repo.updateMatch({
      ...m,
      championshipId: championshipId ?? undefined,
      playedAt,
    });
  }

  async function remove(id: number): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) {
      repo.deleteMatch(id);
      return;
    }

    const existing = db.prepare("SELECT id FROM matches WHERE id=?").get(id);
    if (!existing) throw new Error("Partida não encontrada.");

    // Desvincula o match_id da fixture remota antes de excluir a partida
    await execWithAuthRetry(() =>
      supabase.from("fixtures").update({ match_id: null }).eq("match_id", id),
    );

    const deleted = await execWithAuthRetry<Array<{ id: number | string }>>(
      () => supabase.from("matches").delete().eq("id", id).select("id"),
    );

    if (!deleted || deleted.length === 0) {
      console.warn(
        `${LOG_PREFIX} Supabase não retornou linhas ao excluir id=${id}. Seguindo com a exclusão local.`,
      );
    }

    repo.deleteMatch(id);
  }

  function clear(): void {
    repo.clearMatches();
  }

  async function syncMirror(): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return 0;

    const auth = await ensureAuthenticated();
    if (!auth.ok) return 0;

    let rows: SupabaseMatchRow[];
    try {
      const { data, error } = await supabase
        .from("matches")
        .select(MATCH_COLUMNS)
        .order("id", { ascending: true });
      if (error) throw error;
      rows = (data ?? []) as SupabaseMatchRow[];
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível sincronizar o espelho local:`,
        err instanceof Error ? err.message : err,
      );
      return 0;
    }

    if (rows.length === 0) return 0;

    let synced = 0;
    let skipped = 0;
    const apply = db.transaction(() => {
      for (const row of rows) {
        try {
          mirrorUpsert.run({
            id: Number(row.id),
            player1_id: Number(row.player1_id),
            player2_id: Number(row.player2_id),
            team1_id: Number(row.team1_id),
            team2_id: Number(row.team2_id),
            score1: Number(row.score1),
            score2: Number(row.score2),
            championship_id:
              row.championship_id == null ? null : Number(row.championship_id),
            played_at: normalizePlayedAt(row.played_at),
          });
          synced += 1;
        } catch (err) {
          skipped += 1;
          console.warn(
            `${LOG_PREFIX} espelho: partida remota id=${row.id} ignorada.`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    });
    apply();

    if (skipped > 0)
      console.warn(
        `${LOG_PREFIX} espelho: ${skipped} partida(s) remota(s) ignorada(s).`,
      );
    console.info(
      `${LOG_PREFIX} espelho local sincronizado com o Supabase: ${synced} partida(s).`,
    );
    return synced;
  }

  return { save, update, remove, clear, syncMirror };
}
