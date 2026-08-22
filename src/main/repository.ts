import Database from "better-sqlite3";
import fs from "node:fs";

import type {
  Championship,
  Dashboard,
  MatchInput,
  Player,
  Team,
} from "../shared/models";

import { clubRows } from "./clubRows";

const clubs = clubRows.map(([name, league, country]) => ({
  name,
  league,
  country,
}));

export function createDatabase(file: string) {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, nickname TEXT NOT NULL UNIQUE, avatar TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, league TEXT NOT NULL, country TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS championships (id INTEGER PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('league','knockout','groups_knockout')), starts_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE IF NOT EXISTS championship_participants (championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, PRIMARY KEY(championship_id, player_id));
    CREATE TABLE IF NOT EXISTS fixtures (id INTEGER PRIMARY KEY, championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE, round_number INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'league', player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, match_id INTEGER UNIQUE REFERENCES matches(id) ON DELETE SET NULL, UNIQUE(championship_id, player1_id, player2_id));
    CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, team1_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, team2_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, score1 INTEGER NOT NULL CHECK(score1 >= 0), score2 INTEGER NOT NULL CHECK(score2 >= 0), championship_id INTEGER REFERENCES championships(id) ON DELETE SET NULL, played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(player1_id <> player2_id));
    CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches(played_at DESC); CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1_id, player2_id);
  `);
  const fixtureColumns = db.prepare("PRAGMA table_info(fixtures)").all() as {
    name: string;
  }[];
  if (!fixtureColumns.some((column) => column.name === "stage"))
    db.exec(
      "ALTER TABLE fixtures ADD COLUMN stage TEXT NOT NULL DEFAULT 'league'",
    );

  // Migração: remover campo 'rating' da tabela 'teams' se existir
  const teamsColumns = db.prepare("PRAGMA table_info(teams)").all() as {
    name: string;
  }[];
  if (teamsColumns.some((column) => column.name === "rating")) {
    db.exec(`
      CREATE TABLE teams_backup (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, league TEXT NOT NULL, country TEXT NOT NULL);
      INSERT INTO teams_backup SELECT id, name, league, country FROM teams;
      DROP TABLE teams;
      ALTER TABLE teams_backup RENAME TO teams;
    `);
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_fixtures_championship_round ON fixtures(championship_id, round_number)",
  );
   const insert = db.prepare(`
    INSERT INTO teams (name, league, country)
    VALUES (@name, @league, @country)
    ON CONFLICT(name) DO UPDATE SET
      league = excluded.league,
      country = excluded.country
  `);

  const tx = db.transaction(() => {
    clubs.forEach((c) => insert.run(c));
  });

  tx();
  return db;
}

export function repository(db: Database.Database) {
  const leagueFixtures = (playerIds: number[]) => {
    const rotation = [...playerIds];
    if (rotation.length % 2) rotation.push(-1);
    const rounds: Array<Array<[number, number]>> = [];
    const size = rotation.length;
    for (let round = 0; round < size - 1; round++) {
      const games: Array<[number, number]> = [];
      for (let index = 0; index < size / 2; index++) {
        const home = rotation[index];
        const away = rotation[size - 1 - index];
        if (home !== -1 && away !== -1)
          games.push(round % 2 ? [away, home] : [home, away]);
      }
      rounds.push(games);
      rotation.splice(1, 0, rotation.pop()!);
    }
    return rounds;
  };
  const knockoutStage = (playersInRound: number) =>
    ({
      2: "Final",
      4: "Semifinal",
      8: "Quartas de final",
      16: "Oitavas de final",
      32: "Dezesseis-avos",
    })[playersInRound] ?? `Fase de ${playersInRound}`;
  const advanceKnockout = (championshipId: number, completedRound: number) => {
    const current = db
      .prepare(
        `SELECT f.id,f.player1_id player1Id,f.player2_id player2Id,m.score1 score1,m.score2 score2 FROM fixtures f JOIN matches m ON m.id=f.match_id WHERE f.championship_id=? AND f.round_number=? AND f.stage <> 'league' ORDER BY f.id`,
      )
      .all(championshipId, completedRound) as {
      id: number;
      player1Id: number;
      player2Id: number;
      score1: number;
      score2: number;
    }[];
    if (!current.length || current.some((f) => f.score1 === f.score2))
      throw new Error("Partidas eliminatórias não podem terminar empatadas.");
    const total = db
      .prepare(
        `SELECT COUNT(*) count FROM fixtures WHERE championship_id=? AND round_number=? AND stage <> 'league'`,
      )
      .get(championshipId, completedRound) as { count: number };
    if (current.length !== total.count) return;
    if (current.length === 1) {
      db.prepare("UPDATE championships SET status='finished' WHERE id=?").run(
        championshipId,
      );
      return;
    }
    const nextRound = completedRound + 1;
    const exists = db
      .prepare(
        "SELECT 1 FROM fixtures WHERE championship_id=? AND round_number=? LIMIT 1",
      )
      .get(championshipId, nextRound);
    if (exists) return;
    const winners = current.map((f) =>
      f.score1 > f.score2 ? f.player1Id : f.player2Id,
    );
    const insert = db.prepare(
      "INSERT INTO fixtures(championship_id,round_number,stage,player1_id,player2_id) VALUES (?,?,?,?,?)",
    );
    winners.forEach((winner, index) => {
      if (index % 2 === 0)
        insert.run(
          championshipId,
          nextRound,
          knockoutStage(winners.length),
          winner,
          winners[index + 1],
        );
    });
  };
  const rankingSql = `WITH results AS (
    SELECT player1_id player_id, score1 gf, score2 ga FROM matches UNION ALL SELECT player2_id, score2, score1 FROM matches
  ), aggregate AS (SELECT player_id, COUNT(*) played, SUM(gf > ga) wins, SUM(gf = ga) draws, SUM(gf < ga) losses, SUM(gf) goals_for, SUM(ga) goals_against FROM results GROUP BY player_id)
  SELECT p.id,p.name,COALESCE(a.played,0) played,COALESCE(a.wins,0) wins,COALESCE(a.draws,0) draws,COALESCE(a.losses,0) losses,COALESCE(a.goals_for,0) goalsFor,COALESCE(a.goals_against,0) goalsAgainst,COALESCE(a.wins*3+a.draws,0) points,CASE WHEN COALESCE(a.played,0)=0 THEN 0 ELSE ROUND((a.wins*3.0+a.draws)/(a.played*3)*100,1) END winRate,0 streak FROM players p LEFT JOIN aggregate a ON a.player_id=p.id ORDER BY points DESC,(goalsFor-goalsAgainst) DESC,goalsFor DESC,p.name`;
  return {
    players: () =>
      db
        .prepare(
          "SELECT id,name,nickname,avatar,created_at createdAt FROM players ORDER BY name",
        )
        .all() as Player[],
    savePlayer: (p: Partial<Player>) => {
      const name = p.name?.trim(),
        nickname = p.nickname?.trim();
      if (!name || !nickname)
        throw new Error("Nome e apelido são obrigatórios.");
      if (p.id)
        db.prepare(
          "UPDATE players SET name=?,nickname=?,avatar=? WHERE id=?",
        ).run(name, nickname, p.avatar ?? null, p.id);
      else
        p.id = Number(
          db
            .prepare("INSERT INTO players(name,nickname,avatar) VALUES (?,?,?)")
            .run(name, nickname, p.avatar ?? null).lastInsertRowid,
        );
      return db
        .prepare(
          "SELECT id,name,nickname,avatar,created_at createdAt FROM players WHERE id=?",
        )
        .get(p.id) as Player;
    },
    deletePlayer: (id: number) => {
      db.prepare("DELETE FROM players WHERE id=?").run(id);
    },
    teams: (q = "") =>
      db
        .prepare(
          `SELECT id,name,league,country FROM teams WHERE name LIKE ? OR league LIKE ? OR country LIKE ? ORDER BY name`,
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`) as Team[],
    saveMatch: (m: MatchInput) => {
      const championshipId = m.championshipId ? Number(m.championshipId) : null;

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
      }

      const save = db.transaction(() => {
        let fixture: { id: number; round: number; stage: string } | undefined;
        if (championshipId !== null) {
          fixture = db
            .prepare(
              "SELECT id,round_number round,stage FROM fixtures WHERE championship_id=? AND match_id IS NULL AND ((player1_id=? AND player2_id=?) OR (player1_id=? AND player2_id=?))",
            )
            .get(
              championshipId,
              m.player1Id,
              m.player2Id,
              m.player2Id,
              m.player1Id,
            ) as { id: number; round: number; stage: string } | undefined;
          if (!fixture)
            throw new Error(
              "Este confronto não está pendente neste campeonato.",
            );
          if (fixture.stage !== "league" && m.score1 === m.score2)
            throw new Error(
              "No mata-mata informe um vencedor; empates não são permitidos.",
            );
        }
        const info = db
          .prepare(
            "INSERT INTO matches(player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            m.player1Id,
            m.player2Id,
            m.team1Id,
            m.team2Id,
            m.score1,
            m.score2,
            championshipId,
            m.playedAt ?? new Date().toISOString(),
          );
        const id = Number(info.lastInsertRowid);
        if (fixture) {
          db.prepare("UPDATE fixtures SET match_id=? WHERE id=?").run(
            id,
            fixture.id,
          );
          if (fixture.stage !== "league")
            advanceKnockout(championshipId!, fixture.round);
        }
        return id;
      });
      return save();
    },
    updateMatch: (m: MatchInput & { id: number }) => {
      const championshipId = m.championshipId ? Number(m.championshipId) : null;

      if (!m.id || !m.player1Id || !m.player2Id || !m.team1Id || !m.team2Id)
        throw new Error("Selecione os dois jogadores e os dois times.");

      if (m.player1Id === m.player2Id || m.team1Id === m.team2Id)
        throw new Error("Escolha jogadores e times diferentes.");

      const player1Exists = db.prepare("SELECT 1 FROM players WHERE id=?").get(m.player1Id);
      const player2Exists = db.prepare("SELECT 1 FROM players WHERE id=?").get(m.player2Id);
      const team1Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team1Id);
      const team2Exists = db.prepare("SELECT 1 FROM teams WHERE id=?").get(m.team2Id);

      if (!player1Exists || !player2Exists)
        throw new Error("Um dos jogadores selecionados não existe.");
      if (!team1Exists || !team2Exists)
        throw new Error("Um dos times selecionados não existe.");

      if (championshipId !== null) {
        const championshipExists = db.prepare("SELECT 1 FROM championships WHERE id=?").get(championshipId);
        if (!championshipExists)
          throw new Error("O campeonato selecionado não existe.");
      }

      const existing = db.prepare("SELECT id FROM matches WHERE id=?").get(m.id);
      if (!existing) throw new Error("Partida não encontrada.");

      db.prepare(
        `UPDATE matches
         SET player1_id=?, player2_id=?, team1_id=?, team2_id=?,
             score1=?, score2=?, championship_id=?, played_at=?
         WHERE id=?`,
      ).run(
        m.player1Id,
        m.player2Id,
        m.team1Id,
        m.team2Id,
        m.score1,
        m.score2,
        championshipId,
        m.playedAt ?? new Date().toISOString(),
        m.id,
      );

      return m.id;
    },
    clearMatches: () => {
      db.prepare("DELETE FROM matches").run();
    },
    matches: () =>
      db
        .prepare(
          `SELECT m.id,m.played_at playedAt,m.player1_id player1Id,m.player2_id player2Id,p1.name player1,p2.name player2,t1.name team1,t2.name team2,m.score1 score1,m.score2 score2,c.name championship FROM matches m JOIN players p1 ON p1.id=m.player1_id JOIN players p2 ON p2.id=m.player2_id JOIN teams t1 ON t1.id=m.team1_id JOIN teams t2 ON t2.id=m.team2_id LEFT JOIN championships c ON c.id=m.championship_id ORDER BY m.played_at DESC`,
        )
        .all(),
    ranking: () => db.prepare(rankingSql).all(),
    dashboard: (): Dashboard => {
      const ranking = db.prepare(rankingSql).all() as Dashboard["ranking"];
      const recent = db
        .prepare(
          `SELECT m.id,m.played_at playedAt,p1.name player1,p2.name player2,t1.name team1,t2.name team2,m.score1 score1,m.score2 score2 FROM matches m JOIN players p1 ON p1.id=m.player1_id JOIN players p2 ON p2.id=m.player2_id JOIN teams t1 ON t1.id=m.team1_id JOIN teams t2 ON t2.id=m.team2_id ORDER BY m.played_at DESC LIMIT 5`,
        )
        .all() as Dashboard["recent"];
      const used = db
        .prepare(
          `SELECT t.name FROM (SELECT team1_id team_id FROM matches UNION ALL SELECT team2_id FROM matches) u JOIN teams t ON t.id=u.team_id GROUP BY t.id ORDER BY COUNT(*) DESC,t.name LIMIT 1`,
        )
        .get() as { name?: string } | undefined;
      return {
        players: Number(
          (
            db.prepare("SELECT COUNT(*) count FROM players").get() as {
              count: number;
            }
          ).count,
        ),
        matches: Number(
          (
            db.prepare("SELECT COUNT(*) count FROM matches").get() as {
              count: number;
            }
          ).count,
        ),
        leader: ranking[0],
        mostUsedTeam: used?.name,
        recent,
        ranking: ranking.slice(0, 5),
      };
    },
    championships: () =>
      db
        .prepare(
          `SELECT c.id,c.name,c.format,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id GROUP BY c.id ORDER BY c.starts_at DESC`,
        )
        .all() as Championship[],
    championshipDetail: (id: number) => {
      const championship = db
        .prepare(
          `SELECT c.id,c.name,c.format,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id WHERE c.id=? GROUP BY c.id`,
        )
        .get(id) as Championship | undefined;
      if (!championship) throw new Error("Campeonato não encontrado.");
      const standing = db
        .prepare(
          `WITH results AS (SELECT player1_id player_id,score1 gf,score2 ga FROM matches WHERE championship_id=? UNION ALL SELECT player2_id,score2,score1 FROM matches WHERE championship_id=?), aggregate AS (SELECT player_id,COUNT(*) played,SUM(gf>ga) wins,SUM(gf=ga) draws,SUM(gf<ga) losses,SUM(gf) goals_for,SUM(ga) goals_against FROM results GROUP BY player_id) SELECT p.id,p.name,COALESCE(a.played,0) played,COALESCE(a.wins,0) wins,COALESCE(a.draws,0) draws,COALESCE(a.losses,0) losses,COALESCE(a.goals_for,0) goalsFor,COALESCE(a.goals_against,0) goalsAgainst,COALESCE(a.wins*3+a.draws,0) points,CASE WHEN COALESCE(a.played,0)=0 THEN 0 ELSE ROUND((a.wins*3.0+a.draws)/(a.played*3)*100,1) END winRate,0 streak FROM championship_participants cp JOIN players p ON p.id=cp.player_id LEFT JOIN aggregate a ON a.player_id=p.id WHERE cp.championship_id=? ORDER BY points DESC,(goalsFor-goalsAgainst) DESC,goalsFor DESC,p.name`,
        )
        .all(id, id, id);
      const fixtures = db
        .prepare(
          `SELECT f.id,f.round_number round,f.stage,f.player1_id player1Id,f.player2_id player2Id,p1.name player1,p2.name player2,f.match_id matchId,m.score1 score1,m.score2 score2 FROM fixtures f JOIN players p1 ON p1.id=f.player1_id JOIN players p2 ON p2.id=f.player2_id LEFT JOIN matches m ON m.id=f.match_id WHERE f.championship_id=? ORDER BY f.round_number,f.id`,
        )
        .all(id);
      return { championship, standing, fixtures };
    },
    saveChampionship: (
      c: Omit<Championship, "id" | "participants"> & {
        participantIds: number[];
      },
    ) => {
      if (!c.name.trim() || c.participantIds.length < 2)
        throw new Error("Informe nome e pelo menos dois participantes.");
      if (c.format === "groups_knockout")
        throw new Error(
          "Grupos + mata-mata será disponibilizado na próxima etapa.",
        );
      if (
        c.format === "knockout" &&
        ![2, 4, 8, 16, 32].includes(c.participantIds.length)
      )
        throw new Error("O mata-mata exige 2, 4, 8, 16 ou 32 participantes.");
      const tx = db.transaction(() => {
        const id = Number(
          db
            .prepare(
              "INSERT INTO championships(name,format,starts_at,status) VALUES (?,?,?,?)",
            )
            .run(c.name.trim(), c.format, c.startsAt, "active").lastInsertRowid,
        );
        const add = db.prepare(
          "INSERT INTO championship_participants(championship_id,player_id) VALUES (?,?)",
        );
        c.participantIds.forEach((player) => add.run(id, player));
        const fixture = db.prepare(
          "INSERT INTO fixtures(championship_id,round_number,stage,player1_id,player2_id) VALUES (?,?,?,?,?)",
        );
        if (c.format === "league")
          leagueFixtures(c.participantIds).forEach((round, index) =>
            round.forEach(([p1, p2]) =>
              fixture.run(id, index + 1, "league", p1, p2),
            ),
          );
        else {
          const firstStage = knockoutStage(c.participantIds.length);
          for (let index = 0; index < c.participantIds.length; index += 2)
            fixture.run(
              id,
              1,
              firstStage,
              c.participantIds[index],
              c.participantIds[index + 1],
            );
        }
        return id;
      });
      const id = tx();
      return db
        .prepare(
          `SELECT c.id,c.name,c.format,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id WHERE c.id=? GROUP BY c.id`,
        )
        .get(id) as Championship;
    },
    backup: (destination: string) => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(db.name, destination);
      return destination;
    },
    restore: (source: string) => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      const destination = db.name;
      db.close();
      fs.copyFileSync(source, destination);
    },
  };
}