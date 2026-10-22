import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
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
  getRoomMemberRole,
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
  addFriend,
  blockUser,
  findFriendByUsername,
  listFriends,
  listBlockedUsers,
  listUnreadNotifications,
  markNotificationRead,
  removeFriend,
  sendRoomInvite,
  unblockUser,
  getEmailSettings,
  getProfile,
  getUserSessionClient,
  isUsernameAvailable,
  refreshUserSession,
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
const windowIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.ico")
  : path.join(__dirname, "../../build/icon.ico");
const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Faça login novamente.";

function loadPackagedSupabaseEnv(): void {
  if (!app.isPackaged) return;

  const publicEnvPath = path.join(process.resourcesPath, "supabase.env");
  try {
    if (!fs.existsSync(publicEnvPath)) {
      console.warn("[config] Arquivo público do Supabase não encontrado no pacote.");
      return;
    }
    process.loadEnvFile(publicEnvPath);
  } catch (error) {
    console.warn(
      "[config] Não foi possível carregar a configuração pública do Supabase.",
      error instanceof Error ? error.message : error,
    );
  }
}

loadPackagedSupabaseEnv();

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

async function ensureRoomSession(): Promise<void> {
  try {
    await getUserSessionClient();
  } catch {
    try {
      await refreshUserSession();
      await getUserSessionClient();
    } catch {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }
  }
}

function switchRoom(roomId: string | null): Promise<void> {
  return enqueueContext(async () => {
    if (roomId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) {
        throw new Error("Sala inválida.");
      }
      await ensureRoomSession();
      const rooms = await listMyRooms();
      if (!rooms.some((room) => room.id === roomId)) throw new Error("Você não tem acesso a esta sala.");
    }
    if (currentContext?.roomId === roomId && currentContext.db.open) return;
    const db = createDatabase(dbPath(roomId));
    let next: RoomContext;
    try {
      const repo = repository(db);
      next = { roomId, db, repo, players: createPlayersService(db, repo, roomId), matches: createMatchesService(db, repo, roomId), teams: createTeamsService(repo) };
    } catch (error) {
      db.close();
      throw error;
    }

    const previousContext = currentContext;
    currentContext = next;

    if (roomId !== null) {
      try {
        await next.players.syncMirror(roomId);
        await getChampionships(db, roomId);
        await next.matches.syncMirror(roomId);
      } catch (error) {
        console.warn("Não foi possível sincronizar os dados da sala.", error);
      }
    }

    if (previousContext?.db.open) {
      previousContext.db.close();
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

    icon: windowIconPath,

    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
  const rendererIndexPath = path.join(__dirname, "../../dist/index.html");

  if (!app.isPackaged) {
    window.loadURL(devUrl);
  } else {
    window.loadFile(rendererIndexPath);
  }
}

app.whenReady().then(async () => {
  await switchRoom(null);

  ipcMain.handle("auth:session", () => getAuthSession());
  ipcMain.handle("rooms:create", (_, name: string) => createRoom(name));
  ipcMain.handle("rooms:member-role", (_, roomId: string) => getRoomMemberRole(roomId));
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
  ipcMain.handle("friends:find", (_, username: string) => findFriendByUsername(username));
  ipcMain.handle("friends:add", (_, username: string) => addFriend(username));
  ipcMain.handle("friends:list", () => listFriends());
  ipcMain.handle("friends:remove", (_, friendId: string) => removeFriend(friendId));
  ipcMain.handle("friends:block", (_, userId: string) => blockUser(userId));
  ipcMain.handle("friends:blocked", () => listBlockedUsers());
  ipcMain.handle("friends:unblock", (_, userId: string) => unblockUser(userId));
  ipcMain.handle("notifications:list-unread", () => listUnreadNotifications());
  ipcMain.handle("notifications:mark-read", (_, notificationId: number) => markNotificationRead(notificationId));
  ipcMain.handle("notifications:send-room-invite", (_, friendId: string, roomId: string) => sendRoomInvite(friendId, roomId));
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
  ipcMain.handle("matches:save", (_, m, roomId: string | null) =>
    withContext(({ matches, roomId: currentRoomId }) => {
      if (roomId !== currentRoomId) {
        throw new Error("A sala selecionada foi alterada. Tente novamente.");
      }
      return matches.save(m, roomId);
    }),
  );
  ipcMain.handle("matches:update", (_, m) => withContext(({ matches }) => { ensureRoomGlobalOnly(); return matches.update(m); }));
  ipcMain.handle("matches:delete", (_, id) => withContext(({ matches }) => matches.remove(id)));
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
  ipcMain.handle("championships:update", (_, id, name) => withContext(async ({ db, repo, roomId }) => {
    console.log("[IPC] championships:update acionado:", { id, name });
    await updateChampionshipName(db, id, name, roomId);
    return repo.championshipDetail(id).championship;
  }));
  ipcMain.handle("championships:delete", (_, id) => withContext(({ db }) => {
    return deleteChampionship(db, id);
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
