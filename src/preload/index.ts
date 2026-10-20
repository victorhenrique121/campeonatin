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
    if (message.includes("Sua sessão expirou")) {
      throw new Error("Sua sessão expirou. Faça login novamente.");
    }
    if (message.includes("limite de 3 salas")) {
      throw new Error(
        "Você já atingiu o limite de 3 salas como proprietário. Exclua uma sala antiga para criar outra.",
      );
    }
    throw new Error("Algo deu errado. Tente novamente em instantes.");
  }
};
const invokeFriend = (channel: string) => async (...args: unknown[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const friendlyMessages = [
      "Sua sessão expirou. Entre novamente para continuar.",
      "Informe um @username válido.",
      "Usuário não encontrado.",
      "Você não pode adicionar a si mesmo.",
      "Essa pessoa já está na sua lista de amigos.",
      "Não foi possível procurar o usuário. Tente novamente em instantes.",
      "Não foi possível verificar seus amigos. Tente novamente em instantes.",
      "Não foi possível adicionar o amigo. Tente novamente em instantes.",
      "Não foi possível carregar seus amigos. Tente novamente em instantes.",
      "Não foi possível remover o amigo. Tente novamente em instantes.",
      "Não foi possível carregar os usuários bloqueados. Tente novamente em instantes.",
      "Não foi possível desbloquear o usuário. Tente novamente em instantes.",
      "Não foi possível enviar o convite. Tente novamente em instantes.",
      "Não foi possível carregar as notificações. Tente novamente em instantes.",
      "Não foi possível atualizar a notificação. Tente novamente em instantes.",
      "Você não pode convidar a si mesmo.",
      "Você não tem permissão para convidar pessoas para esta sala.",
      "Você só pode convidar pessoas da sua lista de amigos.",
      "Não é possível enviar convite para este usuário.",
      "Este amigo já participa da sala.",
      "Você não pode bloquear a si mesmo.",
      "Esse usuário já está bloqueado.",
      "Não foi possível bloquear o usuário. Tente novamente em instantes.",
      "O usuário foi bloqueado, mas não foi possível atualizar sua lista de amigos.",
    ];
    const friendlyMessage = friendlyMessages.find((candidate) => message.includes(candidate));
    throw new Error(friendlyMessage ?? "Algo deu errado. Tente novamente em instantes.");
  }
};
const api: Api = {
  getRoomMemberRole: invokeRoom("rooms:member-role"),
  listRoomMembers: invokeRoom("rooms:list-members"),
  promoteRoomAdmin: invokeRoom("rooms:promote-admin"),
  removeRoomMember: invokeRoom("rooms:remove-member"),
  renameRoom: invokeRoom("rooms:rename"),
  regenerateRoomCode: invokeRoom("rooms:regenerate-code"),
  transferRoomOwnership: invokeRoom("rooms:transfer-ownership"),
  deleteRoom: invokeRoom("rooms:delete"),
  leaveRoom: invokeRoom("rooms:leave"),
  createRoom: invokeRoom("rooms:create"),
  listMyRooms: invokeRoom("rooms:list-mine"),
  setActiveRoom: invokeRoom("rooms:set-active"),
  joinRoom: invokeRoom("rooms:join"),
  getProfile: invoke("profile:get"),
  findFriendByUsername: invokeFriend("friends:find"),
  addFriend: invokeFriend("friends:add"),
  listFriends: invokeFriend("friends:list"),
  removeFriend: invokeFriend("friends:remove"),
  blockUser: invokeFriend("friends:block"),
  listBlockedUsers: invokeFriend("friends:blocked"),
  unblockUser: invokeFriend("friends:unblock"),
  sendRoomInvite: invokeFriend("notifications:send-room-invite"),
  listUnreadNotifications: invokeFriend("notifications:list-unread"),
  markNotificationRead: invokeFriend("notifications:mark-read"),
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
  arenaNews: invoke("arena:news"),
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
