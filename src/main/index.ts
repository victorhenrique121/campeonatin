import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { createDatabase, repository } from "./repository";
import { createPlayersService } from "./players-service";
import { createTeamsService } from "./teams-service";
import { createMatchesService } from "./matches-service";
import { initSupabase, testSupabaseConnection } from "./supabase";
import {
  getChampionships,
  saveChampionship,
  updateChampionshipName,
} from "./championship-service";

let window: BrowserWindow | null = null;
const dbPath = () => path.join(app.getPath("userData"), "fc-arena.sqlite");

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: "#0b1020",
    title: "FC Arena",

    icon: path.join(__dirname, "../../src/midia/fcarena.png"),

    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

  if (!app.isPackaged) {
    window.loadURL(devUrl);
  } else {
    window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  const db = createDatabase(dbPath());
  const repo = repository(db);

  const players = createPlayersService(db, repo);
  const teams = createTeamsService(repo);
  const matches = createMatchesService(db, repo);

  ipcMain.handle("dashboard", () => repo.dashboard());
  ipcMain.handle("players:list", () => players.list());
  ipcMain.handle("players:save", (_, p) => players.save(p));
  ipcMain.handle("players:delete", (_, id) => players.remove(id));
  ipcMain.handle("teams:list", (_, q) => teams.list(q));
  ipcMain.handle("matches:list", () => repo.matches());
  ipcMain.handle("matches:save", (_, m) => matches.save(m));
  ipcMain.handle("matches:update", (_, m) => matches.update(m));
  ipcMain.handle("matches:delete", (_, id) => matches.remove(id));
  ipcMain.handle("matches:clear", () => matches.clear());
  ipcMain.handle("arena:reset", () => repo.resetArena());
  ipcMain.handle("ranking", () => repo.ranking());

  // Rotas de Campeonatos ligadas ao championship-service.ts (Supabase + SQLite)
  ipcMain.handle("championships:list", () => getChampionships(db));
  ipcMain.handle("championships:detail", (_, id) =>
    repo.championshipDetail(id),
  );
  ipcMain.handle("championships:save", async (_, c) => {
    console.log("[IPC] championships:save acionado:", c);
    return await saveChampionship(db, c);
  });
  ipcMain.handle("championships:update", async (_, id, name) => {
    console.log("[IPC] championships:update acionado:", { id, name });
    await updateChampionshipName(db, id, name);
    return repo.championshipDetail(id).championship;
  });
  ipcMain.handle("championships:delete", (_, id) =>
    repo.deleteChampionship(id),
  );

  ipcMain.handle("arena:export", () => repo.exportArena());
  ipcMain.handle("arena:import", (_, data) => repo.importArena(data));
  ipcMain.handle("backup", async () => {
    const dest = await dialog.showSaveDialog({
      defaultPath: "fc-arena-backup.sqlite",
    });
    if (dest.canceled || !dest.filePath) return "";
    return repo.backup(dest.filePath);
  });
  ipcMain.handle("restore", async () => {
    const src = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }],
    });
    if (src.canceled || !src.filePaths[0]) return;
    repo.restore(src.filePaths[0]);
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("game-rules:get", () => repo.gameRules());
  ipcMain.handle("game-rules:save", (_, settings) =>
    repo.saveGameRules(settings),
  );

  initSupabase({
    rootDir: app.getAppPath(),
    sessionStoragePath: path.join(
      app.getPath("userData"),
      "supabase-session.json",
    ),
  });

  void testSupabaseConnection()
    .then((status) => {
      const log = status.ok ? console.info : console.warn;
      log(`[supabase] Teste de conexão (${status.reason}): ${status.message}`);
      
      if (status.ok && status.authenticated) {
        // Sincronização em cadeia no boot: Players -> Matches -> Championships
        void players
          .syncMirror()
          .then(() => matches.syncMirror())
          .then(() => getChampionships(db))
          .then((champs) => {
            console.info(`[championships] espelho local sincronizado com o Supabase: ${champs.length} campeonato(s).`);
          })
          .catch((err) => {
            console.warn(
              "[supabase] falha na sincronização dos espelhos locais:",
              err,
            );
          });
      }
    })
    .catch((err) => {
      console.error("[supabase] Erro inesperado no teste de conexão:", err);
    });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});