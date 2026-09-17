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

  team1Id: number;
  team2Id: number;

  score1: number;
  score2: number;

  championship?: string;
  championshipId?: number | null;
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
export type GameRulesSettings = {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  minimumBestFormMatches: number;
};
export type StatisticsPlayerMetric = {
  id: number;
  name: string;
  value: number;
  detail?: string;
};
export type StatisticsClubMetric = {
  name: string;
  count: number;
};
export type RankingTrendPoint = {
  date: string;
  position: number;
};
export type RankingTrendSeries = {
  playerId: number;
  name: string;
  points: RankingTrendPoint[];
};
export type GoalTrendPoint = {
  date: string;
  goalsFor: number;
  goalsAgainst: number;
};
export type LastChampion = {
  championshipName: string;
  championName: string;
  playedAt: string;
};
export type StatisticsDashboard = {
  bestForm: StatisticsPlayerMetric | null;
  topScorer: StatisticsPlayerMetric | null;
  bestGoalDifference: StatisticsPlayerMetric | null;
  mostPlayedPlayer: StatisticsPlayerMetric | null;
  mostUsedClub: StatisticsClubMetric | null;
  bestWinRate: StatisticsPlayerMetric | null;
  lastFiveMatches: Match[];
  streaks: Array<{ playerId: number; name: string; streak: number }>;
  rankingTrend: RankingTrendSeries[];
  goalTrend: GoalTrendPoint[];
  lastChampion: LastChampion | null;
};
export type Dashboard = {
  players: number;
  matches: number;
  leader?: Standing;
  mostUsedTeam?: string;
  recent: Match[];
  ranking: Standing[];
  statistics?: StatisticsDashboard | null;
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
  mode?: "classic" | "duo" | "mad";
  mutator?: string | null;
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
  match?: Match;
};
export type ChampionshipDetail = {
  championship: Championship;
  standing: Standing[];
  fixtures: Fixture[];
};
