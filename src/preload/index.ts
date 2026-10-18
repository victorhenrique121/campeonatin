import { contextBridge, ipcRenderer } from "electron";
import type { Api, ChangeEmailInput } from "../shared/api";
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const invokeRoom = (channel: string) => async (...args: unknown[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Sua sessão expirou. Entre novamente para continuar.")) {
      throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    }
    throw new Error("Algo deu errado. Tente novamente em instantes.");
  }
};
const api: Api = {
  createRoom: invokeRoom("rooms:create"),
  listMyRooms: invokeRoom("rooms:list-mine"),
  joinRoom: invokeRoom("rooms:join"),
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
  ranking: invoke("ranking"),
  championships: invoke("championships:list"),
  championshipDetail: invoke("championships:detail"),
  saveChampionship: invoke("championships:save"),
  updateChampionship: invoke("championships:update"),
  deleteChampionship: invoke("championships:delete"),
} as Api;
contextBridge.exposeInMainWorld("arena", api);
