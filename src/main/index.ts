import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { createDatabase, repository } from "./repository";
import { createPlayersService } from "./players-service";
import { createTeamsService } from "./teams-service";
import { createMatchesService } from "./matches-service";
import { initSupabase, testSupabaseConnection } from "./supabase";
import { updateChampionshipName } from "./championship-service";

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

  // ETAPA 2: "players" passa a usar o Supabase como fonte de verdade, com
  // espelho local no SQLite (mesmos ids) para manter as FKs/JOINs de matches,
  // fixtures, ranking e dashboard 100% intactos. Sem .env configurado, o
  // serviço delega tudo ao repository (modo legado, idêntico ao anterior).
  // As assinaturas dos canais IPC NÃO mudam — o renderer segue intacto.
  const players = createPlayersService(db, repo);

  // ETAPA 3: leitura de "teams" (catálogo estático) passa a vir do Supabase
  // quando configurado/autenticado, com fallback para o catálogo local
  // (seed do boot) quando offline/erro. O aplicativo NÃO escreve no remoto
  // para teams — o povoamento é manual via `npm run migrate:teams`.
  // O canal IPC "teams:list" mantém assinatura idêntica (renderer inalterado).
  const teams = createTeamsService(repo);

  // ETAPA 4: "matches" segue o padrão HÍBRIDO aprovado — ESCRITA remota
  // primeiro (estrita-online, id gerado pelo Supabase) + transação local
  // intacta (fixtures/mata-mata exatamente como hoje); LEITURA (matches:list)
  // permanece SEMPRE local, pois championship_id fica NULL no remoto até a
  // Etapa 5 migrar championships. Sem .env configurado, o serviço delega
  // tudo ao repository (modo legado, idêntico ao anterior). Os canais IPC
  // mantêm assinaturas idênticas (renderer inalterado).
  const matches = createMatchesService(db, repo);

  ipcMain.handle("dashboard", () => repo.dashboard());
  ipcMain.handle("players:list", () => players.list());
  ipcMain.handle("players:save", (_, p) => players.save(p));
  ipcMain.handle("players:delete", (_, id) => players.remove(id));
  ipcMain.handle("teams:list", (_, q) => teams.list(q));
  // ETAPA 4: matches:list continua no repository — leitura SEMPRE local
  // (decisão aprovada: o Supabase é destino de escrita/histórico nesta etapa).
  ipcMain.handle("matches:list", () => repo.matches());
  ipcMain.handle("matches:save", (_, m) => matches.save(m));
  ipcMain.handle("matches:update", (_, m) => matches.update(m));
  ipcMain.handle("matches:delete", (_, id) => matches.remove(id));
  ipcMain.handle("matches:clear", () => matches.clear());
  ipcMain.handle("arena:reset", () => repo.resetArena());
  ipcMain.handle("ranking", () => repo.ranking());
  ipcMain.handle("championships:list", () => repo.championships());
  ipcMain.handle("championships:detail", (_, id) => repo.championshipDetail(id));
  ipcMain.handle("championships:save", (_, c) => repo.saveChampionship(c));
  ipcMain.handle("championships:update", (_, id, name) => {
    updateChampionshipName(db, id, name);
    return repo.championshipDetail(id).championship;
  });
  ipcMain.handle("championships:delete", (_, id) => repo.deleteChampionship(id));
  ipcMain.handle("arena:export", () => repo.exportArena());
  ipcMain.handle("arena:import", (_, data) => repo.importArena(data));
  ipcMain.handle("backup", async () => {
    const dest = await dialog.showSaveDialog({ defaultPath: "fc-arena-backup.sqlite" });
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
  ipcMain.handle("game-rules:save", (_, settings) => repo.saveGameRules(settings));

  // -------------------------------------------------------------------------
  // Supabase (Etapas 1-2): conexão PARALELA ao SQLite (que segue como banco
  // principal de teams/matches/championships/fixtures/ranking/dashboard).
  // Inicialização não bloqueante: qualquer falha ou ausência de configuração
  // é apenas logada no console do processo main e NÃO afeta o aplicativo.
  // A sessão da conta de serviço persiste em userData/supabase-session.json.
  // -------------------------------------------------------------------------
  initSupabase({
    rootDir: app.getAppPath(),
    sessionStoragePath: path.join(app.getPath("userData"), "supabase-session.json"),
  });
  void testSupabaseConnection()
    .then((status) => {
      const log = status.ok ? console.info : console.warn;
      log(`[supabase] Teste de conexão (${status.reason}): ${status.message}`);
      // Com conexão OK, mantém os espelhos locais atualizados (boot).
      // ORDEM IMPORTA (Etapa 4): players ANTES de matches — o espelho de
      // matches referencia players/teams com FK RESTRICT no SQLite.
      if (status.ok && status.authenticated) {
        void players
          .syncMirror()
          .then(() => matches.syncMirror())
          .catch((err) => {
            console.warn("[supabase] falha na sincronização dos espelhos locais:", err);
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
