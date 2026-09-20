import type Database from "better-sqlite3";
import type { Championship } from "../shared/models";
import { ensureAuthenticated, getSupabase } from "./supabase";

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
 * Salva novo campeonato no SQLite e sincroniza no Supabase
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

  // 1. Salva localmente no SQLite
  db.transaction(() => {
    db.prepare(`
      INSERT INTO championships (id, name, format, mode, mutator, starts_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, payload.format, mode, payload.mutator || null, startsAt, status);

    const partStmt = db.prepare(`
      INSERT INTO championship_participants (championship_id, player_id)
      VALUES (?, ?)
    `);
    for (const playerId of payload.participantIds) {
      partStmt.run(id, playerId);
    }

    const fixStmt = db.prepare(`
      INSERT INTO fixtures (championship_id, stage, round_number, player1_id, player2_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const p = payload.participantIds;
    let roundNum = 1;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        fixStmt.run(id, "league", roundNum, p[i], p[j]);
        roundNum++;
      }
    }
  })();

  // 2. Sincroniza com o Supabase
  const auth = await ensureAuthenticated();
  const supabase = getSupabase();

  if (auth.ok && supabase) {
    try {
      // Inserção do campeonato
      const { error: champErr } = await supabase.from("championships").insert({
        id,
        name,
        format: payload.format,
        mode,
        mutator: payload.mutator || null,
        starts_at: startsAt,
        status,
      });

      if (champErr) {
        console.error(`[championship-service] ❌ Erro ao salvar campeonato no Supabase:`, champErr.message);
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

      // Inserção dos participantes
      const participantsToInsert = payload.participantIds.map((pId) => ({
        championship_id: id,
        player_id: pId,
      }));

      const { error: partErr } = await supabase
        .from("championship_participants")
        .insert(participantsToInsert);

      if (partErr) {
        console.error(`[championship-service] ❌ Erro ao salvar participantes no Supabase:`, partErr.message);
      }

      // Inserção dos confrontos (fixtures)
      const generatedFixtures = db
        .prepare("SELECT * FROM fixtures WHERE championship_id = ?")
        .all(id) as Array<{ id: number; stage: string; round_number: number; player1_id: number; player2_id: number }>;

      if (generatedFixtures.length > 0) {
        const { error: fixErr } = await supabase.from("fixtures").insert(
          generatedFixtures.map((f) => ({
            id: f.id,
            championship_id: id,
            stage: f.stage,
            round_number: f.round_number,
            player1_id: f.player1_id,
            player2_id: f.player2_id,
          }))
        );

        if (fixErr) {
          console.error(`[championship-service] ❌ Erro ao salvar confrontos no Supabase:`, fixErr.message);
        }
      }

      console.info(`[championship-service] ✅ Campeonato ${id} sincronizado com sucesso no Supabase!`);
    } catch (err) {
      console.warn(`[championship-service] Exceção ao sincronizar com Supabase:`, err);
    }
  } else {
    console.warn(`[championship-service] Sincronização ignorada. Auth OK: ${auth.ok}, Motivo: ${auth.message}`);
  }

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