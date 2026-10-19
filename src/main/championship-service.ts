import type Database from "better-sqlite3";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Championship, DuoInput } from "../shared/models";
import type { repository } from "./repository";
import { ensureAuthenticated, getSupabase } from "./supabase";

export async function deleteChampionship(
  repo: Pick<ReturnType<typeof repository>, "deleteChampionship">,
  id: number,
): Promise<void> {
  const failureMessage = "Não foi possível excluir o campeonato. Verifique sua conexão.";
  try {
    const auth = await ensureAuthenticated();
    const supabase = getSupabase();
    if (!auth.ok || !supabase) throw new Error(failureMessage);

    const { data, error } = await supabase.from("championships")
      .delete().eq("id", id).select("id");
    if (error || !data || data.length !== 1) throw new Error(failureMessage);
  } catch {
    throw new Error(failureMessage);
  }

  repo.deleteChampionship(id);
}

export async function getOrCreateDuoRemote(
  db: Database.Database,
  supabase: SupabaseClient,
  player1Id: number,
  player2Id: number,
  roomId: string | null,
  teamId?: number | null
): Promise<number> {
  const [firstId, secondId] = [player1Id, player2Id].sort((a, b) => a - b);
  if (firstId === secondId) throw new Error("Uma dupla precisa ter dois jogadores diferentes.");

  type RemoteDuo = { id: number; team_id: number | null };
  const findRemote = async (): Promise<RemoteDuo | null> => {
    const query = supabase.from("teams2v2").select("id, team_id")
      .eq("player1_id", firstId).eq("player2_id", secondId);
    const { data, error } = await (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId)).maybeSingle();
    if (error) throw new Error("Não foi possível consultar a dupla. Tente novamente.");
    return data ?? null;
  };

  let remote = await findRemote();
  if (remote === null) {
    const { data, error } = await supabase.from("teams2v2")
      .insert({ player1_id: firstId, player2_id: secondId, room_id: roomId, team_id: teamId ?? null })
      .select("id, team_id").single();
    if (error?.code === "23505") {
      remote = await findRemote();
    } else if (error) {
      throw new Error("Não foi possível criar a dupla. Tente novamente.");
    } else {
      remote = data ?? null;
    }
  }

  if (remote === null || !Number.isSafeInteger(remote.id) || remote.id <= 0) {
    throw new Error("Não foi possível obter a dupla. Tente novamente.");
  }

  if (teamId != null && remote.team_id == null) {
    const { data, error } = await supabase.from("teams2v2")
      .update({ team_id: teamId }).eq("id", remote.id).is("team_id", null)
      .select("id, team_id").maybeSingle();
    if (error) throw new Error("Não foi possível definir o time da dupla. Tente novamente.");
    remote = data ?? await findRemote();
    if (!remote) throw new Error("Não foi possível obter a dupla. Tente novamente.");
  }
  if (teamId != null && remote.team_id !== teamId) {
    throw new Error("A dupla já tem um time definido; não é possível alterar.");
  }

  const { id: remoteId, team_id: remoteTeamId } = remote;
  db.transaction(() => {
    const local = db.prepare("SELECT room_id, player1_id, player2_id, team_id FROM teams2v2 WHERE id = ?")
      .get(remoteId) as { room_id: string | null; player1_id: number; player2_id: number; team_id: number | null } | undefined;
    const pair = db.prepare("SELECT id FROM teams2v2 WHERE player1_id = ? AND player2_id = ? AND room_id IS NOT DISTINCT FROM ? AND id <> ?")
      .get(firstId, secondId, roomId, remoteId);
    if (pair || (local && (local.room_id !== roomId || local.player1_id !== firstId || local.player2_id !== secondId))) {
      throw new Error("Conflito de ID de dupla; verifique os dados locais.");
    }
    if (local?.team_id != null && local.team_id !== remoteTeamId) {
      throw new Error("A dupla já tem um time definido; não é possível alterar.");
    }
    if (!local) {
      db.prepare("INSERT INTO teams2v2 (id, room_id, player1_id, player2_id, team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
        .run(remoteId, roomId, firstId, secondId, remoteTeamId);
    } else if (local.team_id == null && remoteTeamId != null) {
      db.prepare("UPDATE teams2v2 SET team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(remoteTeamId, remoteId);
    }
  })();
  return remoteId;
}

export async function setChampionshipStatus(
  db: Database.Database,
  roomId: string | null,
  championshipId: number,
  status: "active" | "finished"
): Promise<void> {
  // Reservado para o contexto de salas quando o schema antigo for substituído.
  void roomId;

  const championship = db.prepare("SELECT id FROM championships WHERE id = ?").get(championshipId);
  if (!championship) throw new Error("Campeonato não encontrado.");

  const auth = await ensureAuthenticated();
  const supabase = getSupabase();
  if (!auth.ok || !supabase) throw new Error("Não foi possível atualizar o campeonato. Verifique sua conexão.");

  const { data, error } = await supabase
    .from("championships")
    .update({ status })
    .eq("id", championshipId)
    .select("id");

  if (error || !data || data.length !== 1) {
    throw new Error("Não foi possível atualizar o campeonato. Tente novamente.");
  }

  db.prepare("UPDATE championships SET status = ? WHERE id = ?").run(status, championshipId);
}

/**
 * Listagem de campeonatos com sincronização Supabase -> SQLite
 */
/**
 * Listagem de campeonatos com sincronização Supabase -> SQLite
 */
export async function getChampionships(db: Database.Database, roomId: string | null): Promise<Championship[]> {
  const auth = await ensureAuthenticated();
  const supabase = getSupabase();

  if (roomId !== null && (!auth.ok || !supabase)) {
    throw new Error("Não foi possível sincronizar os campeonatos da sala.");
  }
  if (auth.ok && supabase) {
    try {
      // Usa .select("*") para evitar que o PostgREST confunda a coluna 'mode' com a função SQL mode()
      const query = supabase
        .from("championships")
        .select("*");
      const { data: remoteChampionships, error } = await (roomId === null ? query.is("room_id", null) : query.eq("room_id", roomId))
        .order("id", { ascending: false });

      if (error) {
        if (roomId !== null) throw new Error("Não foi possível sincronizar os campeonatos da sala.");
        console.warn("[championship-service] Erro ao buscar campeonatos no Supabase:", error.message);
      } else if (remoteChampionships) {
        const syncStmt = db.prepare(`
          INSERT INTO championships (id, name, format, mode, mutator, starts_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            format = excluded.format,
            mode = excluded.mode,
            mutator = excluded.mutator,
            starts_at = excluded.starts_at,
            status = excluded.status
        `);

        db.transaction(() => {
          for (const c of remoteChampionships) {
            syncStmt.run(
              c.id,
              c.name,
              c.format,
              c.mode,
              c.mutator,
              c.starts_at,
              c.status
            );
          }
        })();
      }
    } catch (err) {
      if (roomId !== null) throw new Error("Não foi possível sincronizar os campeonatos da sala.");
      console.warn("[championship-service] Supabase indisponível. Utilizando dados locais do SQLite.");
    }
  }

  // Corrigido COUNT(cp.id) para COUNT(cp.player_id)
  const rows = db.prepare(`
    SELECT 
      c.id, c.name, c.format, c.mode, c.mutator, c.starts_at as startsAt, c.status,
      COUNT(cp.player_id) as participantsCount
    FROM championships c
    LEFT JOIN championship_participants cp ON cp.championship_id = c.id
    GROUP BY c.id
    ORDER BY c.id DESC
  `).all() as Array<Championship & { participantsCount: number }>;

  return rows.map((r) => ({
    ...r,
    participants: r.participantsCount || 0,
  }));
}

/**
 * Atualiza o nome de um campeonato no SQLite e sincroniza no Supabase.
 */
export async function updateChampionshipName(
  db: Database.Database,
  id: number,
  name: string
): Promise<void> {
  const normalizedName = name.trim();

  if (!normalizedName) throw new Error("Informe um nome para o campeonato.");
  if (!Number.isInteger(id) || id <= 0) throw new Error("Campeonato inválido.");

  const result = db
    .prepare("UPDATE championships SET name = ? WHERE id = ?")
    .run(normalizedName, id);

  if (!result.changes) throw new Error("Campeonato não encontrado.");

  const auth = await ensureAuthenticated();
  const supabase = getSupabase();

  if (auth.ok && supabase) {
    try {
      const { error } = await supabase
        .from("championships")
        .update({ name: normalizedName })
        .eq("id", id);

      if (error) {
        console.warn(`[championship-service] Erro ao atualizar nome no Supabase (ID: ${id}):`, error.message);
      } else {
        console.info(`[championship-service] Nome do campeonato ${id} atualizado com sucesso no Supabase.`);
      }
    } catch (err) {
      console.warn(`[championship-service] Falha na conexão com Supabase para renomear campeonato (ID: ${id}):`, err);
    }
  }
}

/**
 * Salva novo campeonato no Supabase e atualiza o espelho SQLite.
 */
export async function saveChampionship(
  db: Database.Database,
  payload: {
    name: string;
    format: "league" | "knockout" | "groups_knockout";
    mode?: "classic" | "duo" | "mad";
    mutator?: string | null;
    startsAt?: string;
    status?: "draft" | "active" | "finished";
    participantIds: number[];
    participantTeamIds?: (number | null)[];
    participantDuos?: DuoInput[];
  }
): Promise<Championship> {
  const name = payload.name.trim();
  if (!name) throw new Error("Informe o nome do campeonato.");
  const duos = payload.participantDuos ?? [];
  const isDuo = duos.length > 0;
  if (isDuo ? duos.length < 2 : !payload.participantIds || payload.participantIds.length < 2) {
    throw new Error("Selecione ao menos 2 participantes.");
  }
  if (isDuo) {
    const pairs = duos.map(({ player1Id, player2Id }) => [player1Id, player2Id].sort((a, b) => a - b).join(":"));
    if (new Set(pairs).size !== pairs.length) throw new Error("Não é possível repetir uma dupla no campeonato.");
    if (duos.some(({ player1Id, player2Id }) => player1Id === player2Id)) {
      throw new Error("Uma dupla precisa ter dois jogadores diferentes.");
    }
  }

  const id = Date.now();
  const startsAt = payload.startsAt || new Date().toISOString();
  const mode = isDuo ? "duo" : payload.mode || "classic";
  const status = payload.status || "draft";

  const auth = await ensureAuthenticated();
  const supabase = getSupabase();
  if (!auth.ok || !supabase) {
    throw new Error("Não foi possível salvar o campeonato. Verifique sua conexão.");
  }

  const duoIds: number[] = [];
  for (const duo of duos) {
    duoIds.push(await getOrCreateDuoRemote(db, supabase, duo.player1Id, duo.player2Id, null));
  }

  const { error: champErr } = await supabase.from("championships").insert({
    id,
    name,
    format: payload.format,
    mode,
    mutator: payload.mutator || null,
    starts_at: startsAt,
    status,
  });
  if (champErr) throw new Error("Não foi possível salvar o campeonato. Tente novamente.");

  const participantsToInsert = payload.participantIds.map((playerId, index) => ({
    championship_id: id,
    player_id: playerId,
    team_id: payload.participantTeamIds?.[index] ?? null,
  }));
  if (!isDuo) {
    const { error: partErr } = await supabase
      .from("championship_participants")
      .insert(participantsToInsert);
    if (partErr) {
      throw new Error("Não foi possível salvar os participantes. O campeonato pode estar incompleto; confira antes de tentar novamente.");
    }
  }

  const fixtures: Array<{ championship_id: number; stage: string; round_number: number; player1_id: number | null; player2_id: number | null; team1_duo_id?: number; team2_duo_id?: number }> = [];
  const p = isDuo ? duoIds : payload.participantIds;
  let roundNum = 1;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      fixtures.push(isDuo
        ? { championship_id: id, stage: "league", round_number: roundNum, player1_id: null, player2_id: null, team1_duo_id: p[i], team2_duo_id: p[j] }
        : { championship_id: id, stage: "league", round_number: roundNum, player1_id: p[i], player2_id: p[j] });
      roundNum++;
    }
  }
  let savedFixtures: Array<{
    id: number;
    stage: string;
    round_number: number;
    player1_id: number | null;
    player2_id: number | null;
    team1_duo_id?: number | null;
    team2_duo_id?: number | null;
  }>;
  if (isDuo) {
    const { error } = await supabase.from("fixtures").insert(fixtures);
    if (error) {
      if (error.code === "23505") throw new Error("Este confronto já existe neste campeonato.");
      if (error.code === "42703" && /team[12]_duo_id/i.test(error.message)) {
        throw new Error("O banco remoto não tem as colunas de dupla. Aplique as migrations pendentes.");
      }
      throw new Error("Não foi possível salvar os confrontos. O campeonato pode estar incompleto; confira antes de tentar novamente.");
    }
    const { data, error: readError } = await supabase.from("fixtures")
      .select("id, stage, round_number, player1_id, player2_id, team1_duo_id, team2_duo_id")
      .eq("championship_id", id);
    if (readError || !data) {
      if (readError?.code === "42703" && /team[12]_duo_id/i.test(readError.message)) {
        throw new Error("O banco remoto não tem as colunas de dupla. Aplique as migrations pendentes.");
      }
      throw new Error("Não foi possível carregar os confrontos salvos. Confira o campeonato antes de tentar novamente.");
    }
    savedFixtures = data;
  } else {
    const { error } = await supabase.from("fixtures").insert(fixtures);
    if (error) {
      if (error.code === "23505") throw new Error("Este confronto já existe neste campeonato.");
      throw new Error("Não foi possível salvar os confrontos. O campeonato pode estar incompleto; confira antes de tentar novamente.");
    }
    const { data, error: readError } = await supabase.from("fixtures")
      .select("id, stage, round_number, player1_id, player2_id")
      .eq("championship_id", id);
    if (readError || !data) {
      throw new Error("Não foi possível carregar os confrontos salvos. Confira o campeonato antes de tentar novamente.");
    }
    savedFixtures = data;
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO championships (id, name, format, mode, mutator, starts_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, payload.format, mode, payload.mutator || null, startsAt, status);

    const partStmt = db.prepare(`
      INSERT INTO championship_participants (championship_id, player_id, team_id)
      VALUES (?, ?, ?)
    `);
    if (!isDuo) {
      payload.participantIds.forEach((playerId, index) => {
        partStmt.run(id, playerId, payload.participantTeamIds?.[index] ?? null);
      });
    }

    const fixStmt = db.prepare(`
      INSERT INTO fixtures (id, championship_id, stage, round_number, player1_id, player2_id, team1_duo_id, team2_duo_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fixture of savedFixtures) {
      fixStmt.run(fixture.id, id, fixture.stage, fixture.round_number, fixture.player1_id, fixture.player2_id, fixture.team1_duo_id ?? null, fixture.team2_duo_id ?? null);
    }
  })();

  return {
    id,
    name,
    format: payload.format,
    mode,
    mutator: payload.mutator || null,
    startsAt,
    status,
    participants: isDuo ? duoIds.length : payload.participantIds.length,
  };
}
