import Database from "better-sqlite3";
import fs from "node:fs";

import type {
  Championship,
  Dashboard,
  GameRulesSettings,
  MatchInput,
  Player,
  StatisticsDashboard,
  Standing,
  Team,
} from "../shared/models";

import { clubRows } from "./clubRows";

const clubs = clubRows.map(([name, league, country]) => ({
  name,
  league,
  country,
}));

const defaultGameRules: GameRulesSettings = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  minimumBestFormMatches: 3,
};

export function createDatabase(file: string) {
  const db = new Database(file);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, nickname TEXT NOT NULL UNIQUE, avatar TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, league TEXT NOT NULL, country TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS championships (id INTEGER PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('league','knockout','groups_knockout')), mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic','duo','mad')), mutator TEXT, starts_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
    CREATE TABLE IF NOT EXISTS championship_participants (championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, team_id INTEGER REFERENCES teams(id) ON DELETE RESTRICT, PRIMARY KEY(championship_id, player_id));
    CREATE TABLE IF NOT EXISTS fixtures (id INTEGER PRIMARY KEY, championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE, round_number INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'league', player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, match_id INTEGER UNIQUE REFERENCES matches(id) ON DELETE SET NULL, UNIQUE(championship_id, player1_id, player2_id));
    CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY, player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT, team1_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, team2_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE RESTRICT, score1 INTEGER NOT NULL CHECK(score1 >= 0), score2 INTEGER NOT NULL CHECK(score2 >= 0), championship_id INTEGER REFERENCES championships(id) ON DELETE SET NULL, played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK(player1_id <> player2_id));
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches(played_at DESC); CREATE INDEX IF NOT EXISTS idx_matches_players ON matches(player1_id, player2_id);
  `);
  const defaultSettings = db.prepare(
    "INSERT OR IGNORE INTO app_settings(key,value) VALUES (?,?)",
  );
  Object.entries(defaultGameRules).forEach(([key, value]) =>
    defaultSettings.run(key, String(value)),
  );
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

  // Migração (UX pós-Etapa 4): championships ganha "mode" (classic/duo/mad) e
  // "mutator" (título do desafio do modo maluco). Bancos antigos recebem as
  // colunas via ALTER com default 'classic' — os campeonatos existentes
  // nasceram antes da distinção de modos. O CHECK de mode vale para bancos
  // novos (CREATE acima); em bancos migrados a validação acontece no
  // saveChampionship.
  const championshipColumns = db
    .prepare("PRAGMA table_info(championships)")
    .all() as {
    name: string;
  }[];
  if (!championshipColumns.some((column) => column.name === "mode"))
    db.exec(
      "ALTER TABLE championships ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic'",
    );
  if (!championshipColumns.some((column) => column.name === "mutator"))
    db.exec("ALTER TABLE championships ADD COLUMN mutator TEXT");

  // Migração: championship_participants ganha "team_id" — o time escolhido
  // para cada participante passa a ser persistido (antes só existia como
  // estado transitório de UI, nunca salvo, e por isso "esquecido" ao
  // registrar o resultado). Nullable/guardada: campeonatos já existentes
  // ficam com team_id NULL até o usuário reatribuir, sem quebrar nada.
  const participantColumns = db
    .prepare("PRAGMA table_info(championship_participants)")
    .all() as {
    name: string;
  }[];
  if (!participantColumns.some((column) => column.name === "team_id"))
    db.exec(
      "ALTER TABLE championship_participants ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE RESTRICT",
    );

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
  const validateGameRules = (settings: GameRulesSettings) => {
    const pointValues = [
      settings.pointsWin,
      settings.pointsDraw,
      settings.pointsLoss,
    ];
    if (pointValues.some((value) => !Number.isInteger(value) || value < 0))
      throw new Error("Os pontos devem ser inteiros maiores ou iguais a zero.");
    if (
      !Number.isInteger(settings.minimumBestFormMatches) ||
      settings.minimumBestFormMatches < 1
    )
      throw new Error(
        "O mínimo da melhor forma deve ser um inteiro maior que zero.",
      );
    return settings;
  };
  const gameRules = (): GameRulesSettings => {
    const rows = db
      .prepare("SELECT key,value FROM app_settings")
      .all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, Number(row.value)]));
    return validateGameRules({
      pointsWin: values.get("pointsWin") ?? defaultGameRules.pointsWin,
      pointsDraw: values.get("pointsDraw") ?? defaultGameRules.pointsDraw,
      pointsLoss: values.get("pointsLoss") ?? defaultGameRules.pointsLoss,
      minimumBestFormMatches:
        values.get("minimumBestFormMatches") ??
        defaultGameRules.minimumBestFormMatches,
    });
  };
  const pointsExpression = (settings: GameRulesSettings, alias = "a") =>
    `(COALESCE(${alias}.wins,0)*${settings.pointsWin}+COALESCE(${alias}.draws,0)*${settings.pointsDraw}+COALESCE(${alias}.losses,0)*${settings.pointsLoss})`;
  const winRateExpression = (alias = "a") =>
    `CASE WHEN COALESCE(${alias}.played,0)=0 THEN 0 ELSE ROUND(COALESCE(${alias}.wins,0)*100.0/${alias}.played,1) END`;
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
  const rankingSql = (settings: GameRulesSettings) => `WITH results AS (
    SELECT player1_id player_id, score1 gf, score2 ga FROM matches UNION ALL SELECT player2_id, score2, score1 FROM matches
  ), aggregate AS (SELECT player_id, COUNT(*) played, SUM(gf > ga) wins, SUM(gf = ga) draws, SUM(gf < ga) losses, SUM(gf) goals_for, SUM(ga) goals_against FROM results GROUP BY player_id)
  SELECT p.id,p.name,COALESCE(a.played,0) played,COALESCE(a.wins,0) wins,COALESCE(a.draws,0) draws,COALESCE(a.losses,0) losses,COALESCE(a.goals_for,0) goalsFor,COALESCE(a.goals_against,0) goalsAgainst,${pointsExpression(settings)} points,${winRateExpression()} winRate,0 streak FROM players p LEFT JOIN aggregate a ON a.player_id=p.id ORDER BY points DESC,(goalsFor-goalsAgainst) DESC,goalsFor DESC,p.name`;
  const championshipRankingSql = (settings: GameRulesSettings) =>
    `WITH results AS (SELECT player1_id player_id,score1 gf,score2 ga FROM matches WHERE championship_id=? UNION ALL SELECT player2_id,score2,score1 FROM matches WHERE championship_id=?), aggregate AS (SELECT player_id,COUNT(*) played,SUM(gf>ga) wins,SUM(gf=ga) draws,SUM(gf<ga) losses,SUM(gf) goals_for,SUM(ga) goals_against FROM results GROUP BY player_id) SELECT p.id,p.name,COALESCE(a.played,0) played,COALESCE(a.wins,0) wins,COALESCE(a.draws,0) draws,COALESCE(a.losses,0) losses,COALESCE(a.goals_for,0) goalsFor,COALESCE(a.goals_against,0) goalsAgainst,${pointsExpression(settings)} points,${winRateExpression()} winRate,0 streak FROM championship_participants cp JOIN players p ON p.id=cp.player_id LEFT JOIN aggregate a ON a.player_id=p.id WHERE cp.championship_id=? ORDER BY points DESC,(goalsFor-goalsAgainst) DESC,goalsFor DESC,p.name`;
  const withStreaks = (rows: Standing[]) =>
    (() => {
      const games = db
        .prepare(
          "SELECT player1_id player1Id,player2_id player2Id,score1,score2 FROM matches ORDER BY played_at DESC,id DESC",
        )
        .all() as Array<{
        player1Id: number;
        player2Id: number;
        score1: number;
        score2: number;
      }>;
      const active = new Map<number, boolean>();
      const streaks = new Map<number, number>();
      for (const game of games) {
        for (const playerId of [game.player1Id, game.player2Id]) {
          if (!active.has(playerId)) {
            active.set(playerId, true);
            streaks.set(playerId, 0);
          }
          if (!active.get(playerId)) continue;
          const won =
            game.player1Id === playerId
              ? game.score1 > game.score2
              : game.score2 > game.score1;
          if (won) streaks.set(playerId, (streaks.get(playerId) ?? 0) + 1);
          else active.set(playerId, false);
        }
      }
      return rows.map((row) => ({
        ...row,
        streak: streaks.get(row.id) ?? 0,
      }));
    })();
  const statisticsDashboard = (): StatisticsDashboard => {
    const settings = gameRules();
    const ranking = withStreaks(
      db.prepare(rankingSql(settings)).all() as Standing[],
    );
    const playedRows = ranking.filter((row) => row.played > 0);
    const bestForm = db
      .prepare(
        `WITH player_matches AS (
          SELECT id, played_at, player1_id player_id, score1 gf, score2 ga FROM matches
          UNION ALL
          SELECT id, played_at, player2_id, score2, score1 FROM matches
        ), recent AS (
          SELECT player_id, gf, ga,
            ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY played_at DESC, id DESC) position
          FROM player_matches
        )
        SELECT p.id, p.name, COUNT(r.player_id) games,
          SUM(CASE WHEN r.gf > r.ga THEN 1 ELSE 0 END) wins,
          ROUND(SUM(CASE WHEN r.gf > r.ga THEN 1 ELSE 0 END) * 100.0 / COUNT(r.player_id), 2) winRate
        FROM players p
        LEFT JOIN recent r ON r.player_id = p.id AND r.position <= 5
        GROUP BY p.id, p.name
        HAVING COUNT(r.player_id) >= ${settings.minimumBestFormMatches}
        ORDER BY winRate DESC, wins DESC, games DESC, p.name
        LIMIT 1`,
      )
      .get() as
      | {
          id: number;
          name: string;
          games: number;
          wins: number;
          winRate: number;
        }
      | undefined;
    const recent = db
      .prepare(
        `SELECT m.id,m.played_at playedAt,p1.name player1,p2.name player2,t1.name team1,t2.name team2,m.score1 score1,m.score2 score2 FROM matches m JOIN players p1 ON p1.id=m.player1_id JOIN players p2 ON p2.id=m.player2_id JOIN teams t1 ON t1.id=m.team1_id JOIN teams t2 ON t2.id=m.team2_id ORDER BY m.played_at DESC LIMIT 5`,
      )
      .all() as Dashboard["recent"];
    const topScorer = [...playedRows].sort(
      (a, b) => b.goalsFor - a.goalsFor || a.name.localeCompare(b.name),
    )[0];
    const bestGoalDifference = [...playedRows].sort(
      (a, b) =>
        b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name),
    )[0];
    const mostPlayedPlayer = [...playedRows].sort(
      (a, b) =>
        b.played - a.played ||
        b.goalsFor - a.goalsFor ||
        a.name.localeCompare(b.name),
    )[0];
    const mostUsedClub = db
      .prepare(
        `SELECT t.name, COUNT(*) count FROM (SELECT team1_id team_id FROM matches UNION ALL SELECT team2_id FROM matches) u JOIN teams t ON t.id=u.team_id GROUP BY t.id ORDER BY COUNT(*) DESC, t.name LIMIT 1`,
      )
      .get() as { name: string; count: number } | undefined;
    const bestWinRate = [...playedRows].sort(
      (a, b) => b.winRate - a.winRate || b.points - a.points,
    )[0];
    const championships = db
      .prepare(
        "SELECT id, name, starts_at startsAt, status FROM championships WHERE status='finished' ORDER BY starts_at DESC, id DESC",
      )
      .all() as Array<{
      id: number;
      name: string;
      startsAt: string;
      status: string;
    }>;
    const lastChampion = championships.length
      ? (() => {
          const current = championships[0];
          const champion =
            current.status === "finished" &&
            (db
              .prepare(
                "SELECT p.name FROM fixtures f JOIN matches m ON m.id=f.match_id JOIN players p ON p.id=CASE WHEN m.score1 > m.score2 THEN f.player1_id ELSE f.player2_id END WHERE f.championship_id=? AND f.stage <> 'league' AND f.round_number=(SELECT MAX(round_number) FROM fixtures WHERE championship_id=? AND stage <> 'league') AND m.score1 <> m.score2 LIMIT 1",
              )
              .get(current.id, current.id) as { name: string } | undefined);
          const title = champion
            ? champion
            : (db
                .prepare(
                  `WITH results AS (SELECT player1_id player_id,score1 gf,score2 ga FROM matches WHERE championship_id=? UNION ALL SELECT player2_id,score2,score1 FROM matches WHERE championship_id=?), aggregate AS (SELECT player_id,COUNT(*) played,SUM(gf>ga) wins,SUM(gf=ga) draws,SUM(gf<ga) losses,SUM(gf) goals_for,SUM(ga) goals_against FROM results GROUP BY player_id) SELECT p.name FROM championship_participants cp JOIN players p ON p.id=cp.player_id LEFT JOIN aggregate a ON a.player_id=p.id WHERE cp.championship_id=? ORDER BY ${pointsExpression(settings)} DESC,(COALESCE(a.goals_for,0)-COALESCE(a.goals_against,0)) DESC,COALESCE(a.goals_for,0) DESC,p.name LIMIT 1`,
                )
                .get(current.id, current.id, current.id) as
                | { name: string }
                | undefined);
          return title
            ? {
                championshipName: current.name,
                championName: title.name,
                playedAt: current.startsAt,
              }
            : null;
        })()
      : null;
    const historicalMatches = db
      .prepare(
        "SELECT id, substr(played_at,1,10) date, player1_id player1Id, player2_id player2Id, score1, score2 FROM matches ORDER BY played_at ASC, id ASC",
      )
      .all() as Array<{
      id: number;
      date: string;
      player1Id: number;
      player2Id: number;
      score1: number;
      score2: number;
    }>;
    const rankingTrend = playedRows.slice(0, 5).map((player) => {
      const series: Array<{ date: string; position: number }> = [];
      const aggregate = new Map<
        number,
        {
          played: number;
          wins: number;
          draws: number;
          losses: number;
          goalsFor: number;
          goalsAgainst: number;
        }
      >();
      for (const match of historicalMatches) {
        [match.player1Id, match.player2Id].forEach((playerId) => {
          if (!aggregate.has(playerId))
            aggregate.set(playerId, {
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
            });
          const row = aggregate.get(playerId)!;
          row.played += 1;
          const isPlayer1 = match.player1Id === playerId;
          const goalsFor = isPlayer1 ? match.score1 : match.score2;
          const goalsAgainst = isPlayer1 ? match.score2 : match.score1;
          const outcome =
            goalsFor > goalsAgainst ? 1 : goalsFor < goalsAgainst ? -1 : 0;
          row.goalsFor += goalsFor;
          row.goalsAgainst += goalsAgainst;
          if (outcome > 0) row.wins += 1;
          else if (outcome === 0) row.draws += 1;
          else row.losses += 1;
        });
        const standings = Array.from(aggregate.entries())
          .map(([id, stats]) => ({
            id,
            name: ranking.find((row) => row.id === id)?.name ?? "",
            points:
              stats.wins * settings.pointsWin +
              stats.draws * settings.pointsDraw +
              stats.losses * settings.pointsLoss,
            goalsFor: stats.goalsFor,
            goalsAgainst: stats.goalsAgainst,
          }))
          .sort((a, b) =>
            b.points - a.points ||
            b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
            b.goalsFor - a.goalsFor ||
            a.name < b.name
              ? -1
              : a.name > b.name
                ? 1
                : 0,
          );
        if (standings.some((entry) => entry.id === player.id))
          series.push({
            date: match.date,
            position:
              standings.findIndex((entry) => entry.id === player.id) + 1,
          });
      }
      return { playerId: player.id, name: player.name, points: series };
    });
    const goalTrend = (() => {
      const sums = new Map<
        string,
        { goalsFor: number; goalsAgainst: number }
      >();
      historicalMatches.forEach((match) => {
        const current = sums.get(match.date) ?? {
          goalsFor: 0,
          goalsAgainst: 0,
        };
        current.goalsFor += match.score1;
        current.goalsAgainst += match.score2;
        sums.set(match.date, current);
      });
      return Array.from(sums.entries())
        .map(([date, value]) => ({ date, ...value }))
        .sort((a, b) => a.date.localeCompare(b.date));
    })();
    return {
      bestForm: bestForm
        ? {
            id: bestForm.id,
            name: bestForm.name,
            value: bestForm.winRate,
            detail: `${bestForm.winRate}% em ${bestForm.games} jogos`,
          }
        : null,
      topScorer: topScorer
        ? {
            id: topScorer.id,
            name: topScorer.name,
            value: topScorer.goalsFor,
            detail: `${topScorer.goalsFor} gols`,
          }
        : null,
      bestGoalDifference: bestGoalDifference
        ? {
            id: bestGoalDifference.id,
            name: bestGoalDifference.name,
            value:
              bestGoalDifference.goalsFor - bestGoalDifference.goalsAgainst,
            detail: `Saldo ${bestGoalDifference.goalsFor - bestGoalDifference.goalsAgainst}`,
          }
        : null,
      mostPlayedPlayer: mostPlayedPlayer
        ? {
            id: mostPlayedPlayer.id,
            name: mostPlayedPlayer.name,
            value: mostPlayedPlayer.played,
            detail: `${mostPlayedPlayer.played} partidas`,
          }
        : null,
      mostUsedClub: mostUsedClub
        ? { name: mostUsedClub.name, count: mostUsedClub.count }
        : null,
      bestWinRate: bestWinRate
        ? {
            id: bestWinRate.id,
            name: bestWinRate.name,
            value: Number(bestWinRate.winRate),
            detail: `${bestWinRate.winRate}%`,
          }
        : null,
      lastFiveMatches: recent,
      streaks: ranking.map((row) => ({
        playerId: row.id,
        name: row.name,
        streak: row.streak,
      })),
      rankingTrend,
      goalTrend,
      lastChampion,
    };
  };
  return {
    gameRules,
    saveGameRules: (settings: GameRulesSettings) => {
      const validSettings = validateGameRules(settings);
      const save = db.prepare(
        "INSERT INTO app_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      );
      db.transaction(() => {
        Object.entries(validSettings).forEach(([key, value]) =>
          save.run(key, String(value)),
        );
      })();
      return gameRules();
    },
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
      const deletePlayerTransaction = db.transaction(() => {
        const player = db
          .prepare("SELECT id FROM players WHERE id = ?")
          .get(id) as { id: number } | undefined;

        if (!player) {
          throw new Error("Jogador não encontrado.");
        }

        // Remove as partidas relacionadas ao jogador.
        // O match_id das fixtures será automaticamente definido como NULL
        // por causa do ON DELETE SET NULL.
        db.prepare(
          `
      DELETE FROM matches
      WHERE player1_id = ? OR player2_id = ?
    `,
        ).run(id, id);

        // Remove os confrontos/fixtures do jogador.
        db.prepare(
          `
      DELETE FROM fixtures
      WHERE player1_id = ? OR player2_id = ?
    `,
        ).run(id, id);

        // Remove a participação do jogador nos campeonatos.
        db.prepare(
          `
      DELETE FROM championship_participants
      WHERE player_id = ?
    `,
        ).run(id);

        // Finalmente remove o jogador.
        const result = db.prepare("DELETE FROM players WHERE id = ?").run(id);

        if (result.changes === 0) {
          throw new Error("Não foi possível excluir o jogador.");
        }
      });

      deletePlayerTransaction();

      return true;
    },
    teams: (q = "") =>
      db
        .prepare(
          `SELECT id,name,league,country FROM teams WHERE name LIKE ? OR league LIKE ? OR country LIKE ? ORDER BY name`,
        )
        .all(`%${q}%`, `%${q}%`, `%${q}%`) as Team[],
    deleteMatch: (id: number) => {
      const result = db.prepare("DELETE FROM matches WHERE id=?").run(id);
      if (!result.changes) throw new Error("Partida não encontrada.");
    },
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
    .prepare(
      "SELECT id, championship_id FROM matches WHERE id=?",
    )
    .get(m.id) as
    | { id: number; championship_id: number | null }
    | undefined;

  if (!existing)
    throw new Error("Partida não encontrada.");

  const championshipId = existing.championship_id;

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
          `
      SELECT
        m.id,
        m.played_at AS playedAt,

        m.player1_id AS player1Id,
        m.player2_id AS player2Id,

        m.team1_id AS team1Id,
        m.team2_id AS team2Id,

        m.score1 AS score1,
        m.score2 AS score2,

        p1.name AS player1,
        p2.name AS player2,

        t1.name AS team1,
        t2.name AS team2,

        m.championship_id AS championshipId,
        c.name AS championship

      FROM matches m

      JOIN players p1 ON p1.id = m.player1_id
      JOIN players p2 ON p2.id = m.player2_id

      JOIN teams t1 ON t1.id = m.team1_id
      JOIN teams t2 ON t2.id = m.team2_id

      LEFT JOIN championships c
        ON c.id = m.championship_id

      ORDER BY m.played_at DESC`,
        )
        .all(),
    ranking: () =>
      withStreaks(db.prepare(rankingSql(gameRules())).all() as Standing[]),
    dashboard: (): Dashboard => {
      const ranking = withStreaks(
        db.prepare(rankingSql(gameRules())).all() as Dashboard["ranking"],
      );
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
        statistics: statisticsDashboard(),
      };
    },
    statisticsDashboard,
    championships: () =>
      db
        .prepare(
          `SELECT c.id,c.name,c.format,c.mode,c.mutator,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id GROUP BY c.id ORDER BY c.starts_at DESC`,
        )
        .all() as Championship[],
    championshipDetail: (id: number) => {
      const championship = db
        .prepare(
          `SELECT c.id,c.name,c.format,c.mode,c.mutator,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id WHERE c.id=? GROUP BY c.id`,
        )
        .get(id) as Championship | undefined;
      if (!championship) throw new Error("Campeonato não encontrado.");
      const standing = db
        .prepare(championshipRankingSql(gameRules()))
        .all(id, id, id);
      const fixtures = db
        .prepare(
          `SELECT f.id,f.round_number round,f.stage,f.player1_id player1Id,f.player2_id player2Id,p1.name player1,p2.name player2,f.match_id matchId,m.score1 score1,m.score2 score2,cp1.team_id team1Id,t1.name team1,cp2.team_id team2Id,t2.name team2 FROM fixtures f JOIN players p1 ON p1.id=f.player1_id JOIN players p2 ON p2.id=f.player2_id LEFT JOIN matches m ON m.id=f.match_id LEFT JOIN championship_participants cp1 ON cp1.championship_id=f.championship_id AND cp1.player_id=f.player1_id LEFT JOIN teams t1 ON t1.id=cp1.team_id LEFT JOIN championship_participants cp2 ON cp2.championship_id=f.championship_id AND cp2.player_id=f.player2_id LEFT JOIN teams t2 ON t2.id=cp2.team_id WHERE f.championship_id=? ORDER BY f.round_number,f.id`,
        )
        .all(id);
      return { championship, standing, fixtures };
    },
    saveChampionship: (
      c: Omit<Championship, "id" | "participants"> & {
        participantIds: number[];
        // Time escolhido para cada participante (mesma ordem/índice de
        // participantIds). Persistido em championship_participants.team_id
        // — antes disso só existia como estado de UI, nunca salvo, por
        // isso o time "sumia" ao registrar o resultado.
        participantTeamIds?: (number | null)[];
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
      const teamIds = c.participantTeamIds ?? [];
      // Times duplicados entre participantes são bloqueados (decisão
      // aprovada): cada jogador precisa de um time exclusivo no campeonato.
      const assignedTeamIds = teamIds.filter(
        (teamId): teamId is number => typeof teamId === "number",
      );
      const duplicateTeamIds = assignedTeamIds.filter(
        (teamId, index) => assignedTeamIds.indexOf(teamId) !== index,
      );
      if (duplicateTeamIds.length)
        throw new Error(
          "Cada participante precisa de um time diferente — há times repetidos.",
        );
      const mode = c.mode === "duo" || c.mode === "mad" ? c.mode : "classic";
      const mutator =
        mode === "mad" && typeof c.mutator === "string" && c.mutator.trim()
          ? c.mutator.trim().slice(0, 80)
          : null;
      const tx = db.transaction(() => {
        const id = Number(
          db
            .prepare(
              "INSERT INTO championships(name,format,mode,mutator,starts_at,status) VALUES (?,?,?,?,?,?)",
            )
            .run(c.name.trim(), c.format, mode, mutator, c.startsAt, "active")
            .lastInsertRowid,
        );
        const add = db.prepare(
          "INSERT INTO championship_participants(championship_id,player_id,team_id) VALUES (?,?,?)",
        );
        c.participantIds.forEach((player, index) =>
          add.run(id, player, teamIds[index] ?? null),
        );
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
          `SELECT c.id,c.name,c.format,c.mode,c.mutator,c.starts_at startsAt,c.status,COUNT(cp.player_id) participants FROM championships c LEFT JOIN championship_participants cp ON cp.championship_id=c.id WHERE c.id=? GROUP BY c.id`,
        )
        .get(id) as Championship;
    },
    resetArena: () => {
      db.transaction(() => {
        db.exec(
          "DELETE FROM matches; DELETE FROM fixtures; DELETE FROM championship_participants; DELETE FROM championships; DELETE FROM players;",
        );
      })();
    },
    deleteChampionship: (id: number) => {
      const result = db.prepare("DELETE FROM championships WHERE id=?").run(id);
      if (!result.changes) throw new Error("Campeonato não encontrado.");
    },
    exportArena: () => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      players: db.prepare("SELECT * FROM players").all(),
      teams: db.prepare("SELECT * FROM teams").all(),
      championships: db.prepare("SELECT * FROM championships").all(),
      participants: db.prepare("SELECT * FROM championship_participants").all(),
      fixtures: db.prepare("SELECT * FROM fixtures").all(),
      matches: db.prepare("SELECT * FROM matches").all(),
    }),
    importArena: (data: Record<string, unknown>) => {
      const rows = (key: string) =>
        Array.isArray(data[key])
          ? (data[key] as Record<string, unknown>[])
          : [];
      if (!Array.isArray(data.players) || !Array.isArray(data.matches))
        throw new Error("Arquivo de backup inválido.");
      db.transaction(() => {
        db.exec(
          "DELETE FROM matches; DELETE FROM fixtures; DELETE FROM championship_participants; DELETE FROM championships; DELETE FROM players; DELETE FROM teams;",
        );
        const insert = (sql: string, values: Record<string, unknown>[]) => {
          const statement = db.prepare(sql);
          values.forEach((value) => statement.run(value));
        };
        insert(
          "INSERT INTO teams(id,name,league,country) VALUES (@id,@name,@league,@country)",
          rows("teams"),
        );
        insert(
          "INSERT INTO players(id,name,nickname,avatar,created_at) VALUES (@id,@name,@nickname,@avatar,@created_at)",
          rows("players"),
        );
        insert(
          "INSERT INTO championships(id,name,format,starts_at,status,mode,mutator) VALUES (@id,@name,@format,@starts_at,@status,@mode,@mutator)",
          // Backups antigos não têm mode/mutator: restauram como 'classic'.
          rows("championships").map((row) => ({
            ...row,
            mode:
              row.mode === "duo" || row.mode === "mad" ? row.mode : "classic",
            mutator: typeof row.mutator === "string" ? row.mutator : null,
          })),
        );
        insert(
          "INSERT INTO championship_participants(championship_id,player_id) VALUES (@championship_id,@player_id)",
          rows("participants"),
        );
        insert(
          "INSERT INTO fixtures(id,championship_id,round_number,stage,player1_id,player2_id,match_id) VALUES (@id,@championship_id,@round_number,@stage,@player1_id,@player2_id,NULL)",
          rows("fixtures"),
        );
        insert(
          "INSERT INTO matches(id,player1_id,player2_id,team1_id,team2_id,score1,score2,championship_id,played_at) VALUES (@id,@player1_id,@player2_id,@team1_id,@team2_id,@score1,@score2,@championship_id,@played_at)",
          rows("matches"),
        );
        const restoreFixture = db.prepare(
          "UPDATE fixtures SET match_id=? WHERE id=?",
        );
        rows("fixtures").forEach((fixture) => {
          if (fixture.match_id)
            restoreFixture.run(fixture.match_id, fixture.id);
        });
      })();
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