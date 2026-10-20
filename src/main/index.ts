import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createDatabase, repository } from "./repository";
import type { ChangeEmailInput } from "../shared/api";
import { createPlayersService } from "./players-service";
import { createTeamsService } from "./teams-service";
import { createMatchesService } from "./matches-service";
import {
  changeEmail,
  changePassword,
  createRoom,
  listRoomMembers,
  promoteRoomAdmin,
  removeRoomMember,
  renameRoom,
  regenerateRoomCode,
  transferRoomOwnership,
  deleteRoom,
  leaveRoom,
  listMyRooms,
  joinRoom,
  getAuthSession,
  getEmailSettings,
  getProfile,
  isUsernameAvailable,
  updateProfile,
  initSupabase,
  resendEmailChangeConfirmation,
  resendSignupConfirmation,
  signInUser,
  endOtherSessions,
  signOutUser,
  signUpUser,
  testSupabaseConnection,
} from "./supabase";
import {
  deleteChampionship,
  getChampionships,
  saveChampionship,
  updateChampionshipName,
} from "./championship-service";

let window: BrowserWindow | null = null;
type RoomContext = {
  roomId: string | null;
  db: ReturnType<typeof createDatabase>;
  repo: ReturnType<typeof repository>;
  players: ReturnType<typeof createPlayersService>;
  matches: ReturnType<typeof createMatchesService>;
  teams: ReturnType<typeof createTeamsService>;
};
let currentContext: RoomContext | null = null;
let contextQueue: Promise<void> = Promise.resolve();
const dbPath = (roomId: string | null) => path.join(app.getPath("userData"), roomId ? `room-${roomId}.sqlite` : "fc-arena.sqlite");

function enqueueContext<T>(operation: () => T | Promise<T>): Promise<T> {
  const result = contextQueue.then(operation);
  contextQueue = result.then(() => undefined, () => undefined);
  return result;
}

function withContext<T>(operation: (context: RoomContext) => T | Promise<T>): Promise<T> {
  return enqueueContext(() => {
    if (!currentContext) throw new Error("Não foi possível carregar os dados da sala.");
    return operation(currentContext);
  });
}

function switchRoom(roomId: string | null): Promise<void> {
  return enqueueContext(async () => {
    if (roomId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) {
        throw new Error("Sala inválida.");
      }
      const rooms = await listMyRooms();
      if (!rooms.some((room) => room.id === roomId)) throw new Error("Você não tem acesso a esta sala.");
    }
    if (currentContext?.roomId === roomId && currentContext.db.open) return;
    const db = createDatabase(dbPath(roomId));
    try {
      const repo = repository(db);
      const next: RoomContext = { roomId, db, repo, players: createPlayersService(db, repo, roomId), matches: createMatchesService(db, repo), teams: createTeamsService(repo) };
      if (roomId !== null) {
        await next.players.syncMirror(roomId);
        await getChampionships(db, roomId);
        await next.matches.syncMirror(roomId);
      }
      currentContext?.db.close();
      currentContext = next;
    } catch (error) {
      db.close();
      throw error;
    }
  });
}

function ensureRoomGlobalOnly(): void {
  if (!currentContext || currentContext.roomId !== null) {
    throw new Error("As ações de criar e editar dados estarão disponíveis em breve dentro das salas. Por enquanto, use a sala global.");
  }
}

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

