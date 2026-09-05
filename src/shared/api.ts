import type {
  Championship,
  ChampionshipDetail,
  Dashboard,
  Match,
  MatchInput,
  Player,
  Standing,
  Team,
} from "./models";
export type Api = {
  dashboard: () => Promise<Dashboard>;
  players: () => Promise<Player[]>;
  savePlayer: (player: Partial<Player>) => Promise<Player>;
  deletePlayer: (id: number) => Promise<void>;
  teams: (query?: string) => Promise<Team[]>;
  matches: () => Promise<Match[]>;
  saveMatch: (match: MatchInput) => Promise<number>;
  updateMatch: (match: MatchInput & { id: number }) => Promise<number>;
  deleteMatch: (id: number) => Promise<void>;
  clearMatches: () => Promise<void>;
  resetArena: () => Promise<void>;
  ranking: () => Promise<Standing[]>;
  championships: () => Promise<Championship[]>;
  championshipDetail: (id: number) => Promise<ChampionshipDetail>;
  saveChampionship: (
    value: Omit<Championship, "id" | "participants"> & {
      participantIds: number[];
    },
  ) => Promise<Championship>;
  deleteChampionship: (id: number) => Promise<void>;
  exportArena: () => Promise<Record<string, unknown>>;
  importArena: (data: Record<string, unknown>) => Promise<void>;
  backup: () => Promise<string>;
  restore: () => Promise<void>;
};
