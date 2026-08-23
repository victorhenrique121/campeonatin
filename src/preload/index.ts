import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/api";
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const api: Api = {
  dashboard: invoke("dashboard"),
  players: invoke("players:list"),
  savePlayer: invoke("players:save"),
  deletePlayer: invoke("players:delete"),
  teams: invoke("teams:list"),
  matches: invoke("matches:list"),
  saveMatch: invoke("matches:save"),
  updateMatch: invoke("matches:update"),
  clearMatches: invoke("matches:clear"),
  ranking: invoke("ranking"),
  championships: invoke("championships:list"),
  championshipDetail: invoke("championships:detail"),
  saveChampionship: invoke("championships:save"),
  backup: invoke("backup"),
  restore: invoke("restore"),
} as Api;
contextBridge.exposeInMainWorld("arena", api);
