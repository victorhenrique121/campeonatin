import { contextBridge, ipcRenderer } from "electron";
import type { Api, ChangeEmailInput } from "../shared/api";
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const api: Api = {
  getProfile: invoke("profile:get"),
  isUsernameAvailable: invoke("profile:username-available"),
  updateProfile: invoke("profile:update"),
  auth: {
    session: invoke("auth:session"),
    signUp: invoke("auth:signup"),
    signIn: invoke("auth:signin"),
    resendConfirmation: invoke("auth:resend-confirmation"),
    changePassword: invoke("auth:change-password"),
    emailSettings: invoke("auth:email-settings"),
    changeEmail: (input: ChangeEmailInput) => invoke("auth:change-email")(input),
    resendEmailChange: invoke("auth:resend-email-change"),
    signOut: invoke("auth:signout"),
    signOutOthers: invoke("auth:signout-others"),
  },
  dashboard: invoke("dashboard"),
  players: invoke("players:list"),
  savePlayer: invoke("players:save"),
  deletePlayer: invoke("players:delete"),
  teams: invoke("teams:list"),
  matches: invoke("matches:list"),
  saveMatch: invoke("matches:save"),
  updateMatch: invoke("matches:update"),
  deleteMatch: invoke("matches:delete"),
  clearMatches: invoke("matches:clear"),
  resetArena: invoke("arena:reset"),
  ranking: invoke("ranking"),
  championships: invoke("championships:list"),
  championshipDetail: invoke("championships:detail"),
  saveChampionship: invoke("championships:save"),
  updateChampionship: invoke("championships:update"),
  deleteChampionship: invoke("championships:delete"),
  exportArena: invoke("arena:export"),
  importArena: invoke("arena:import"),
  backup: invoke("backup"),
  restore: invoke("restore"),
  gameRules: invoke("game-rules:get"),
  saveGameRules: invoke("game-rules:save"),
} as Api;
contextBridge.exposeInMainWorld("arena", api);
