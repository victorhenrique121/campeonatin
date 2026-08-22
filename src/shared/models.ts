export type Player = {
  id: number;
  name: string;
  nickname: string;
  avatar?: string;
  createdAt: string;
};
export type Team = {
  id: number;
  name: string;
  league: string;
  country: string;
};
export type Match = {
  id: number;
  playedAt: string;
  player1Id: number;
  player2Id: number;
  player1: string;
  player2: string;
  team1: string;
  team2: string;
  score1: number;
  score2: number;
  championship?: string;
};
export type Standing = {
  id: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  winRate: number;
  streak: number;
};
export type Dashboard = {
  players: number;
  matches: number;
  leader?: Standing;
  mostUsedTeam?: string;
  recent: Match[];
  ranking: Standing[];
};
export type MatchInput = {
  player1Id: number;
  player2Id: number;
  team1Id: number;
  team2Id: number;
  score1: number;
  score2: number;
  championshipId?: number;
  playedAt?: string;
};
export type Championship = {
  id: number;
  name: string;
  format: "league" | "knockout" | "groups_knockout";
  startsAt: string;
  status: "draft" | "active" | "finished";
  participants: number;
};
export type Fixture = {
  id: number;
  round: number;
  stage: string;
  player1Id: number;
  player2Id: number;
  player1: string;
  player2: string;
  matchId?: number;
  score1?: number;
  score2?: number;
};
export type ChampionshipDetail = {
  championship: Championship;
  standing: Standing[];
  fixtures: Fixture[];
};
