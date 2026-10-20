import type Database from "better-sqlite3";

import type { MatchInput } from "../shared/models";
import { setChampionshipStatus } from "./championship-service";
import type { repository } from "./repository";
import {
  getSessionUserId,
  getUserSessionClient,
  isNetworkErrorMessage,
} from "./supabase";

type Repository = ReturnType<typeof repository>;

/** Linha de public.matches no Supabase (snake_case). */
type SupabaseMatchRow = {
  id: number | string;
  player1_id: number | string | null;
  player2_id: number | string | null;
  team1_duo_id?: number | string | null;
  team2_duo_id?: number | string | null;
  team1_id: number | string;
  team2_id: number | string;
  score1: number;
  score2: number;
  championship_id: number | string | null;
  played_at: string | null;
  created_by?: string | null;
};

type SupabaseDuoRow = {
  id: number;
  room_id: string | null;
  player1_id: number;
  player2_id: number;
  name: string | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
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
  save(match: MatchInput, roomId: string | null): Promise<number>;
  /** Edita partida: Supabase primeiro + atualização local. */
  update(match: MatchInput & { id: number }): Promise<number>;
  /** Exclui partida no Supabase e no SQLite (fixtures.match_id -> NULL). */
  remove(id: number): Promise<void>;
  /** Limpeza em massa LOCAL-ONLY. */
  clear(): void;
  /** Sincroniza o espelho local a partir do Supabase (boot). Retorna nº de linhas. */
  syncMirror(roomId: string | null): Promise<number>;
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
        "Sua sessão foi recusada. Entre novamente para continuar.",
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

export function createMatchesService(
  db: Database.Database,
  repo: Repository,
  roomId: string | null,
): MatchesService {
  const matchColumns = db.prepare("PRAGMA table_info(matches)").all() as { name: string }[];
  const hasDuoColumns = ["team1_duo_id", "team2_duo_id"].every((name) =>
    matchColumns.some((column) => column.name === name),
  );
  const mirrorUpsert = db.prepare(`
    INSERT INTO matches(id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at${hasDuoColumns ? ",team1_duo_id,team2_duo_id" : ""})
    VALUES (@id,@player1_id,@player2_id,@team1_id,@team2_id,@score1,@score2,@championship_id,@played_at${hasDuoColumns ? ",@team1_duo_id,@team2_duo_id" : ""})
    ON CONFLICT(id) DO UPDATE SET
      player1_id=excluded.player1_id,
      player2_id=excluded.player2_id,
      ${hasDuoColumns ? "team1_duo_id=excluded.team1_duo_id, team2_duo_id=excluded.team2_duo_id," : ""}
      team1_id=excluded.team1_id,
      team2_id=excluded.team2_id,
      score1=excluded.score1,
      score2=excluded.score2,
      championship_id=COALESCE(excluded.championship_id, matches.championship_id),
      played_at=excluded.played_at
  `);

  async function requireAuth(): Promise<string> {
    await getUserSessionClient();
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Sua sessão expirou. Entre novamente para continuar.");
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
      throw toFriendlyError(err);
    }
  }

  function prevalidateSave(m: MatchInput, championshipId: number | null): void {
    if (m.team1DuoId != null || m.team2DuoId != null) {
      if (!m.team1DuoId || !m.team2DuoId || m.team1DuoId === m.team2DuoId)
        throw new Error("Selecione duas duplas diferentes.");
      if (championshipId !== null) {
        const fixture = db.prepare(
          "SELECT id,stage FROM fixtures WHERE championship_id=? AND match_id IS NULL AND ((team1_duo_id=? AND team2_duo_id=?) OR (team1_duo_id=? AND team2_duo_id=?))",
        ).get(championshipId, m.team1DuoId, m.team2DuoId, m.team2DuoId, m.team1DuoId) as
          | { id: number; stage: string }
          | undefined;
        if (!fixture) throw new Error("Este confronto não está pendente neste campeonato.");
        if (fixture.stage !== "league" && m.score1 === m.score2)
          throw new Error("No mata-mata informe um vencedor; empates não são permitidos.");
      }
      return;
    }
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
    try {
      const supabase = await getUserSessionClient();
      const { error } = await supabase
        .from("matches")
        .delete()
        .eq("id", remoteId)
        .eq("room_id", roomId);
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

  async function syncKnockoutProgress(
    championshipId: number,
    progress: ReturnType<typeof repo.advanceToKnockout>,
  ): Promise<void> {
    if (!progress) return;
    const supabase = await getUserSessionClient();
    const userId = await getSessionUserId();
    if (!userId) throw new Error("Sua sessão expirou. Entre novamente para continuar.");

    const remoteFixtures: Array<{
      id: number;
      roundNumber: number;
      bracketPosition: number;
      player1Id: number;
      player2Id: number;
    }> = [];
    if (progress.fixtures.length) {
      const { data, error } = await supabase.from("fixtures").insert(
        progress.fixtures.map((fixture) => ({
          championship_id: championshipId,
          room_id: roomId,
          created_by: userId,
          stage: "knockout",
          round_number: fixture.roundNumber,
          bracket_position: fixture.bracketPosition,
          player1_id: fixture.player1Id,
          player2_id: fixture.player2Id,
        })),
      ).select("id, round_number, bracket_position, player1_id, player2_id");
      if (error || !data) {
        throw new Error("Não foi possível criar a próxima fase do mata-mata.");
      }
      remoteFixtures.push(...data.map((fixture) => ({
        id: Number(fixture.id),
        roundNumber: fixture.round_number,
        bracketPosition: fixture.bracket_position,
        player1Id: fixture.player1_id,
        player2Id: fixture.player2_id,
      })));
    }

    const remoteByes: Array<{ id: number; roundNumber: number; position: number; playerId: number }> = [];
    if (progress.byes.length) {
      const { data, error } = await supabase.from("knockout_byes").insert(
        progress.byes.map((bye) => ({
          championship_id: championshipId,
          round_number: bye.roundNumber,
          player_id: bye.playerId,
          position: bye.position,
        })),
      ).select("id, round_number, position, player_id");
      if (error || !data) {
        throw new Error("Não foi possível registrar o avanço automático do mata-mata.");
      }
      remoteByes.push(...data.map((bye) => ({
        id: Number(bye.id),
        roundNumber: bye.round_number,
        position: bye.position,
        playerId: bye.player_id,
      })));
    }

    repo.applyKnockoutProgress(championshipId, remoteFixtures, remoteByes);
    if (progress.finished) {
      await setChampionshipStatus(db, roomId, championshipId, "finished");
    }
  }

  async function save(m: MatchInput, requestedRoomId: string | null): Promise<number> {
    if (requestedRoomId !== roomId) {
      throw new Error("A sala selecionada foi alterada. Tente novamente.");
    }
    const supabase = await getUserSessionClient();

    const championshipId = m.championshipId ? Number(m.championshipId) : null;
    const isDuo = m.team1DuoId != null || m.team2DuoId != null;
    let team1Id = m.team1Id;
    let team2Id = m.team2Id;

    if (isDuo) {
      if (!m.team1DuoId || !m.team2DuoId || m.team1DuoId === m.team2DuoId)
        throw new Error("Selecione duas duplas diferentes.");
      const query = db.prepare("SELECT team_id FROM teams2v2 WHERE id=?");
      const duo1 = query.get(m.team1DuoId) as { team_id: number | null } | undefined;
      const duo2 = query.get(m.team2DuoId) as { team_id: number | null } | undefined;
      if (!duo1 || !duo2) throw new Error("Uma das duplas selecionadas não existe.");
      if (duo1.team_id == null || duo2.team_id == null)
        throw new Error("Defina o time da dupla antes de registrar a partida.");
      team1Id = duo1.team_id;
      team2Id = duo2.team_id;
    }

    prevalidateSave(m, championshipId);

    const playedAt = m.playedAt ?? new Date().toISOString();

    // 1) Insere a partida no Supabase
    const result = await execWithAuthRetry<
      SupabaseMatchRow[] | SupabaseMatchRow
    >((userId) =>
      supabase
        .from("matches")
        .insert({
          player1_id: isDuo ? null : m.player1Id,
          player2_id: isDuo ? null : m.player2Id,
          ...(isDuo ? { team1_duo_id: m.team1DuoId, team2_duo_id: m.team2DuoId } : {}),
          team1_id: team1Id,
          team2_id: team2Id,
          score1: m.score1,
          score2: m.score2,
          championship_id: championshipId,
          played_at: playedAt,
          room_id: roomId,
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
        team1Id,
        team2Id,
        championshipId: championshipId ?? undefined,
        playedAt,
      });
      renumberLocalMatch(localId, remoteId);

      // 3) Atualiza o match_id na fixture do Supabase (se for partida de campeonato)
      if (championshipId !== null) {
        const localFixture = db
          .prepare("SELECT id, stage, round_number roundNumber FROM fixtures WHERE match_id = ?")
          .get(remoteId) as { id: number; stage: string; roundNumber: number } | undefined;

        if (localFixture) {
          const fixtureUpdate = supabase
            .from("fixtures")
            .update({ match_id: remoteId })
            .eq("id", localFixture.id);
          const { error } = await (roomId === null
            ? fixtureUpdate.is("room_id", null)
            : fixtureUpdate.eq("room_id", roomId));
          if (error) throw toFriendlyError(error);

          const championship = db
            .prepare("SELECT format FROM championships WHERE id=?")
            .get(championshipId) as { format: string } | undefined;
          if (localFixture.stage === "league" && championship?.format === "groups_knockout") {
            await syncKnockoutProgress(championshipId, repo.advanceToKnockout(championshipId));
          } else if (localFixture.stage === "knockout") {
            await syncKnockoutProgress(championshipId, repo.advanceKnockout(championshipId, localFixture.roundNumber));
          }
        }
      }
    } catch (err) {
      await compensateRemoteDelete(remoteId);
      throw toLocalSaveError(err);
    }

    if (championshipId !== null && repo.maybeFinishLeagueChampionship(championshipId)) {
      await setChampionshipStatus(db, roomId, championshipId, "finished");
    }
    return remoteId;
  }

  async function update(m: MatchInput & { id: number }): Promise<number> {
    const supabase = await getUserSessionClient();

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

    if (existing.championship_id !== null) {
      const championship = db
        .prepare("SELECT status FROM championships WHERE id=?")
        .get(existing.championship_id) as { status: string } | undefined;
      if (championship?.status === "finished") {
        await setChampionshipStatus(db, roomId, existing.championship_id, "active");
      }
    }

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
        .eq("room_id", roomId)
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
            room_id: roomId,
            created_by: userId,
          })
          .select(MATCH_COLUMNS),
      );
    }

    const updatedId = repo.updateMatch({
      ...m,
      championshipId: championshipId ?? undefined,
      playedAt,
    });
    if (championshipId !== null && repo.maybeFinishLeagueChampionship(championshipId)) {
      await setChampionshipStatus(db, roomId, championshipId, "finished");
    }
    return updatedId;
  }

  async function remove(id: number): Promise<void> {
    const supabase = await getUserSessionClient();

    const existing = db.prepare("SELECT id, championship_id FROM matches WHERE id=?").get(id) as
      | { id: number; championship_id: number | null }
      | undefined;
    if (!existing) throw new Error("Partida não encontrada.");

    const championship = existing.championship_id === null
      ? undefined
      : db.prepare("SELECT status FROM championships WHERE id=?").get(existing.championship_id) as
          | { status: string }
          | undefined;

    // Desvincula o match_id da fixture remota antes de excluir a partida
    await execWithAuthRetry(() => {
      const query = supabase.from("fixtures").update({ match_id: null }).eq("match_id", id);
      return roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId);
    });

    const deleted = await execWithAuthRetry<Array<{ id: number | string }>>(
      () => {
        const query = supabase.from("matches").delete().eq("id", id);
        return (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId)).select("id");
      },
    );

    if (!deleted || deleted.length === 0) {
      console.warn(
        `${LOG_PREFIX} Supabase não retornou linhas ao excluir id=${id}. Seguindo com a exclusão local.`,
      );
    }

    repo.deleteMatch(id);
    if (existing.championship_id !== null && championship?.status === "finished") {
      await setChampionshipStatus(db, roomId, existing.championship_id, "active");
    }
  }

  function clear(): void {
    repo.clearMatches();
  }

  async function syncMirror(roomId: string | null): Promise<number> {
    const supabase = await getUserSessionClient();

    let rows: SupabaseMatchRow[];
    try {
      const query = supabase
        .from("matches")
        .select("*");
      const { data, error } = await (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId))
        .order("id", { ascending: true });
      if (error) throw error;
      rows = (data ?? []) as SupabaseMatchRow[];
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} não foi possível sincronizar o espelho local:`,
        err instanceof Error ? err.message : err,
      );
      if (roomId !== null) throw new Error("Não foi possível sincronizar as partidas da sala.");
      return 0;
    }

    const hasDuoTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='teams2v2'").get();
    const remoteDuos = new Map<number, SupabaseDuoRow>();
    if (hasDuoColumns && hasDuoTable) {
      const query = supabase.from("teams2v2").select("*");
      const { data, error } = await (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId));
      if (error) {
        if (error.code !== "PGRST205" && error.code !== "42P01")
          console.warn(`${LOG_PREFIX} não foi possível sincronizar as duplas:`, error.message);
      } else {
        for (const duo of (data ?? []) as SupabaseDuoRow[]) remoteDuos.set(Number(duo.id), duo);
      }
    }

    const syncDuo = (id: number): void => {
      const duo = remoteDuos.get(id);
      if (!duo) throw new Error("Dupla remota não encontrada.");
      const local = db.prepare("SELECT room_id, player1_id, player2_id FROM teams2v2 WHERE id=?").get(id) as
        | { room_id: string | null; player1_id: number; player2_id: number }
        | undefined;
      if (local && (local.room_id !== duo.room_id || local.player1_id !== duo.player1_id || local.player2_id !== duo.player2_id))
        throw new Error("Conflito de ID de dupla no banco local.");
      db.prepare(`INSERT INTO teams2v2(id,room_id,player1_id,player2_id,name,team_id,created_at,updated_at)
        VALUES (@id,@room_id,@player1_id,@player2_id,@name,@team_id,@created_at,@updated_at)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, team_id=excluded.team_id, updated_at=excluded.updated_at`).run(duo);
    };

    let synced = 0;
    let skipped = 0;
    const apply = db.transaction(() => {
      const syncedDuos = new Set<number>();
      for (const id of remoteDuos.keys()) {
        try {
          if (!hasDuoColumns || !hasDuoTable) break;
          syncDuo(id);
          syncedDuos.add(id);
        } catch (err) {
          console.warn(`${LOG_PREFIX} espelho: dupla remota id=${id} ignorada.`, err instanceof Error ? err.message : err);
        }
      }
      for (const row of rows) {
        try {
          const firstDuo = row.team1_duo_id == null ? null : Number(row.team1_duo_id);
          const secondDuo = row.team2_duo_id == null ? null : Number(row.team2_duo_id);
          if (firstDuo !== null || secondDuo !== null) {
            if (!hasDuoColumns || !hasDuoTable || firstDuo === null || secondDuo === null)
              throw new Error("Partida de dupla incompatível com o banco local.");
            if (!syncedDuos.has(firstDuo) || !syncedDuos.has(secondDuo))
              throw new Error("Dupla da partida não está disponível no banco local.");
          }
          mirrorUpsert.run({
            id: Number(row.id),
            player1_id: row.player1_id == null ? null : Number(row.player1_id),
            player2_id: row.player2_id == null ? null : Number(row.player2_id),
            ...(hasDuoColumns ? { team1_duo_id: firstDuo, team2_duo_id: secondDuo } : {}),
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
