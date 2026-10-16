import type { Standing } from "./models";

export type RankingMatch = {
  player1Id: number;
  player2Id: number;
  score1: number;
  score2: number;
};

export const withWinningStreaks = (
  rows: Standing[],
  games: RankingMatch[],
): Standing[] => {
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
};
