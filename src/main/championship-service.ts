import type Database from "better-sqlite3";
import type { Championship } from "../shared/models";
import { ensureAuthenticated, getSupabase } from "./supabase";

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
export async function getChampionships(db: Database.Database): Promise<Championship[]> {
  const auth = await ensureAuthenticated();
  const supabase = getSupabase();

  if (auth.ok && supabase) {
    try {
      // Usa .select("*") para evitar que o PostgREST confunda a coluna 'mode' com a função SQL mode()
      const { data: remoteChampionships, error } = await supabase
        .from("championships")
        .select("*")
        .order("id", { ascending: false });

      if (error) {
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
  }
): Promise<Championship> {
  const name = payload.name.trim();
  if (!name) throw new Error("Informe o nome do campeonato.");
  if (!payload.participantIds || payload.participantIds.length < 2) {
    throw new Error("Selecione ao menos 2 participantes.");
  }

  const id = Date.now();
  const startsAt = payload.startsAt || new Date().toISOString();
  const mode = payload.mode || "classic";
  const status = payload.status || "draft";

  const auth = await ensureAuthenticated();
  const supabase = getSupabase();
  if (!auth.ok || !supabase) {
    throw new Error("Não foi possível salvar o campeonato. Verifique sua conexão.");
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
  const { error: partErr } = await supabase
    .from("championship_participants")
    .insert(participantsToInsert);
  if (partErr) {
    throw new Error("Não foi possível salvar os participantes. O campeonato pode estar incompleto; confira antes de tentar novamente.");
  }

  const fixtures: Array<{ championship_id: number; stage: string; round_number: number; player1_id: number; player2_id: number }> = [];
  const p = payload.participantIds;
  let roundNum = 1;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      fixtures.push({ championship_id: id, stage: "league", round_number: roundNum, player1_id: p[i], player2_id: p[j] });
      roundNum++;
    }
  }
  const { data: savedFixtures, error: fixErr } = await supabase
    .from("fixtures")
    .insert(fixtures)
    .select("id, stage, round_number, player1_id, player2_id");
  if (fixErr || !savedFixtures || savedFixtures.length !== fixtures.length) {
    throw new Error("Não foi possível salvar os confrontos. O campeonato pode estar incompleto; confira antes de tentar novamente.");
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
    payload.participantIds.forEach((playerId, index) => {
      partStmt.run(id, playerId, payload.participantTeamIds?.[index] ?? null);
    });

    const fixStmt = db.prepare(`
      INSERT INTO fixtures (id, championship_id, stage, round_number, player1_id, player2_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const fixture of savedFixtures) {
      fixStmt.run(fixture.id, id, fixture.stage, fixture.round_number, fixture.player1_id, fixture.player2_id);
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
    participants: payload.participantIds.length,
  };
}
