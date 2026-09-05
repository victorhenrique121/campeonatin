import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { createDatabase, repository } from "./repository";

let window: BrowserWindow | null = null;
const dbPath = () => path.join(app.getPath("userData"), "fc-arena.sqlite");

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#0b1020",
    title: "FC Arena",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Se a variável existir, usa ela; caso contrário, se estiver em Dev, usa localhost:5173
  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

  if (!app.isPackaged) {
    window.loadURL(devUrl);
  } else {
    window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(() => {
  const repo = repository(createDatabase(dbPath()));

  ipcMain.handle("dashboard", () => repo.dashboard());
  ipcMain.handle("players:list", () => repo.players());
  ipcMain.handle("players:save", (_, p) => repo.savePlayer(p));
  ipcMain.handle("players:delete", (_, id) => repo.deletePlayer(id));
  ipcMain.handle("teams:list", (_, q) => repo.teams(q));
  ipcMain.handle("matches:list", () => repo.matches());
  ipcMain.handle("matches:save", (_, m) => repo.saveMatch(m));
  ipcMain.handle("matches:update", (_, m) => repo.updateMatch(m));
  ipcMain.handle("matches:delete", (_, id) => repo.deleteMatch(id));
  ipcMain.handle("matches:clear", () => repo.clearMatches());
  ipcMain.handle("arena:reset", () => repo.resetArena());
  ipcMain.handle("ranking", () => repo.ranking());
  ipcMain.handle("championships:list", () => repo.championships());
  ipcMain.handle("championships:detail", (_, id) =>
    repo.championshipDetail(id),
  );
  ipcMain.handle("championships:save", (_, c) => repo.saveChampionship(c));
  ipcMain.handle("championships:delete", (_, id) => repo.deleteChampionship(id));
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