app.whenReady().then(async () => {
  await switchRoom(null);

  ipcMain.handle("auth:session", () => getAuthSession());
  ipcMain.handle("rooms:create", (_, name: string) => createRoom(name));
  ipcMain.handle("rooms:set-active", async (_, roomId: string | null) => { await switchRoom(roomId); return { ok: true }; });
  ipcMain.handle("rooms:list-mine", () => listMyRooms());
  ipcMain.handle("rooms:join", (_, code: string) => joinRoom(code));
  ipcMain.handle("rooms:list-members", (_, roomId: string) => listRoomMembers(roomId));
  ipcMain.handle("rooms:promote-admin", (_, roomId: string, userId: string) => promoteRoomAdmin(roomId, userId));
  ipcMain.handle("rooms:remove-member", (_, roomId: string, userId: string) => removeRoomMember(roomId, userId));
  ipcMain.handle("rooms:rename", (_, roomId: string, name: string) => renameRoom(roomId, name));
  ipcMain.handle("rooms:regenerate-code", (_, roomId: string) => regenerateRoomCode(roomId));
  ipcMain.handle("rooms:transfer-ownership", (_, roomId: string, newOwnerId: string) => transferRoomOwnership(roomId, newOwnerId));
  ipcMain.handle("rooms:delete", (_, roomId: string) => deleteRoom(roomId));
  ipcMain.handle("rooms:leave", (_, roomId: string) => leaveRoom(roomId));
  ipcMain.handle("profile:get", () => getProfile());
  ipcMain.handle("profile:username-available", (_, username) =>
    isUsernameAvailable(username),
  );
  ipcMain.handle("profile:update", (_, input) => updateProfile(input));
  ipcMain.handle("auth:signup", (_, email, password, displayName) =>
    signUpUser(email, password, displayName),
  );
  ipcMain.handle("auth:signin", (_, email, password) =>
    signInUser(email, password),
  );
  ipcMain.handle("auth:resend-confirmation", (_, email) =>
    resendSignupConfirmation(email),
  );
  ipcMain.handle("auth:change-password", (_, currentPassword, newPassword) =>
    changePassword(currentPassword, newPassword),
  );
  ipcMain.handle("auth:email-settings", () => getEmailSettings());
  ipcMain.handle("auth:change-email", (_, input: ChangeEmailInput) =>
    changeEmail(input),
  );
  ipcMain.handle("auth:resend-email-change", (_, pendingEmail) =>
    resendEmailChangeConfirmation(pendingEmail),

);
  ipcMain.handle("auth:signout", async () => {
    await switchRoom(null);
    return signOutUser();
  });
  ipcMain.handle("auth:signout-others", () => endOtherSessions());

  ipcMain.handle("dashboard", () => withContext(({ repo }) => repo.dashboard()));
  ipcMain.handle("arena:news", () => withContext(({ repo }) => repo.arenaNews()));
  ipcMain.handle("players:list", () => withContext(({ players, repo, roomId }) => roomId === null ? players.list() : repo.players()));
  ipcMain.handle("players:save", (_, p, roomId: string | null) => withContext(({ players }) => players.save(p, roomId)));
  ipcMain.handle("players:delete", (_, id) => withContext(({ players }) => players.remove(id)));
  ipcMain.handle("teams:list", (_, q) => withContext(({ teams }) => teams.list(q)));
  ipcMain.handle("matches:list", () => withContext(({ repo }) => repo.matches()));
  ipcMain.handle("matches:save", (_, m) => withContext(({ matches }) => { ensureRoomGlobalOnly(); return matches.save(m); }));
  ipcMain.handle("matches:update", (_, m) => withContext(({ matches }) => { ensureRoomGlobalOnly(); return matches.update(m); }));
  ipcMain.handle("matches:delete", (_, id) => withContext(({ matches }) => { ensureRoomGlobalOnly(); return matches.remove(id); }));
  ipcMain.handle("matches:clear", () => withContext(({ matches }) => { ensureRoomGlobalOnly(); return matches.clear(); }));
  ipcMain.handle("ranking", () => withContext(({ repo }) => repo.ranking()));

  // Rotas de Campeonatos ligadas ao championship-service.ts (Supabase + SQLite)
  ipcMain.handle("championships:list", () => withContext(({ db, roomId, repo }) => roomId === null ? getChampionships(db, null) : repo.championships()));
  ipcMain.handle("championships:detail", (_, id) =>
    withContext(({ repo }) => repo.championshipDetail(id)),
  );
  ipcMain.handle("championships:save", (_, c, roomId: string | null) => withContext(async ({ db, roomId: currentRoomId }) => {
    if (roomId !== currentRoomId) throw new Error("A sala selecionada foi alterada. Tente novamente.");
    console.log("[IPC] championships:save acionado:", c);
    return await saveChampionship(db, c, roomId);
  }));
  ipcMain.handle("championships:update", (_, id, name) => withContext(async ({ db, repo }) => {
    ensureRoomGlobalOnly();
    console.log("[IPC] championships:update acionado:", { id, name });
    await updateChampionshipName(db, id, name);
    return repo.championshipDetail(id).championship;
  }));
  ipcMain.handle("championships:delete", (_, id) => withContext(({ repo }) => {
    ensureRoomGlobalOnly();
    return deleteChampionship(repo, id);
  }));


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
        // Sincronização em cadeia no boot: jogadores -> campeonatos -> duplas e partidas.
        void withContext(async ({ players, db, matches, roomId }) => {
          if (roomId !== null) return;
          await players.syncMirror(null);
          const champs = await getChampionships(db, null);
          console.info(`[championships] espelho local sincronizado com o Supabase: ${champs.length} campeonato(s).`);
          return matches.syncMirror(null);
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
