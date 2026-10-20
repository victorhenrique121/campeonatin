import type Database from "better-sqlite3";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Championship, DuoInput } from "../shared/models";
import { repository } from "./repository";
import { ensureAuthenticated, getSessionUserId, getSupabase, getUserSessionClient } from "./supabase";

export async function deleteChampionship(
  db: Database.Database,
  id: number,
): Promise<void> {
  const failureMessage = "Não foi possível excluir o campeonato. Verifique sua conexão.";
  try {
    const supabase = await getUserSessionClient();

    const { data, error } = await supabase.from("championships")
      .delete().eq("id", id).select("id");
    if (error || !data || data.length !== 1) throw new Error(failureMessage);
  } catch {
    throw new Error(failureMessage);
  }

  repository(db).deleteChampionship(id);
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

  const supabase = await getUserSessionClient();

  const query = supabase
    .from("championships")
    .update({ status })
    .eq("id", championshipId);
  const { data, error } = await (roomId === null
    ? query.is("room_id", null)
    : query.eq("room_id", roomId)).select("id");

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
  try {
      const supabase = await getUserSessionClient();
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
  },
  roomId: string | null,
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

  const supabase = await getUserSessionClient();
  const userId = await getSessionUserId();
  if (!userId) throw new Error("Sua sessão expirou. Entre novamente para continuar.");

  const duoIds: number[] = [];
  for (const duo of duos) {
    duoIds.push(await getOrCreateDuoRemote(db, supabase, duo.player1Id, duo.player2Id, roomId));
  }

  const { error: champErr } = await supabase.from("championships").insert({
    id,
    name,
    format: payload.format,
    mode,
    mutator: payload.mutator || null,
    starts_at: startsAt,
    status,
    room_id: roomId,
    created_by: userId,
  });
  if (champErr) throw new Error("Não foi possível salvar o campeonato. Tente novamente.");

  const participantsToInsert = payload.participantIds.map((playerId, index) => ({
    championship_id: id,
    player_id: playerId,
    team_id: payload.participantTeamIds?.[index] ?? null,
    room_id: roomId,
  }));
  if (!isDuo) {
    const { error: partErr } = await supabase
      .from("championship_participants")
      .insert(participantsToInsert);
    if (partErr) {
      throw new Error("Não foi possível salvar os participantes. O campeonato pode estar incompleto; confira antes de tentar novamente.");
    }
  }

  type FixtureInsert = {
    championship_id: number;
    room_id: string | null;
    created_by: string;
    stage: string;
    round_number: number;
    player1_id: number | null;
    player2_id: number | null;
    team1_duo_id?: number;
    team2_duo_id?: number;
    group_name?: string | null;
    bracket_position?: number | null;
  };
  const fixtures: FixtureInsert[] = [];
  const initialByes: Array<{
    championship_id: number;
    round_number: number;
    player_id: number;
    position: number;
  }> = [];
  const participants = isDuo ? duoIds : payload.participantIds;
  const addFixture = (
    firstParticipant: number,
    secondParticipant: number,
    stage: string,
    roundNumber: number,
    groupName: string | null = null,
    bracketPosition: number | null = null,
  ) => {
    fixtures.push(isDuo
      ? { championship_id: id, room_id: roomId, created_by: userId, stage, round_number: roundNumber, player1_id: null, player2_id: null, team1_duo_id: firstParticipant, team2_duo_id: secondParticipant, group_name: groupName, bracket_position: bracketPosition }
      : { championship_id: id, room_id: roomId, created_by: userId, stage, round_number: roundNumber, player1_id: firstParticipant, player2_id: secondParticipant, group_name: groupName, bracket_position: bracketPosition });
  };

  if (payload.format === "knockout") {
    const bracketSize = 2 ** Math.ceil(Math.log2(participants.length));
    if (bracketSize > 16) {
      throw new Error("O mata-mata suporta no máximo 16 participantes.");
    }
    const firstRoundNumber = ({ 2: 4, 4: 3, 8: 2, 16: 1 } as Record<number, number>)[bracketSize];
    const seeds: Array<number | null> = [
      ...participants,
      ...Array<number | null>(bracketSize - participants.length).fill(null),
    ];

    if (isDuo && bracketSize !== participants.length) {
      throw new Error("Mata-mata com bye no modo dupla estará disponível em breve.");
    }
    for (let index = 0; index < bracketSize / 2; index++) {
      const firstParticipant = seeds[index];
      const secondParticipant = seeds[bracketSize - 1 - index];

      // A ordem recebida define o seeding: os primeiros colocados encontram os
      // últimos. Quando houver bye, o seed avança sem gerar uma partida vazia.
      if (firstParticipant !== null && secondParticipant !== null) {
        addFixture(firstParticipant, secondParticipant, "knockout", firstRoundNumber, null, index + 1);
      } else if (firstParticipant !== null) {
        initialByes.push({ championship_id: id, round_number: firstRoundNumber, player_id: firstParticipant, position: index + 1 });
      }
    }
  } else if (payload.format === "groups_knockout") {
    if (isDuo) {
      throw new Error("Grupos + mata-mata no modo dupla estará disponível em breve.");
    }
    // Até cinco participantes, um grupo é o formato mais equilibrado. A partir
    // daí, a distribuição alternada preserva a diferença máxima de um jogador.
    const groups = participants.length <= 5
      ? [{ name: "Grupo A", participants }]
      : ["Grupo A", "Grupo B"].map((name, groupIndex) => ({
        name,
        participants: participants.filter((_, index) => index % 2 === groupIndex),
      }));
    let roundNum = 1;
    for (const group of groups) {
      for (let first = 0; first < group.participants.length; first++) {
        for (let second = first + 1; second < group.participants.length; second++) {
          addFixture(group.participants[first], group.participants[second], "league", roundNum, group.name);
          roundNum++;
        }
      }
    }
  } else {
    // Liga inicia com todos contra todos.
    let roundNum = 1;
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        addFixture(participants[i], participants[j], "league", roundNum);
        roundNum++;
      }
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
    group_name?: string | null;
    bracket_position?: number | null;
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
      .select("id, stage, round_number, player1_id, player2_id, team1_duo_id, team2_duo_id, group_name, bracket_position")
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
      .select("id, stage, round_number, player1_id, player2_id, group_name, bracket_position")
      .eq("championship_id", id);
    if (readError || !data) {
      throw new Error("Não foi possível carregar os confrontos salvos. Confira o campeonato antes de tentar novamente.");
    }
    savedFixtures = data;
  }

  if (initialByes.length) {
    const { error: byeError } = await supabase.from("knockout_byes").insert(initialByes);
    if (byeError) {
      throw new Error("Não foi possível registrar os avanços automáticos. O campeonato pode estar incompleto; confira antes de tentar novamente.");
    }
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
      INSERT INTO fixtures (id, championship_id, stage, round_number, player1_id, player2_id, team1_duo_id, team2_duo_id, group_name, bracket_position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const fixture of savedFixtures) {
      fixStmt.run(fixture.id, id, fixture.stage, fixture.round_number, fixture.player1_id, fixture.player2_id, fixture.team1_duo_id ?? null, fixture.team2_duo_id ?? null, fixture.group_name ?? null, fixture.bracket_position ?? null);
    }
    const byeStmt = db.prepare(`
      INSERT INTO knockout_byes (championship_id, round_number, player_id, position)
      VALUES (?, ?, ?, ?)
    `);
    for (const bye of initialByes) {
      byeStmt.run(bye.championship_id, bye.round_number, bye.player_id, bye.position);
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
