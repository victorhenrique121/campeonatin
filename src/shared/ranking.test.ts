import { describe, expect, it } from "vitest";
import type { Standing } from "./models";
import { withWinningStreaks } from "./ranking";

const rows: Standing[] = [
  { id: 1, name: "Ana", played: 2, wins: 2, draws: 0, losses: 0, goalsFor: 5, goalsAgainst: 1, points: 6, winRate: 100, streak: 0 },
  { id: 2, name: "Bia", played: 2, wins: 0, draws: 0, losses: 2, goalsFor: 1, goalsAgainst: 5, points: 0, winRate: 0, streak: 0 },
];

describe("sequência de vitórias do ranking", () => {
  it("conta vitórias consecutivas da partida mais recente para trás", () => {
    const result = withWinningStreaks(rows, [
      { player1Id: 1, player2Id: 2, score1: 3, score2: 0 },
      { player1Id: 1, player2Id: 2, score1: 2, score2: 1 },
    ]);

    expect(result.map(({ id, streak }) => ({ id, streak }))).toEqual([
      { id: 1, streak: 2 },
      { id: 2, streak: 0 },
    ]);
  });

  it("interrompe a sequência após empate ou derrota", () => {
    const result = withWinningStreaks(rows, [
      { player1Id: 1, player2Id: 2, score1: 2, score2: 2 },
      { player1Id: 1, player2Id: 2, score1: 4, score2: 0 },
    ]);

    expect(result.find((row) => row.id === 1)?.streak).toBe(0);
  });
});
