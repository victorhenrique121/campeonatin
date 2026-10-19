import type {
  ArenaNews,
  Championship,
  ChampionshipDetail,
  Dashboard,
  DuoInput,
  Match,
  MatchInput,
  Player,
  Standing,
  Team,
} from "./models";

export type ChangeEmailInput = {
  currentPassword: string;
  newEmail: string;
};

export type EmailSettings = {
  email: string;
  emailConfirmedAt: string | null;
  pendingEmail: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "player" | "viewer";
  emailConfirmedAt: string | null;
};

export type AuthSession = {
  authenticated: boolean;
  user: AuthUser | null;
};

export type UpdateProfileInput = {
  displayName: string;
  username: string | null;
  bio: string | null;
  avatar?: {
    bytes: Uint8Array;
    contentType: "image/jpeg" | "image/png" | "image/webp";
    extension: "jpg" | "png" | "webp";
  } | null;
};

export type UserProfile = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: "admin" | "player" | "viewer";
  email: string;
  emailConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSignUpResult = {
  requiresEmailConfirmation: boolean;
  email: string;
};

export type Api = {
  listRoomMembers: (roomId: string) => Promise<Array<{ userId: string; role: string; displayName: string; username: string | null; avatarUrl: string | null }>>;
  promoteRoomAdmin: (roomId: string, userId: string) => Promise<void>;
  removeRoomMember: (roomId: string, userId: string) => Promise<void>;
  renameRoom: (roomId: string, name: string) => Promise<void>;
  regenerateRoomCode: (roomId: string) => Promise<string>;
  transferRoomOwnership: (roomId: string, newOwnerId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  leaveRoom: (roomId: string) => Promise<void>;
  createRoom: (name: string) => Promise<{ id: string; name: string; entryCode: string }>;
  listMyRooms: () => Promise<Array<{ id: string; name: string; role: string; entryCode: string; memberCount: number }>>;
  joinRoom: (code: string) => Promise<{ roomId: string | null }>;
  getProfile: () => Promise<UserProfile>;
  isUsernameAvailable: (username: string) => Promise<boolean>;
  updateProfile: (input: UpdateProfileInput) => Promise<UserProfile>;
  auth: {
    session: () => Promise<AuthSession>;
    signUp: (email: string, password: string, displayName: string) => Promise<AuthSignUpResult>;
    signIn: (email: string, password: string) => Promise<AuthUser>;
    resendConfirmation: (email: string) => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    emailSettings: () => Promise<EmailSettings>;
    changeEmail: (input: ChangeEmailInput) => Promise<EmailSettings>;
    resendEmailChange: (pendingEmail: string) => Promise<void>;
    signOut: () => Promise<void>;
    signOutOthers: () => Promise<void>;
  };
  dashboard: () => Promise<Dashboard>;
  arenaNews: () => Promise<ArenaNews[]>;
  players: () => Promise<Player[]>;
  savePlayer: (player: Partial<Player>) => Promise<Player>;
  deletePlayer: (id: number) => Promise<void>;
  teams: (query?: string) => Promise<Team[]>;
  matches: () => Promise<Match[]>;
  saveMatch: (match: MatchInput) => Promise<number>;
  updateMatch: (match: MatchInput & { id: number }) => Promise<number>;
  deleteMatch: (id: number) => Promise<void>;
  clearMatches: () => Promise<void>;
  ranking: () => Promise<Standing[]>;
  championships: () => Promise<Championship[]>;
  championshipDetail: (id: number) => Promise<ChampionshipDetail>;
  saveChampionship: (
    value: Omit<Championship, "id" | "participants"> & {
      participantIds: number[];
      participantDuos?: DuoInput[];
      // Time escolhido para cada participante (mesmo índice de
      // participantIds) — persistido, deixa de ser esquecido ao registrar
      // resultados.
      participantTeamIds?: (number | null)[];
    },
  ) => Promise<Championship>;
  updateChampionship: (id: number, name: string) => Promise<Championship>;
  deleteChampionship: (id: number) => Promise<void>;
};
