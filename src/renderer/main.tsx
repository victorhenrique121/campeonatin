import "./styles/config.css";
import { AccountSettings } from "./settings/AccountSettings";
import { PasswordSettings } from "./settings/PasswordSettings";
import { EmailSettings } from "./settings/EmailSettings";
import { NotificationsSettings } from "./settings/NotificationsSettings";
import { PrivacySettings } from "./settings/PrivacySettings";
import { getFriendlyPrivacyError } from "./settings/auth-error";
import {
  ARENA_PALETTES,
  DEFAULT_PALETTE_ID,
  getArenaPalette,
  getArenaPaletteVariant,
  type ArenaPalette,
  type ArenaTheme,
} from "./settings/palettes";
import fcArenaLogo from "../midia/fcarena-icon.png";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Clipboard,
  ChevronDown,
  CirclePlus,
  CircleHelp,
  Dices,
  DoorOpen,
  EyeOff,
  Flag,
  Footprints,
  Gamepad2,
  Gauge,
  Goal,
  Hand,
  Heart,
  Flame,
  Laugh,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Mic,
  Ban,
  RotateCcw,
  Search,
  Shuffle,
  Shield,
  Snowflake,
  Sparkles,
  SquarePen,
  Timer,
  Target,
  Trash2,
  Trophy,
  UserCircle,
  Users,
  UsersRound,
  Settings2,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import type { AuthUser } from "../shared/api";
import type {
  ArenaNews,
  Championship,
  ChampionshipDetail,
  Dashboard,
  Fixture,
  Match,
  Player,
  Team,
} from "../shared/models";
import { HeadToHeadCard } from "./HeadToHeadCard";
import { AuthPage } from "./AuthPage";
import { ProfilePage } from "./ProfilePage";
import { Ranking } from "./components/Ranking";
import { AppModal } from "./components/AppModal";
import { ArenaTools } from "./components/ArenaTools";
import { EditMatchModal } from "./components/EditMatchModal";
import { TeamsPage } from "./pages/TeamsPage";
import "./styles/auth.css";
import "./styles/app.css";
import "./styles/account-menu.css";
import "./styles/fixtures.css";
import "./styles/HeadToHeadCard.css";

type Page =
  | "dashboard"
  | "rooms"
  | "friends"
  | "players"
  | "matches"
  | "ranking"
  | "championships"
  | "settings"
  | "profile"
  | "teams";
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
    new Date(value),
  );
const applyStoredAppearance = () => {
  const theme: ArenaTheme =
    localStorage.getItem("arena-theme") === "light" ? "light" : "dark";
  const savedPalette = localStorage.getItem("arena-palette");
  const palette = ARENA_PALETTES.find((item) => item.id === savedPalette);

  const colors = palette
    ? getArenaPaletteVariant(palette, theme)
    : {
        accent: localStorage.getItem("arena-accent") ?? "#7e5ff0",
        background: localStorage.getItem("arena-background") ?? "#0a0c10",
      };

  document.documentElement.style.setProperty("--arena-accent", colors.accent);
  document.documentElement.style.setProperty("--arena-bg", colors.background);
};

applyStoredAppearance();

const playArenaSound = (kind: "click" | "draw" | "whistle" = "click") => {
  if (localStorage.getItem("arena-muted") === "true") return;
  const Audio =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Audio) return;
  const context = new Audio(),
    oscillator = context.createOscillator(),
    gain = context.createGain();
  oscillator.frequency.value =
    kind === "whistle" ? 880 : kind === "draw" ? 510 : 290;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
};

const copyMatchSummary = async (match: Match) => {
  const summary = `⚽ *FC ARENA*

━━━━━━━━━━━━━━
🏆 *RESULTADO FINAL*
━━━━━━━━━━━━━━

👤 *${match.player1}*
🏟️ ${match.team1}

        *${match.score1} × ${match.score2}*

👤 *${match.player2}*
🏟️ ${match.team2}
${match.championship ? `\n🏆 *${match.championship}*` : ""}

━━━━━━━━━━━━━━
🎮 Partida registrada no FC Arena
`;

  await navigator.clipboard.writeText(summary);
  playArenaSound("whistle");
};
const Empty = ({ text }: { text: string }) => (
  <div className="empty">{text}</div>
);

/**
 * Toast discreto (substitui os alert() nativos, que no Electron são
 * síncronos/bloqueantes). Renderizado pelas páginas que disparam ações
 * com feedback rápido (ex.: copiar resumo para o WhatsApp).
 */
const Toast = ({ message }: { message: string }) =>
  message ? (
    <div className="arena-toast" role="status">
      <Check size={14} /> {message}
    </div>
  ) : null;

function useToast() {
  const [toast, setToast] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(""), 2200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, showToast };
}
function HighlightAvatar({ name, player }: { name: string; player?: Player }) {
  return (
    <span className="highlight-avatar" aria-hidden="true">
      {player?.avatar ? <img src={player.avatar} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Game({
  match,
  players,
  onEdit,
  onDelete,
  onShare,
}: {
  match: Match;
  players: Player[];
  onEdit: (match: Match) => void;
  onDelete?: (match: Match) => void;
  onShare?: (match: Match) => void;
}) {
  const player1 = players.find((player) => player.id === match.player1Id);
  const player2 = players.find((player) => player.id === match.player2Id);
  const competition = match.championshipFormat === "league"
    ? { label: "Liga", className: "badge-league" }
    : match.championshipFormat === "knockout" || match.championshipFormat === "groups_knockout"
      ? { label: "Copa", className: "badge-cup" }
      : { label: "Clássico", className: "badge-casual" };
  const avatar = (name: string, player?: Player) => (
    <span className="game-avatar" aria-hidden="true">
      {player?.avatar ? <img src={player.avatar} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <div className="game">
      <div className="game-meta">
        <small>{date(match.playedAt)}</small>
        <span className={`game-competition ${competition.className}`}>{competition.label}</span>
        {match.championship && <small>{match.championship}</small>}
      </div>
      <div className="game-content">
        <div className="game-player">
          {avatar(match.player1, player1)}
          <span>{match.player1}<em>{match.team1}</em></span>
        </div>
        <b className="game-score">
          {match.score1} <i>×</i> {match.score2}
        </b>
        <div className="game-player game-player-right">
          <span>{match.player2}<em>{match.team2}</em></span>
          {avatar(match.player2, player2)}
        </div>
      </div>
      <div className="game-actions">
      <button
        type="button"
        className="edit-match-btn"
        onClick={() => onEdit(match)}
        aria-label={`Editar partida entre ${match.player1} e ${match.player2}`}
        title="Editar resultado"
      >
        <SquarePen size={15} />
      </button>
      {onDelete && (
        <button
          type="button"
          className="delete-match-btn"
          onClick={() => onDelete(match)}
          aria-label={`Apagar partida entre ${match.player1} e ${match.player2}`}
        >
          <Trash2 size={15} />
        </button>
      )}
      {onShare && (
        <button
          type="button"
          className="share-match-btn"
          onClick={() => onShare(match)}
          aria-label={`Compartilhar partida entre ${match.player1} e ${match.player2}`}
          title="Compartilhar no WhatsApp"
        >
          <Clipboard size={15} />
        </button>
      )}
      </div>
    </div>
  );
}

function FriendsPage() {
  return (
    <section className="page-title">
      <div>
        <h1>Amigos</h1>
        <span>Em breve: adicionar amigos e convidar para salas.</span>
      </div>
    </section>
  );
}

function RoomsPage({ activeRoomId, setActiveRoomId, switchingRoom }: {
  activeRoomId: string | null;
  setActiveRoomId: React.Dispatch<React.SetStateAction<string | null>>;
  switchingRoom: boolean;
}) {
  const [name, setName] = useState("");
  const [entryCode, setEntryCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinSuccess, setJoinSuccess] = useState("");
  const [joining, setJoining] = useState(false);
  const [rooms, setRooms] = useState<Awaited<ReturnType<typeof window.arena.listMyRooms>>>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const roomsRequest = useRef(0);
  const [memberResult, setMemberResult] = useState<{
    roomId: string;
    members: Awaited<ReturnType<typeof window.arena.listRoomMembers>>;
    error: string;
  } | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [memberActionMessage, setMemberActionMessage] = useState("");
  const [memberActionError, setMemberActionError] = useState("");
  const [memberActionPending, setMemberActionPending] = useState(false);
  const [roomActionPending, setRoomActionPending] = useState(false);
  const [roomActionMessage, setRoomActionMessage] = useState("");
  const [roomActionError, setRoomActionError] = useState("");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const selectedRoomRef = useRef<string | null>(activeRoomId);
  const selectionVersion = useRef(0);
  const selectedRoom = rooms.find((room) => room.id === activeRoomId);

  useEffect(() => {
    if (!activeRoomId) return;
    let current = true;
    window.arena.listRoomMembers(activeRoomId).then((members) => {
      if (current) setMemberResult({ roomId: activeRoomId, members, error: "" });
    }).catch((err: unknown) => {
      if (current) setMemberResult({ roomId: activeRoomId, members: [], error: getFriendlyPrivacyError(err) });
    });
    return () => { current = false; };
  }, [activeRoomId]);

  const copyRoomCode = async (roomCode: string) => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopyMessage("Código copiado.");
    } catch {
      setCopyMessage("Não foi possível copiar o código.");
    }
  };

  const changeMember = async (roomId: string, userId: string, action: "promote" | "remove") => {
    const version = selectionVersion.current;
    setMemberActionMessage("");
    setMemberActionError("");
    setMemberActionPending(true);
    try {
      if (action === "promote") {
        await window.arena.promoteRoomAdmin(roomId, userId);
      } else {
        await window.arena.removeRoomMember(roomId, userId);
      }
      if (selectedRoomRef.current !== roomId || selectionVersion.current !== version) return;
      setMemberActionMessage(action === "promote" ? "Membro promovido a administrador." : "Membro removido da sala.");
      try {
        const members = await window.arena.listRoomMembers(roomId);
        if (selectedRoomRef.current === roomId && selectionVersion.current === version) setMemberResult({ roomId, members, error: "" });
      } catch {
        if (selectedRoomRef.current === roomId && selectionVersion.current === version) {
          setMemberResult({ roomId, members: [], error: "Não foi possível atualizar a lista de membros." });
          setMemberActionError("A ação foi concluída, mas não foi possível atualizar a lista de membros.");
        }
      }
    } catch (err) {
      if (selectedRoomRef.current === roomId && selectionVersion.current === version) setMemberActionError(getFriendlyPrivacyError(err));
    } finally {
      setMemberActionPending(false);
    }
  };

  const renameRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedRoom) return;
    setRoomActionMessage("");
    setRoomActionError("");
    const newName = renameValue.trim();
    if (!newName) {
      setRoomActionError("O nome da sala não pode ser vazio.");
      return;
    }
    if (newName === selectedRoom.name) return;
    const roomId = selectedRoom.id;
    const version = selectionVersion.current;
    setRenaming(true);
    try {
      await window.arena.renameRoom(roomId, renameValue);
      setRooms((current) => current.map((room) => room.id === roomId ? { ...room, name: newName } : room));
      if (selectedRoomRef.current === roomId && selectionVersion.current === version) {
        setRenameValue("");
        setRoomActionMessage("Sala renomeada.");
      }
    } catch (err) {
      if (selectedRoomRef.current === roomId && selectionVersion.current === version) setRoomActionError(getFriendlyPrivacyError(err));
    } finally {
      setRenaming(false);
    }
  };

  const changeRoom = async (action: "leave" | "regenerate" | "transfer" | "delete") => {
    if (!selectedRoom) return;
    const room = selectedRoom;
    const version = selectionVersion.current;
    if (action === "transfer" && !newOwnerId) {
      setRoomActionError("Escolha um membro para ser o novo proprietário.");
      return;
    }
    if (action === "delete" && !window.confirm("Deseja excluir esta sala?")) return;

    setRoomActionMessage("");
    setRoomActionError("");
    setRoomActionPending(true);
    try {
      if (action === "leave") await window.arena.leaveRoom(room.id);
      if (action === "delete") await window.arena.deleteRoom(room.id);
      if (action === "regenerate") {
        const newCode = await window.arena.regenerateRoomCode(room.id);
        setRooms((current) => current.map((item) => item.id === room.id ? { ...item, entryCode: newCode } : item));
      }
      if (action === "transfer") {
        await window.arena.transferRoomOwnership(room.id, newOwnerId);
        setRooms((current) => current.map((item) => item.id === room.id ? { ...item, role: "admin" } : item));
      }

      const stillSelected = selectedRoomRef.current === room.id && selectionVersion.current === version;
      if (stillSelected) {
        if (action === "leave" || action === "delete") {
          selectionVersion.current++;
          selectedRoomRef.current = null;
          setActiveRoomId(null);
          setMemberResult(null);
        }
        const messages = {
          leave: "Você saiu da sala.",
          regenerate: "Código regenerado.",
          transfer: "Propriedade transferida.",
          delete: "Sala excluída.",
        };
        setRoomActionMessage(messages[action]);
        setNewOwnerId("");
      }

      try {
        const request = ++roomsRequest.current;
        const result = await window.arena.listMyRooms();
        if (request === roomsRequest.current) {
          setRooms(result);
          setRoomsError("");
          setLoadingRooms(false);
        }
        if (action === "transfer" && selectedRoomRef.current === room.id && selectionVersion.current === version) {
          const members = await window.arena.listRoomMembers(room.id);
          if (selectedRoomRef.current === room.id && selectionVersion.current === version) setMemberResult({ roomId: room.id, members, error: "" });
        }
      } catch {
        if (selectedRoomRef.current === room.id && selectionVersion.current === version && action === "transfer") {
          setMemberResult({ roomId: room.id, members: [], error: "Não foi possível atualizar a lista de membros." });
        }
        setLoadingRooms(false);
        setRoomActionError("A ação foi concluída, mas não foi possível atualizar os dados da sala.");
      }
    } catch (err) {
      if (selectedRoomRef.current === room.id && selectionVersion.current === version) setRoomActionError(getFriendlyPrivacyError(err));
    } finally {
      setRoomActionPending(false);
    }
  };

  useEffect(() => {
    const request = ++roomsRequest.current;
    window.arena.listMyRooms().then((result) => {
      if (request === roomsRequest.current) setRooms(result);
    }).catch((err: unknown) => {
      if (request === roomsRequest.current) setRoomsError(getFriendlyPrivacyError(err));
    }).finally(() => {
      if (request === roomsRequest.current) setLoadingRooms(false);
    });
    return () => { roomsRequest.current++; };
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("O nome da sala não pode ser vazio.");
      return;
    }

    setError("");
    setCreating(true);
    try {
      const room = await window.arena.createRoom(name);
      setEntryCode(room.entryCode);
      setName("");
      try {
        const request = ++roomsRequest.current;
        const result = await window.arena.listMyRooms();
        if (request === roomsRequest.current) {
          setRooms(result);
          setRoomsError("");
          setLoadingRooms(false);
        }
      } catch {
        setLoadingRooms(false);
        setError("Sala criada, mas não foi possível atualizar a lista.");
      }
    } catch (err) {
      setError(getFriendlyPrivacyError(err));
    } finally {
      setCreating(false);
    }
  };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    setJoinSuccess("");
    if (!code.trim()) {
      setJoinError("Informe o código da sala.");
      return;
    }

    setJoinError("");
    setJoining(true);
    try {
      const { roomId } = await window.arena.joinRoom(code);
      if (roomId === null) {
        setJoinError("Código inválido ou limite de tentativas atingido.");
        return;
      }

      setJoinSuccess("Você entrou na sala.");
      setCode("");
      try {
        const request = ++roomsRequest.current;
        const result = await window.arena.listMyRooms();
        if (request === roomsRequest.current) {
          setRooms(result);
          setRoomsError("");
          setLoadingRooms(false);
        }
      } catch {
        setLoadingRooms(false);
        setJoinError("Você entrou na sala, mas não foi possível atualizar a lista.");
      }
    } catch (err) {
      setJoinError(getFriendlyPrivacyError(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <>
      <section className="page-title">
        <div>
          <h1>Salas personalizadas</h1>
        </div>
      </section>
      <div className="rooms-layout">
      <div className="rooms-sidebar">
      <article className="panel">
        <form className="form" onSubmit={create}>
          <label>
            Nome da sala
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="primary" type="submit" disabled={creating || joining}>
            {creating ? "Criando sala..." : "Criar sala"}
          </button>
        </form>
        {entryCode && <p role="status">Código da sala: {entryCode}</p>}
        {error && <p role="alert">{error}</p>}
      </article>
      <article className="panel">
        <form className="form" onSubmit={join}>
          <label>
            Código da sala
            <input value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <button className="primary" type="submit" disabled={joining || creating}>
            {joining ? "Entrando..." : "Entrar"}
          </button>
        </form>
        {joinSuccess && <p role="status">{joinSuccess}</p>}
        {joinError && <p role="alert">{joinError}</p>}
      </article>
      <article className="panel">
        <h2>Minhas salas</h2>
        {loadingRooms && <p role="status">Carregando salas...</p>}
        {roomsError && <p role="alert">{roomsError}</p>}
        {!loadingRooms && !roomsError && rooms.length === 0 && (
          <Empty text="Você ainda não participa de nenhuma sala." />
        )}
        <div className="cards players-list">
          {rooms.map((room) => (
            <div className="player-card" key={room.id}>
              <div>
                <b>{room.name}</b>
                <small>
                  Papel: {room.role === "owner" ? "Proprietário" : room.role === "admin" ? "Administrador" : room.role === "participant" ? "Participante" : "Desconhecido"}
                </small>
                <small>Código: {room.entryCode}</small>
                <small>Membros: {room.memberCount}</small>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={switchingRoom}
                aria-pressed={activeRoomId === room.id}
                onClick={() => {
                  setCopyMessage("");
                  setMemberActionMessage("");
                  setMemberActionError("");
                  setRoomActionMessage("");
                  setRoomActionError("");
                  setNewOwnerId("");
                  setRenameValue("");
                  if (activeRoomId !== room.id) {
                    selectionVersion.current++;
                    setMemberResult(null);
                  }
                  selectedRoomRef.current = room.id;
                  setActiveRoomId(room.id);
                }}
              >
                {switchingRoom && activeRoomId === room.id ? "Carregando dados da sala..." : activeRoomId === room.id ? "Selecionada" : "Entrar"}
              </button>
            </div>
          ))}
        </div>
      </article>
      </div>
      <div className="rooms-detail">
      {roomActionMessage && <p role="status">{roomActionMessage}</p>}
      {roomActionError && <p role="alert">{roomActionError}</p>}
      {selectedRoom && (
        <article className="panel">
          <h2>{selectedRoom.name}</h2>
          <p>Código da sala: {selectedRoom.entryCode}</p>
          <button type="button" className="secondary-button" onClick={() => copyRoomCode(selectedRoom.entryCode)}>
            Copiar
          </button>
          {copyMessage && <p role="status">{copyMessage}</p>}
          {selectedRoom.role === "owner" && (
            <>
              <form className="form" onSubmit={renameRoom}>
                <label>
                  Novo nome
                  <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                </label>
                <button type="submit" className="secondary-button" disabled={renaming || roomActionPending || memberActionPending}>
                  {renaming ? "Renomeando..." : "Confirmar renomeação"}
                </button>
              </form>
              <button type="button" className="secondary-button" disabled={renaming || roomActionPending || memberActionPending} onClick={() => changeRoom("regenerate")}>Regenerar código</button>
              <label>
                Novo proprietário
                <select value={newOwnerId} onChange={(event) => setNewOwnerId(event.target.value)} disabled={renaming || roomActionPending || memberActionPending}>
                  <option value="">Escolha um membro</option>
                  {memberResult?.roomId === selectedRoom.id && memberResult.members.filter((member) => member.role !== "owner").map((member) => (
                    <option key={member.userId} value={member.userId}>{member.displayName}{member.username ? ` (@${member.username})` : ""}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="secondary-button" disabled={renaming || roomActionPending || memberActionPending || !newOwnerId} onClick={() => changeRoom("transfer")}>Transferir propriedade</button>
              <button type="button" className="danger" disabled={renaming || roomActionPending || memberActionPending} onClick={() => changeRoom("delete")}>Excluir sala</button>
            </>
          )}
          {(selectedRoom.role !== "owner" || (memberResult?.roomId === selectedRoom.id && !memberResult.error && memberResult.members.length > 1)) && (
            <button type="button" className="secondary-button" disabled={renaming || roomActionPending || memberActionPending} onClick={() => changeRoom("leave")}>Sair da sala</button>
          )}
          <h3>Membros</h3>
          {memberActionMessage && <p role="status">{memberActionMessage}</p>}
          {memberActionError && <p role="alert">{memberActionError}</p>}
          {memberResult?.roomId !== selectedRoom.id ? (
            <p role="status">Carregando membros...</p>
          ) : memberResult.error ? (
            <p role="alert">{memberResult.error}</p>
          ) : (
            <div className="cards players-list">
              {memberResult.members.map((member) => (
                <div className="player-card" key={member.userId}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt="" width={27} height={27} />
                  ) : (
                    <i>{member.displayName.slice(0, 1).toUpperCase()}</i>
                  )}
                  <div>
                    <b>{member.displayName}</b>
                    {member.username && <small>@{member.username}</small>}
                    <small>{member.role === "owner" ? "Proprietário" : member.role === "admin" ? "Administrador" : member.role === "participant" ? "Participante" : "Desconhecido"}</small>
                  </div>
                  {selectedRoom.role === "owner" && member.role !== "owner" && (
                    <>
                      {member.role === "participant" && (
                        <button type="button" className="secondary-button" disabled={renaming || memberActionPending || roomActionPending} onClick={() => changeMember(selectedRoom.id, member.userId, "promote")}>
                          Promover
                        </button>
                      )}
                      <button type="button" className="danger" disabled={renaming || memberActionPending || roomActionPending} onClick={() => changeMember(selectedRoom.id, member.userId, "remove")}>
                        Remover
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </article>
      )}
      </div>
      </div>
    </>
  );
}

function DashboardPage({
  data,
  players,
  go,
  reload,
  showRoomOnlyTabs,
}: {
  data: Dashboard;
  players: Player[];
  go: (page: Page) => void;
  reload: () => Promise<void>;
  showRoomOnlyTabs: boolean;
}) {
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const { toast, showToast } = useToast();
  const stats = data.statistics;
  const largestStreak = stats?.streaks.reduce<(typeof stats.streaks)[number] | null>(
    (largest, current) => !largest || current.streak > largest.streak ? current : largest,
    null,
  );
  const metrics = [
    { label: "PARTIDAS TOTAIS", value: data.matches, detail: "Partidas registradas" },
    { label: "LÍDER DA TEMPORADA", value: data.leader?.name ?? "—", detail: data.leader ? `${data.leader.points} pontos no ranking geral` : "Sem líder" },
    { label: "MAIOR SEQUÊNCIA", value: largestStreak?.streak ?? 0, detail: largestStreak?.streak ? `${largestStreak.name} · sequência atual` : "Nenhuma sequência atual" },
  ];
  const trendPoints = stats?.rankingTrend[0]?.points ?? [];
  const maxTrend = Math.max(...trendPoints.map((point) => point.position), 1);
  const trendPath = trendPoints.length
    ? trendPoints
        .map((point, index) => {
          const x = (index / Math.max(trendPoints.length - 1, 1)) * 230;
          const y =
            10 + ((point.position - 1) / Math.max(maxTrend - 1, 1)) * 45;
          return `${index === 0 ? "M" : "L"}${x},${y}`;
        })
        .join(" ")
    : "";
  return (
    <>
      <section className="page-title">
        <div>
          <p>VISÃO GERAL</p>
          <h1>Bem-vindo à Arena</h1>
          <span>Campeonatos, partidas e estatísticas em um único lugar.</span>
        </div>
        {showRoomOnlyTabs && (
          <button className="primary" onClick={() => go("matches")}>
            <CirclePlus size={18} /> Registrar partida
          </button>
        )}
      </section>
      <section className="metrics dashboard-metrics">
        {metrics.map(({ label, value, detail }) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <div className="highlight-details">
              {label === "LÍDER DA TEMPORADA" && data.leader && (
                <HighlightAvatar name={data.leader.name} player={players.find((player) => player.id === data.leader?.id)} />
              )}
              <div><strong>{value}</strong><small>{detail}</small></div>
            </div>
          </article>
        ))}
      </section>
      <section className="grid">
        <article className="panel wide">
          <div className="panel-head">
            <h2>Ranking geral</h2>
          </div>
          {data.ranking.length ? (
            <Ranking rows={data.ranking} />
          ) : (
            <Empty text="Registre jogadores e partidas para iniciar o ranking." />
          )}
        </article>
        <article className="panel statistics-panel">
          <div className="panel-head">
            <h2>Central de estatísticas</h2>
          </div>
          {!stats ? (
            <Empty text="Sem dados estatísticos disponíveis ainda." />
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-card">
                  <span>Melhor forma</span>
                  <strong>{stats.bestForm ? stats.bestForm.name : "—"}</strong>
                  <small>
                    {stats.bestForm
                      ? `${stats.bestForm.value}% nos últimos jogos`
                      : "Nenhum registro"}
                  </small>
                </div>
                <div className="stat-card">
                  <span>Artilheiro</span>
                  <strong>
                    {stats.topScorer ? stats.topScorer.name : "—"}
                  </strong>
                  <small>
                    {stats.topScorer
                      ? `${stats.topScorer.value} gols`
                      : "Nenhum registro"}
                  </small>
                </div>
                <div className="stat-card">
                  <span>Saldo</span>
                  <strong>
                    {stats.bestGoalDifference
                      ? stats.bestGoalDifference.name
                      : "—"}
                  </strong>
                  <small>
                    {stats.bestGoalDifference
                      ? `${stats.bestGoalDifference.value} saldo`
                      : "Nenhum registro"}
                  </small>
                </div>
                <div className="stat-card">
                  <span>Mais partidas</span>
                  <strong>
                    {stats.mostPlayedPlayer ? stats.mostPlayedPlayer.name : "—"}
                  </strong>
                  <small>
                    {stats.mostPlayedPlayer
                      ? `${stats.mostPlayedPlayer.value} jogos`
                      : "Nenhum registro"}
                  </small>
                </div>
              </div>

              <div className="stats-surface">
                <div className="stats-mini">
                  <span className="eyebrow">Tendência</span>
                  {stats.rankingTrend.length ? (
                    <>
                      <h3>{stats.rankingTrend[0].name}</h3>
                      <svg
                        viewBox="0 0 230 70"
                        role="img"
                        aria-label="Gráfico de tendência de ranking"
                      >
                        <path d={trendPath} />
                      </svg>
                    </>
                  ) : (
                    <Empty text="Sem partidas para formar o histórico." />
                  )}
                </div>
                <div className="stats-mini compact">
                  <span className="eyebrow">Último campeão</span>
                  {stats.lastChampion ? (
                    <>
                      <strong>{stats.lastChampion.championName}</strong>
                      <small>{stats.lastChampion.championshipName}</small>
                    </>
                  ) : (
                    <small>Nenhuma temporada terminada.</small>
                  )}
                </div>
              </div>
            </>
          )}
        </article>
        <article className="panel">
          <div className="panel-head">
            <h2>Rivalidade da Semana</h2>
          </div>
          <Empty text="Sem dados de rivalidade ainda" />
        </article>
        <article className="panel dashboard-recent">
          <div className="panel-head">
            <h2>Últimas partidas</h2>
          </div>
          {data.recent.length ? (
            <div className="games">
              {data.recent.map((m) => (
                <div key={m.id} className="dashboard-recent-match">
                  <Game
                    match={m}
                    players={players}
                    onEdit={setEditingMatch}
                    onShare={async (match) => {
                      await copyMatchSummary(match);
                      showToast("Resumo copiado para o WhatsApp.");
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Nenhuma partida registrada." />
          )}
        </article>
      </section>
      {editingMatch && (
        <EditMatchModal
          match={editingMatch}
          onClose={() => setEditingMatch(null)}
          onSaved={async () => {
            setEditingMatch(null);
            await reload();
          }}
        />
      )}
      <Toast message={toast} />
    </>
  );
}
function PlayersPage({
  players,
  reload,
  activeRoomId,
}: {
  players: Player[];
  reload: () => Promise<void>;
  activeRoomId: string | null;
}) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [deletePlayer, setDeletePlayer] = useState<Player | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await window.arena.savePlayer({ name, nickname }, activeRoomId);
    setName("");
    setNickname("");
    await reload();
  };
  return (
    <>
      <section className="page-title">
        <div>
          <p>ELENCO</p>
          <h1>Jogadores</h1>
        </div>
      </section>
      <section className="grid players-layout">
        <article className="panel">
          <div className="panel-head">
            <h2>Adicionar jogador</h2>
          </div>
          <form className="form" onSubmit={save}>
            <label>
              Nome
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              Apelido
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                required
              />
            </label>
            <button className="primary">Adicionar jogador</button>
          </form>
        </article>
        <article className="panel wide">
          <div className="cards players-list">
            {players.map((p) => (
              <div className="player-card" key={p.id}>
                <i>{p.name[0]}</i>
                <div>
                  <b>{p.name}</b>
                  <small>@{p.nickname}</small>
                </div>
                <button className="danger" onClick={() => setDeletePlayer(p)}>
                  Excluir
                </button>
              </div>
            ))}
            {!players.length && <Empty text="Adicione o primeiro jogador." />}
          </div>
        </article>
      </section>
      {deletePlayer && (
        <AppModal
          title="Excluir jogador?"
          message={`Tem certeza que deseja excluir ${deletePlayer.name}? As partidas e participações desse jogador também serão removidas.`}
          confirmText="Excluir"
          cancelText="Cancelar"
          danger
          onClose={() => setDeletePlayer(null)}
          onConfirm={async () => {
            await window.arena.deletePlayer(deletePlayer.id);
            await reload();
          }}
        />
      )}
    </>
  );
}
/**
 * Seletor de time com busca (P1-2): substitui o fluxo antigo de "ativar o
 * campo para depois escolher". Cada jogador tem seu slot sempre visível, com
 * indicação clara de quem ainda está sem time (âmbar + "!") e confirmação
 * verde quando preenchido. Reutilizado no formulário avulso e no modal de
 * resultado de confronto do campeonato.
 * Comportamentos preservados do picker anterior: busca por nome/liga/país,
 * edição da busca invalida a seleção atual, clique fora fecha a lista.
 */
function TeamPicker({
  label,
  teams,
  value,
  onChange,
  excludeTeamIds,
}: {
  label: string;
  teams: Team[];
  value: Team | null;
  onChange: (team: Team | null) => void;
  excludeTeamIds?: number[];
}) {
  const [search, setSearch] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [leagueFilter, setLeagueFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  const excluded = new Set(excludeTeamIds ?? []);
  const availableTeams = teams.filter(
    (t) => !excluded.has(t.id) || t.id === value?.id,
  );
  const leagues = Array.from(
    new Set(availableTeams.map((t) => t.league)),
  ).sort();
  const countries = Array.from(
    new Set(availableTeams.map((t) => t.country)),
  ).sort();

  const query = search.toLowerCase();
  const filtered = availableTeams.filter(
    (t) =>
      (!query || t.name.toLowerCase().includes(query)) &&
      (!leagueFilter || t.league === leagueFilter) &&
      (!countryFilter || t.country === countryFilter),
  );

  return (
    <div
      className="team-picker"
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="team-picker-label">{label}</span>
      <div className={`team-picker-slot ${value ? "filled" : "pending"}`}>
        <input
          type="text"
          placeholder="Buscar por nome..."
          value={search}
          autoComplete="off"
          aria-label={label}
          onChange={(event) => {
            setSearch(event.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
        />
        <span
          className={`team-picker-status ${value ? "ok" : "missing"}`}
          aria-hidden
        >
          {value ? <Check size={13} /> : "!"}
        </span>
      </div>
      {value && (
        <small className="team-picker-picked">
          <Shield size={12} /> {value.name} · {value.league}
        </small>
      )}
      {open && (
        <div className="team-picker-results team-results">
          <div className="team-picker-filters">
            <select
              value={leagueFilter}
              onChange={(event) => setLeagueFilter(event.target.value)}
              aria-label="Filtrar por liga"
            >
              <option value="">Todas as ligas</option>
              {leagues.map((league) => (
                <option key={league} value={league}>
                  {league}
                </option>
              ))}
            </select>
            <select
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value)}
              aria-label="Filtrar por país"
            >
              <option value="">Todos os países</option>
              {countries.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
          </div>
          {filtered.map((team) => (
            <button
              type="button"
              key={team.id}
              className={value?.id === team.id ? "picked" : ""}
              onClick={() => {
                onChange(team);
                setSearch(team.name);
                setOpen(false);
              }}
            >
              <span>
                <Shield size={14} />
              </span>
              <div>
                <b>{team.name}</b>
                <small>
                  {team.league} · {team.country}
                </small>
              </div>
              {value?.id === team.id && <Check size={13} />}
            </button>
          ))}
          {!filtered.length && (
            <p className="team-picker-empty">Nenhum time encontrado</p>
          )}
        </div>
      )}
    </div>
  );
}

function RankingPage({ data, players }: { data: Dashboard; players: Player[] }) {
  const [tab, setTab] = useState<"geral" | "individuais" | "confrontos">("geral");
  const [sortBy, setSortBy] = useState<"goals" | "winrate" | "goaldiff" | "wins">("goals");
  const rankingFilters = [
    { id: "goals", label: "Artilharia" },
    { id: "winrate", label: "Aproveitamento" },
    { id: "goaldiff", label: "Saldo de gols" },
    { id: "wins", label: "Vitórias" },
  ] as const;
  const sortedRanking = [...data.ranking].sort((a, b) => {
    switch (sortBy) {
      case "goals": return b.goalsFor - a.goalsFor;
      case "winrate": return b.winRate - a.winRate;
      case "goaldiff": return (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst);
      case "wins": return b.wins - a.wins;
    }
  });
  const stats = data.statistics;
  const largestStreak = stats?.streaks.reduce<(typeof stats.streaks)[number] | null>(
    (largest, current) => !largest || current.streak > largest.streak ? current : largest,
    null,
  );
  const tabs = [
    { id: "geral", label: "Classificação Geral" },
    { id: "individuais", label: "Estatísticas Individuais" },
    { id: "confrontos", label: "Confrontos Diretos" },
  ] as const;

  return (
    <>
      <section className="page-title">
        <div>
          <p>CLASSIFICAÇÃO</p>
          <h1>Ranking geral</h1>
        </div>
      </section>
      <div className="ranking-tabs" aria-label="Seções do ranking">
        {tabs.map(({ id, label }) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab !== "geral" ? (
        <article className="panel"><Empty text="Em breve" /></article>
      ) : (
        <>
          <section className="metrics dashboard-metrics">
            <article className="metric">
              <span>ARTILHEIRO</span>
              <div className="highlight-details">
                {stats?.topScorer && <HighlightAvatar name={stats.topScorer.name} player={players.find((player) => player.id === stats.topScorer?.id)} />}
                <div><strong>{stats?.topScorer?.name ?? "—"}</strong>{stats?.topScorer && <small>{stats.topScorer.value} gols</small>}</div>
              </div>
            </article>
            <article className="metric">
              <span>MELHOR APROVEITAMENTO</span>
              <div className="highlight-details">
                {stats?.bestWinRate && <HighlightAvatar name={stats.bestWinRate.name} player={players.find((player) => player.id === stats.bestWinRate?.id)} />}
                <div><strong>{stats?.bestWinRate?.name ?? "—"}</strong>{stats?.bestWinRate && <small>{stats.bestWinRate.value}%</small>}</div>
              </div>
            </article>
            <article className="metric">
              <span>MAIOR SEQUÊNCIA ATUAL</span>
              <div className="highlight-details">
                {!!largestStreak?.streak && <HighlightAvatar name={largestStreak.name} player={players.find((player) => player.id === largestStreak.playerId)} />}
                <div><strong>{largestStreak?.streak ? largestStreak.name : "—"}</strong>{!!largestStreak?.streak && <small>{largestStreak.streak} vitórias seguidas</small>}</div>
              </div>
            </article>
          </section>
          <section className="ranking-layout">
            <article className="panel">
              <div className="panel-head"><h2>Classificação Geral</h2></div>
              <div className="ranking-filters" aria-label="Filtros da classificação">
                {rankingFilters.map(({ id, label }) => (
                  <button key={id} type="button" className={sortBy === id ? "active" : ""} aria-pressed={sortBy === id} onClick={() => setSortBy(id)}>{label}</button>
                ))}
              </div>
              <Ranking rows={sortedRanking} />
            </article>
            <article className="panel ranking-insights">
              <div className="panel-head"><h2>Insights</h2></div>
              <div><span>Jogador Mais Participativo</span><strong>{stats?.mostPlayedPlayer?.name ?? "—"}</strong>{stats?.mostPlayedPlayer && <small>{stats.mostPlayedPlayer.value} partidas</small>}</div>
              <div><span>Melhor Fase</span><strong>{stats?.bestForm?.name ?? "—"}</strong>{stats?.bestForm && <small>{stats.bestForm.value}% nos últimos jogos</small>}</div>
              <div><span>Maior Evolução</span><strong>—</strong></div>
              <div><span>Distribuição de Gols (Top 5)</span><div className="ranking-chart-placeholder">Gráfico em breve</div></div>
            </article>
          </section>
        </>
      )}
    </>
  );
}

function MatchesPage({
  players,
  teams,
  reload,
  totalMatches,
}: {
  players: Player[];
  teams: Team[];
  reload: () => Promise<void>;
  totalMatches: number;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [competitionFilter, setCompetitionFilter] = useState<"all" | "championship" | "casual">("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "30days">("all");
  const [playerFilter, setPlayerFilter] = useState("");
  const [matchesLoaded, setMatchesLoaded] = useState(false);
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [deletingMatch, setDeletingMatch] = useState<Match | null>(null);
  const [formError, setFormError] = useState("");
  const [pickerEpoch, setPickerEpoch] = useState(0);
  const { toast, showToast } = useToast();
  const [form, setForm] = useState({
    player1Id: "",
    team1Id: "",
    score1: "0",
    score2: "0",
    player2Id: "",
    team2Id: "",
  });

  useEffect(() => {
    window.arena
      .matches()
      .then(setMatches)
      .catch(() => setMatches([]))
      .finally(() => setMatchesLoaded(true));
  }, []);

  const team1 = teams.find((t) => String(t.id) === form.team1Id) ?? null;
  const team2 = teams.find((t) => String(t.id) === form.team2Id) ?? null;
  const search = playerFilter.trim().toLocaleLowerCase("pt-BR");
  const now = Date.now();
  const filteredMatches = matches.filter((match) => {
    const hasChampionship = Boolean(match.championship);
    if (competitionFilter === "championship" && !hasChampionship) return false;
    if (competitionFilter === "casual" && hasChampionship) return false;
    if (periodFilter === "30days") {
      const playedAt = new Date(match.playedAt).getTime();
      if (!Number.isFinite(playedAt) || playedAt < now - 30 * 24 * 60 * 60 * 1000 || playedAt > now) return false;
    }
    return !search || match.player1.toLocaleLowerCase("pt-BR").includes(search) || match.player2.toLocaleLowerCase("pt-BR").includes(search);
  });
  const select = (
    key: keyof typeof form,
    label: string,
    items: { id: number; name: string }[],
    optional = false,
  ) => (
    <label>
      {label}
      <select
        value={form[key]}
        required={!optional}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      >
        <option value="">{optional ? "Partida avulsa" : "Selecionar"}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );

  const scores = Array.from({ length: 21 }, (_, id) => ({
    id,
    name: String(id),
  }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");

    const player1Id = Number(form.player1Id);
    const player2Id = Number(form.player2Id);
    const team1Id = Number(form.team1Id);
    const team2Id = Number(form.team2Id);

    if (!player1Id || !player2Id || !team1Id || !team2Id) {
      setFormError("Selecione os dois jogadores e os dois times.");
      return;
    }

    if (player1Id === player2Id) {
      setFormError("Escolha jogadores diferentes.");
      return;
    }

    if (team1Id === team2Id) {
      setFormError("Escolha times diferentes.");
      return;
    }

    try {
      await window.arena.saveMatch({
        player1Id,
        player2Id,
        team1Id,
        team2Id,
        score1: Number(form.score1),
        score2: Number(form.score2),
      });
      playArenaSound("whistle");

      setMatches(await window.arena.matches());
      setForm({
        player1Id: "",
        team1Id: "",
        score1: "0",
        score2: "0",
        player2Id: "",
        team2Id: "",
      });
      setPickerEpoch((epoch) => epoch + 1);
      await reload();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a partida.",
      );
    }
  };

  return (
    <>
      <section className="page-title">
        <div>
          <p>CENTRO DE JOGOS</p>
          <h1>Registrar partida</h1>
          <span>
            Partida avulsa: o resultado entra direto no histórico e no ranking.
            Resultados de campeonato são registrados na tela de detalhes da
            temporada, junto ao confronto pendente.
          </span>
        </div>
      </section>
      <section className="metrics dashboard-metrics">
        <article className="metric">
          <span>PARTIDAS TOTAIS</span>
          <strong>{totalMatches}</strong>
        </article>
        <article className="metric">
          <span>JOGADORES ATIVOS</span>
          <strong>—</strong>
        </article>
        <article className="metric">
          <span>COMPETIÇÃO ATUAL</span>
          <strong>—</strong>
        </article>
      </section>
      <section className="matches-layout">
        <article className="panel">
          <form className="form match-form" onSubmit={submit}>
            <div className="match-lanes">
              <div className="match-lane">
                {select("player1Id", "Jogador 1", players)}
                <TeamPicker
                  key={`team1-${pickerEpoch}`}
                  label="Time do jogador 1"
                  teams={teams}
                  value={team1}
                  onChange={(picked) =>
                    setForm((current) => ({
                      ...current,
                      team1Id: picked ? String(picked.id) : "",
                    }))
                  }
                />
              </div>
              <div className="match-center">
                <div className="score">
                  {select("score1", "Gols", scores)}
                  <strong>×</strong>
                  {select("score2", "Gols", scores)}
                </div>
              </div>
              <div className="match-lane">
                {select("player2Id", "Jogador 2", players)}
                <TeamPicker
                  key={`team2-${pickerEpoch}`}
                  label="Time do jogador 2"
                  teams={teams}
                  value={team2}
                  onChange={(picked) =>
                    setForm((current) => ({
                      ...current,
                      team2Id: picked ? String(picked.id) : "",
                    }))
                  }
                />
              </div>
            </div>
            {formError && <div className="arena-form-error">{formError}</div>}
            <button className="primary">Salvar resultado</button>
          </form>
          <HeadToHeadCard
            matches={matches}
            players={players}
            player1Id={form.player1Id}
            player2Id={form.player2Id}
            loading={!matchesLoaded}
          />
        </article>
        <article className="panel wide">
          <div className="panel-head">
            <h2>Últimas partidas</h2>
            <button className="danger" onClick={() => setShowClearModal(true)}>
              Limpar histórico
            </button>
          </div>
          <div className="matches-filters form">
            <label>
              Competição
              <select value={competitionFilter} onChange={(e) => setCompetitionFilter(e.target.value as typeof competitionFilter)}>
                <option value="all">Todas as competições</option>
                <option value="championship">Com campeonato</option>
                <option value="casual">Sem campeonato</option>
              </select>
            </label>
            <label>
              Período
              <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)}>
                <option value="all">Todos os períodos</option>
                <option value="30days">Últimos 30 dias</option>
              </select>
            </label>
            <label>
              Busca
              <input value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} placeholder="Buscar jogador" />
            </label>
          </div>
          <div className="games matches-history">
            {filteredMatches.map((m) => (
              <Game
                key={m.id}
                match={m}
                players={players}
                onEdit={setEditingMatch}
                onDelete={setDeletingMatch}
                onShare={async (match) => {
                  await copyMatchSummary(match);
                  showToast("Resumo copiado para o WhatsApp.");
                }}
              />
            ))}
            {!filteredMatches.length && <Empty text="Nenhuma partida encontrada com esses filtros." />}
          </div>
        </article>
      </section>

      {editingMatch && (
        <EditMatchModal
          match={editingMatch}
          onClose={() => setEditingMatch(null)}
          onSaved={async () => {
            setEditingMatch(null);
            setMatches(await window.arena.matches());
            await reload();
          }}
        />
      )}
      {showClearModal && (
        <AppModal
          title="Limpar histórico?"
          message="Todas as partidas registradas serão apagadas. Essa ação não pode ser desfeita."
          confirmText="Limpar histórico"
          cancelText="Cancelar"
          danger
          onClose={() => setShowClearModal(false)}
          onConfirm={async () => {
            await window.arena.clearMatches();
            setMatches(await window.arena.matches());
            await reload();
          }}
        />
      )}
      {deletingMatch && (
        <AppModal
          title="Apagar resultado?"
          message={`O placar de ${deletingMatch.player1} x ${deletingMatch.player2} será removido do histórico.`}
          confirmText="Apagar resultado"
          danger
          onClose={() => setDeletingMatch(null)}
          onConfirm={async () => {
            await window.arena.deleteMatch(deletingMatch.id);
            setMatches(await window.arena.matches());
            await reload();
          }}
        />
      )}
      <Toast message={toast} />
    </>
  );
}

const CARD_TONES = [
  "#876fff",
  "#35cbb9",
  "#ff6aa7",
  "#e4bd55",
  "#5aa8ff",
  "#ef7b4d",
];

type MutatorRarity = "comum" | "incomum" | "raro" | "epico" | "lendario";

const MUTATORS = [
  {
    icon: UsersRound,
    title: "10 em Campo",
    text: "Jogue com um a menos até o apito final. Antes do jogo, escolha um jogador titular para deixar no banco.",
    tag: "ELENCO",
    rarity: "comum",
  },
  {
    icon: Shield,
    title: "Defesa de Papel",
    text: "Durante os primeiros 10 minutos, não pode trocar manualmente para os zagueiros. Deixe a defesa se virar!",
    tag: "DEFESA",
    rarity: "incomum",
  },
  {
    icon: Shuffle,
    title: "Improviso Tático",
    text: "Antes do início, escolha uma formação diferente da sua habitual e mantenha-a durante toda a partida.",
    tag: "TÁTICA",
    rarity: "comum",
  },
  {
    icon: Goal,
    title: "Pé Ruim",
    text: "Durante 5 minutos, tente finalizar apenas com o pé não dominante. Se marcar com o pé dominante, o adversário ganha um escanteio.",
    tag: "TÉCNICA",
    rarity: "epic",
  },
  {
    icon: EyeOff,
    title: "Visão Turva",
    text: "Jogue sem minimapa e sem HUD durante os primeiros 10 minutos. Vale confiar apenas nos próprios olhos!",
    tag: "FOCO",
    rarity: "raro",
  },
  {
    icon: Gauge,
    title: "Goleiro Linha",
    text: "Uma vez por tempo, avance o goleiro até perto do meio-campo durante um ataque. Se perder a bola, não vale reclamar!",
    tag: "CAOS",
    rarity: "incomum",
  },
  {
    icon: Footprints,
    title: "Proibido Correr",
    text: "Durante os próximos 3 minutos, está proibido usar o botão de corrida. Só vale conduzir a bola normalmente.",
    tag: "TÉCNICA",
    rarity: "comum",
  },
  {
    icon: Ban,
    title: "Drible é Luxo",
    text: "Durante 5 minutos, não pode usar dribles com comandos especiais. Só vale condução normal e passes.",
    tag: "TÉCNICA",
    rarity: "incomum",
  },
  {
    icon: Timer,
    title: "Relógio Maldito",
    text: "Durante 5 minutos, você precisa tentar finalizar em até 10 segundos após entrar no campo de ataque.",
    tag: "PRESSÃO",
    rarity: "raro",
  },
  {
    icon: Shield,
    title: "Ônibus Estacionado",
    text: "Durante 5 minutos, não pode pressionar manualmente com mais de 3 jogadores no campo de ataque.",
    tag: "DEFESA",
    rarity: "incomum",
  },
  {
    icon: Zap,
    title: "Chute de Desespero",
    text: "Durante 3 minutos, todo chute de fora da área precisa ser de primeira, sem dominar a bola antes.",
    tag: "ATAQUE",
    rarity: "raro",
  },
  {
    icon: CircleHelp,
    title: "Sem Repeteco",
    text: "Depois de usar uma jogada ensaiada ou escanteio curto, você não pode repetir a mesma jogada na próxima oportunidade.",
    tag: "ESTRATÉGIA",
    rarity: "incomum",
  },
  {
    icon: Flame,
    title: "Modo Fúria",
    text: "Se sofrer um gol, você tem 2 minutos para tentar marcar. Durante esse período, não pode recuar a bola para o goleiro.",
    tag: "CAOS",
    rarity: "epic",
  },
  {
    icon: Snowflake,
    title: "Pés Congelados",
    text: "Durante os próximos 3 minutos, não pode finalizar de primeira: precisa dominar a bola antes do chute.",
    tag: "TÉCNICA",
    rarity: "incomum",
  },
  {
    icon: RotateCcw,
    title: "Revanche Imediata",
    text: "Se sofrer um gol, na saída de bola precisa tentar um ataque rápido antes de trocar mais de 5 passes.",
    tag: "CAOS",
    rarity: "raro",
  },
  {
    icon: MessageCircle,
    title: "Narrador de Rádio",
    text: "Durante os próximos 3 minutos, narre suas próprias jogadas como se estivesse transmitindo uma final de Copa do Mundo.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Mic,
    title: "Coletiva de Imprensa",
    text: "Antes da partida, faça uma declaração de até 15 segundos prometendo a vitória. Se perder, dê uma entrevista explicando o vexame.",
    tag: "RESENHA",
    rarity: "incomum",
  },
  {
    icon: Laugh,
    title: "Riso Proibido",
    text: "Durante os próximos 2 minutos, você não pode rir. Se rir, precisa elogiar sinceramente uma jogada do adversário.",
    tag: "MENTAL",
    rarity: "incomum",
  },
  {
    icon: Volume2,
    title: "Comentarista do Caos",
    text: "Durante 3 minutos, comente em voz alta tudo o que seu próprio time fizer, inclusive os erros.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Hand,
    title: "Mãos de Alface",
    text: "Na próxima chance clara de gol que perder, levante e faça uma comemoração dramática de derrota.",
    tag: "PUNIÇÃO",
    rarity: "raro",
  },
  {
    icon: Trophy,
    title: "Marra Antecipada",
    text: "Antes do jogo, faça uma comemoração como se já tivesse vencido. Se perder, repita a comemoração com cara de tristeza.",
    tag: "RESENHA",
    rarity: "incomum",
  },
  {
    icon: Heart,
    title: "Fair Play Forçado",
    text: "Na próxima falta que cometer, peça desculpas ao adversário com a maior formalidade possível.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: CircleHelp,
    title: "Confiança Suspeita",
    text: "Antes do apito inicial, declare quantos gols vai marcar. Se fizer menos, reconheça que exagerou na confiança.",
    tag: "MENTAL",
    rarity: "incomum",
  },
  {
    icon: Timer,
    title: "Silêncio no Estádio",
    text: "Durante os próximos 2 minutos, é proibido reclamar, provocar ou comentar o jogo. Só pode falar em caso de pausa ou bola fora.",
    tag: "MENTAL",
    rarity: "raro",
  },
  {
    icon: Shuffle,
    title: "Apelido de Craque",
    text: "Durante os próximos 5 minutos, o adversário só pode chamar você pelo apelido de um jogador famoso escolhido antes da partida.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Flame,
    title: "Promessa de Craque",
    text: "Escolha um jogador do seu time e declare que ele vai decidir a partida. Se ele marcar, comemore como se tivesse previsto o futuro.",
    tag: "RESENHA",
    rarity: "incomum",
  },
  {
    icon: MessageCircle,
    title: "Pedido de VAR",
    text: "Na próxima reclamação sobre uma jogada, apresente um argumento convincente como se estivesse diante de um árbitro de vídeo.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Footprints,
    title: "Caranguejo FC",
    text: "Durante os próximos 3 minutos, você só pode atacar pelas laterais. Se entrar pelo centro, precisa devolver a bola para trás.",
    tag: "TÁTICA",
    rarity: "incomum",
  },
  {
    icon: Zap,
    title: "Chutou, Rezou",
    text: "Durante 3 minutos, toda vez que entrar na área adversária, você precisa tentar finalizar antes de fazer mais de 3 passes.",
    tag: "ATAQUE",
    rarity: "raro",
  },
  {
    icon: Shield,
    title: "Defesa em Pânico",
    text: "Durante os próximos 2 minutos, você não pode recuar voluntariamente a bola para o seu campo de defesa.",
    tag: "DEFESA",
    rarity: "raro",
  },
  {
    icon: Shuffle,
    title: "Futebol de Primeira",
    text: "Durante 3 minutos, você não pode dar mais de 2 toques consecutivos com o mesmo jogador antes de passar ou finalizar.",
    tag: "TÉCNICA",
    rarity: "epic",
  },
  {
    icon: Timer,
    title: "Ataque Relâmpago",
    text: "Durante 3 minutos, depois de recuperar a bola, você tem 15 segundos para tentar uma finalização.",
    tag: "PRESSÃO",
    rarity: "raro",
  },
  {
    icon: MessageCircle,
    title: "Advogado do Diabo",
    text: "Durante os próximos 3 minutos, você precisa defender verbalmente todas as decisões controversas do árbitro, mesmo quando elas prejudicarem você.",
    tag: "RESENHA",
    rarity: "incomum",
  },
  {
    icon: Mic,
    title: "Comentarista Imparcial",
    text: "Durante 2 minutos, você precisa narrar as jogadas dos dois jogadores como um comentarista profissional, sem demonstrar preferência.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Laugh,
    title: "Cara de Enterro",
    text: "Durante os próximos 3 minutos, você não pode comemorar, sorrir ou demonstrar empolgação quando marcar um gol.",
    tag: "MENTAL",
    rarity: "incomum",
  },
  {
    icon: Heart,
    title: "Elogio Obrigatório",
    text: "Na próxima jogada bonita do adversário, você precisa elogiá-lo sinceramente antes de voltar a jogar.",
    tag: "RESENHA",
    rarity: "comum",
  },
  {
    icon: Trophy,
    title: "Cerimônia de Campeão",
    text: "Se marcar o próximo gol, faça uma comemoração como se tivesse acabado de conquistar um título mundial.",
    tag: "RESENHA",
    rarity: "incomum",
  },
  {
    icon: Ban,
    title: "Proibido Recuar",
    text: "Durante os próximos 3 minutos, você não pode fazer passes voluntários para trás no campo de ataque.",
    tag: "TÁTICA",
    rarity: "epic",
  },
  {
    icon: Zap,
    title: "Só Vale Golaço",
    text: "Durante 3 minutos, você só pode tentar finalizar de fora da área. Gols de dentro da área não contam para o desafio.",
    tag: "ATAQUE",
    rarity: "epic",
  },
  {
    icon: Snowflake,
    title: "Congelamento Total",
    text: "Durante os próximos 2 minutos, você não pode usar comandos especiais de drible nem corrida. Precisa construir as jogadas com passes e movimentação.",
    tag: "TÉCNICA",
    rarity: "raro",
  },
  {
    icon: RotateCcw,
    title: "Virada ou Vergonha",
    text: "Se estiver perdendo, você precisa tentar marcar nos próximos 3 minutos. Se estiver empatando ou vencendo, precisa marcar mais um gol nesse período.",
    tag: "PRESSÃO",
    rarity: "lendario",
  },
  {
    icon: Flame,
    title: "Tudo ou Nada",
    text: "Durante os próximos 3 minutos, você precisa jogar buscando o gol. Não pode manter a posse apenas para gastar tempo.",
    tag: "CAOS",
    rarity: "lendario",
  },
  {
    icon: Footprints,
    title: "Agachamento do Gol",
    text: "Sempre que sofrer um gol, faça 5 agachamentos na próxima pausa.",
    tag: "Físico",
    rarity: "comum",
  },
  {
    icon: Flame,
    title: "Polichinelos da Derrota",
    text: "Se estiver perdendo por 2 gols ou mais, faça 10 polichinelos na próxima pausa.",
    tag: "Resistência",
    rarity: "incomum",
  },
  {
    icon: Shield,
    title: "Flexão do Sofrimento",
    text: "Ao sofrer 3 gols, faça 5 flexões na próxima pausa. Você pode adaptar o exercício ao seu condicionamento.",
    tag: "Força",
    rarity: "raro",
  },
  {
    icon: Gauge,
    title: "Corrida no Lugar",
    text: "Se sofrer 2 gols consecutivos, corra no lugar por 10 segundos durante a próxima pausa.",
    tag: "Cardio",
    rarity: "incomum",
  },
  {
    icon: Trophy,
    title: "Pose de Craque",
    text: "Ao marcar um gol, imite a pose de comemoração de um jogador por 5 segundos. Seu adversário precisa adivinhar quem é.",
    tag: "Comédia",
    rarity: "comum",
  },
  {
    icon: Snowflake,
    title: "Modo Estátua",
    text: "Quando sofrer um gol, fique imóvel por 5 segundos antes de retomar a partida. Faça isso somente com a bola fora de jogo.",
    tag: "Comédia",
    rarity: "comum",
  },
  {
    icon: Zap,
    title: "Aquecimento do Craque",
    text: "Antes da partida, faça 5 agachamentos, 5 polichinelos e 5 elevações de joelho.",
    tag: "Aquecimento",
    rarity: "comum",
  },
  {
    icon: Timer,
    title: "Prancha da Concentração",
    text: "Na primeira pausa depois de sofrer um gol, faça uma prancha de 15 segundos.",
    tag: "Força",
    rarity: "raro",
  },
  {
    icon: RotateCcw,
    title: "Caminhada da Vergonha",
    text: "Se terminar o primeiro tempo perdendo, dê uma volta caminhando ao redor da cadeira antes do segundo tempo.",
    tag: "Comédia",
    rarity: "incomum",
  },
  {
    icon: UsersRound,
    title: "Duelo de Resistência",
    text: "Durante uma pausa, os dois jogadores ficam em posição de agachamento isométrico por até 15 segundos. Quem desistir primeiro perde o desafio.",
    tag: "Duelo",
    rarity: "epic",
  },
  {
    icon: Flame,
    title: "Sobrevivente",
    text: "Ao sofrer 4 gols, faça 10 polichinelos durante a próxima pausa.",
    tag: "Resistência",
    rarity: "epic",
  },
  {
    icon: Goal,
    title: "Gol de Ouro, Pernas de Aço",
    text: "Quando marcar o gol que coloca você na frente pela primeira vez, faça 5 agachamentos comemorativos na próxima pausa.",
    tag: "Força",
    rarity: "raro",
  },
  {
    icon: Footprints,
    title: "Pé de Pano",
    text: "Durante uma pausa, dê 10 passos curtos tentando manter o equilíbrio, sem correr.",
    tag: "Coordenação",
    rarity: "incomum",
  },
  {
    icon: Zap,
    title: "A Última Esperança",
    text: "Se estiver perdendo por 3 gols ou mais, faça 10 segundos de corrida no lugar durante a próxima pausa.",
    tag: "Cardio",
    rarity: "epic",
  },
  {
    icon: Trophy,
    title: "Tudo nas Pernas",
    text: "Antes da partida, os dois jogadores fazem 10 agachamentos. Se alguém não conseguir, pode adaptar o exercício para uma versão mais leve.",
    tag: "Desafio",
    rarity: "lendario",
  },
  {
    icon: Shield,
    title: "Muralha Humana",
    text: "Seu objetivo é terminar a partida sofrendo no máximo 1 gol. Se conseguir, complete o desafio. Se sofrer mais, o mutador falha.",
    tag: "Desafio pessoal",
    rarity: "raro",
  },
  {
    icon: Goal,
    title: "Artilheiro Solitário",
    text: "Você precisa marcar pelo menos 3 gols com o mesmo jogador. Se conseguir até o apito final, vence o desafio.",
    tag: "Objetivo",
    rarity: "epic",
  },
  {
    icon: Trophy,
    title: "Vitória por Convicção",
    text: "Você precisa vencer por pelo menos 2 gols de diferença. Se vencer por apenas 1, o desafio não será concluído.",
    tag: "Objetivo",
    rarity: "raro",
  },
  {
    icon: Shuffle,
    title: "Gol Democrático",
    text: "Tente marcar gols com pelo menos 3 jogadores diferentes. Se conseguir, complete o mutador.",
    tag: "Objetivo",
    rarity: "incomum",
  },
  {
    icon: Zap,
    title: "Relâmpago",
    text: "Seu primeiro gol precisa acontecer antes dos 30 minutos do jogo. Se não acontecer, você perde o desafio.",
    tag: "Velocidade",
    rarity: "raro",
  },
  {
    icon: Ban,
    title: "Proibido Repetir",
    text: "Não marque dois gols consecutivos com o mesmo jogador. Se fizer isso, o mutador será considerado falho.",
    tag: "Regra especial",
    rarity: "epic",
  },
  {
    icon: Footprints,
    title: "Futebol Raiz",
    text: "Durante a partida, tente marcar pelo menos um gol de fora da área. O desafio só termina no apito final.",
    tag: "Habilidade",
    rarity: "incomum",
  },
  {
    icon: Dices,
    title: "Aposta no Escanteio",
    text: "Você precisa marcar pelo menos um gol após uma cobrança de escanteio. Se não conseguir, o desafio falha.",
    tag: "Habilidade",
    rarity: "raro",
  },
  {
    icon: Heart,
    title: "Fair Play",
    text: "Termine a partida sem receber nenhum cartão vermelho. Se nenhum dos jogadores receber vermelho, ambos completam o desafio.",
    tag: "Fair play",
    rarity: "incomum",
  },
  {
    icon: Timer,
    title: "Pressão Até o Fim",
    text: "Você precisa marcar pelo menos um gol no segundo tempo. Se terminar sem marcar, não completa o desafio.",
    tag: "Objetivo",
    rarity: "incomum",
  },
  {
    icon: UsersRound,
    title: "Elenco Participativo",
    text: "Marque gols com pelo menos 4 jogadores diferentes durante a partida. Se conseguir, complete o desafio.",
    tag: "Objetivo",
    rarity: "epic",
  },
  {
    icon: Sparkles,
    title: "Gol de Cinema",
    text: "Marque um gol de voleio, bicicleta ou outro tipo de finalização acrobática. O desafio só pode ser validado se os dois jogadores concordarem que a jogada valeu.",
    tag: "Habilidade",
    rarity: "lendario",
  },
  {
    icon: MessageCircle,
    title: "Comentarista Oficial",
    text: "Durante toda a partida, você precisa narrar pelo menos uma jogada importante de cada tempo como se fosse um comentarista profissional.",
    tag: "Interpretação",
    rarity: "incomum",
  },
  {
    icon: Laugh,
    title: "Personagem do Jogo",
    text: "Antes da partida começar, escolha uma personalidade: treinador furioso, comentarista dramático ou torcedor fanático. Mantenha o personagem durante o jogo.",
    tag: "Comédia",
    rarity: "raro",
  },
  {
    icon: Hand,
    title: "Acordo de Cavalheiros",
    text: "Antes da partida, os dois jogadores escolhem uma comemoração combinada. Sempre que qualquer um marcar, ambos precisam executá-la após o gol.",
    tag: "Duelo",
    rarity: "comum",
  },
  {
    icon: EyeOff,
    title: "Poker Face",
    text: "Durante a partida, tente não demonstrar frustração, surpresa ou comemoração exagerada. O adversário pode apontar uma reação evidente, mas os dois precisam concordar para validar.",
    tag: "Autocontrole",
    rarity: "raro",
  },
  {
    icon: Flame,
    title: "Rivalidade Máxima",
    text: "Antes do jogo, cada jogador escolhe uma provocação leve e engraçada. Ela só pode ser usada durante a partida, sem ofensas pessoais.",
    tag: "Rivalidade",
    rarity: "incomum",
  },
  {
    icon: CircleHelp,
    title: "Missão Secreta",
    text: "Antes do jogo, cada jogador escreve uma missão secreta relacionada à partida. No apito final, revelem as missões e confiram quem conseguiu cumprir a sua.",
    tag: "Missão secreta",
    rarity: "epic",
  },
];

function championshipCover(name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("libertadores")) return "cover-libertadores";
  if (normalized.includes("champions")) return "cover-champions";
  if (normalized.includes("brasileir")) return "cover-brasileirao";
  if (normalized.includes("copa do mundo") || normalized.includes("world cup")) return "cover-world";
  if (normalized.includes("premier")) return "cover-premier";
  if (normalized.includes("mundial")) return "cover-mundial";
  return "cover-default";
}

function ChampionshipPage({
  players,
  teams,
  activeRoomId,
}: {
  players: Player[];
  teams: Team[];
  activeRoomId: string | null;
}) {
  const [news, setNews] = useState<ArenaNews[]>([]);
  const [items, setItems] = useState<Championship[]>([]),
    [selected, setSelected] = useState<number>(),
    [detail, setDetail] = useState<ChampionshipDetail>(),
    [name, setName] = useState(""),
    [format, setFormat] = useState<"league" | "knockout">("league"),
    [participants, setParticipants] = useState<number[]>([]),
    [mode, setMode] = useState<"classic" | "duo" | "mad">("classic"),
    [team, setTeam] = useState<Team | undefined>(),
    [mutator, setMutator] = useState<number | null>(null),
    [displayedMutators, setDisplayedMutators] = useState<number[]>([]),
    [rolling, setRolling] = useState(false),
    [confirming, setConfirming] = useState(false),
    [formError, setFormError] = useState(""),
    [deletingChampionship, setDeletingChampionship] =
      useState<Championship | null>(null),
    [assignments, setAssignments] = useState<Record<number, Team>>({}),
    [renaming, setRenaming] = useState<Championship | null>(null),
    [teamQuery, setTeamQuery] = useState(""),
    [searchedTeams, setSearchedTeams] = useState<Team[] | null>(null);
  useEffect(() => {
    if (!team && teams[0]) setTeam(teams[0]);
  }, [teams, team]);
  const load = async () => {
    const list = await window.arena.championships();
    setItems(list);
    if (!selected && list[0]) setSelected(list[0].id);
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    let active = true;
    window.arena.arenaNews()
      .then((result) => { if (active) setNews(result); })
      .catch(() => { if (active) setNews([]); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (selected) window.arena.championshipDetail(selected).then(setDetail);
  }, [selected, items.length]);
  useEffect(() => {
    const query = teamQuery.trim();
    if (!query) {
      setSearchedTeams(null);
      return;
    }
    const timer = window.setTimeout(() => {
      window.arena
        .teams(query)
        .then((result) => setSearchedTeams(result))
        .catch(() => setSearchedTeams(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [teamQuery]);
  const selectorTeams = searchedTeams ?? teams;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const teamIdsInOrder = participants.map(
      (id) => assignments[id]?.id ?? null,
    );
    const assignedTeamIds = teamIdsInOrder.filter(
      (teamId): teamId is number => typeof teamId === "number",
    );
    const hasDuplicateTeam =
      new Set(assignedTeamIds).size !== assignedTeamIds.length;
    if (hasDuplicateTeam) {
      setFormError(
        "Cada participante precisa de um time diferente — há times repetidos.",
      );
      return;
    }
    try {
      const champ = await window.arena.saveChampionship({
        name,
        format,
        mode,
        mutator:
          mode === "mad" && mutator !== null ? MUTATORS[mutator].title : null,
        startsAt: new Date().toISOString(),
        status: "active",
        participantIds: participants,
        participantTeamIds: teamIdsInOrder,
      }, activeRoomId);
      setName("");
      setParticipants([]);
      setSelected(champ.id);
      await load();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o campeonato.",
      );
    }
  };

  const toggleParticipant = (id: number) =>
    setParticipants((list) => {
      const included = list.includes(id);
      setAssignments((current) => {
        const next = { ...current };
        if (included) {
          delete next[id];
        } else if (team) {
          const alreadyTaken = Object.entries(current).some(
            ([playerId, assignedTeam]) =>
              Number(playerId) !== id && assignedTeam.id === team.id,
          );
          if (!alreadyTaken) next[id] = team;
        }
        return next;
      });
      return included ? list.filter((item) => item !== id) : [...list, id];
    });
  const drawMutator = () => {
    if (rolling) return;

    playArenaSound("draw");

    setRolling(true);
    setMutator(null);

    window.setTimeout(() => {
      const shuffled = [...MUTATORS.keys()].sort(() => Math.random() - 0.5);

      setDisplayedMutators(shuffled.slice(0, 5));
      setRolling(false);
    }, 700);
  };
  const drawTeam = () => {
    playArenaSound("draw");
    const pool = selectorTeams.length ? selectorTeams : teams;
    if (pool.length) setTeam(pool[Math.floor(Math.random() * pool.length)]);
  };
  const pairPlayers = () => {
    playArenaSound("draw");
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
    setParticipants(shuffledPlayers.map((p) => p.id));
    setAssignments(
      Object.fromEntries(
        shuffledPlayers.map(
          (p, index) => [p.id, shuffledTeams[index]] as [number, Team],
        ),
      ),
    );
  };
  return (
    <>
      <section className="page-title championships-heading">
        <div>
          <p>
            <Sparkles size={13} /> ARENA COMPETITIONS
          </p>
          <h1>Campeonatos</h1>
          <span>Crie a próxima história. Domine a arena.</span>
        </div>
        <div className="championships-kpis">
          <span>
            <Trophy size={16} /> {items.length} temporadas
          </span>
          <span>
            <Users size={16} /> {players.length} jogadores
          </span>
        </div>
      </section>

      <section className="mode-switcher" aria-label="Modo do campeonato">
        <button
          className={mode === "classic" ? "active" : ""}
          onClick={() => setMode("classic")}
        >
          <Trophy />{" "}
          <span>
            Clássico<small>1v1 competitivo</small>
          </span>
        </button>
        <button
          className={mode === "mad" ? "active mad" : ""}
          onClick={() => setMode("mad")}
        >
          <Dices />{" "}
          <span>
            Campeonato Maluco<small>Regras fora da caixa</small>
          </span>
          <Sparkles className="mode-glint" />
        </button>
      </section>

      <section className="championship-builder">
        <article className="arena-create-card">
          <div className="create-card-top">
            <div>
              <span className="eyebrow">NOVA TEMPORADA</span>
              <h2>
                {mode === "mad"
                  ? "Aperte o caos"
                  : mode === "duo"
                    ? "Juntos pela taça"
                    : "Monte sua liga"}
              </h2>
            </div>
            <div className={`mode-orb ${mode}`}>
              <Trophy size={25} />
            </div>
          </div>
          <form
            onSubmit={(e) => {
              setFormError("");
              if (mode === "mad" && mutator === null) {
                e.preventDefault();
                drawMutator();
                return;
              }
              if (
                format === "knockout" &&
                ![2, 4, 8, 16, 32].includes(participants.length)
              ) {
                e.preventDefault();
                setFormError(
                  "O mata-mata exige 2, 4, 8, 16 ou 32 participantes.",
                );
                return;
              }
              setConfirming(true);
              e.preventDefault();
            }}
          >
            <label className="arena-field">
              Nome da competição
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  mode === "duo" ? "Duplas da Resenha" : "FC Arena League"
                }
                required
              />
            </label>
            <div className="format-toggle">
              <button
                type="button"
                className={format === "league" ? "selected" : ""}
                onClick={() => setFormat("league")}
              >
                <CalendarDays /> Pontos corridos
              </button>
              <button
                type="button"
                className={format === "knockout" ? "selected" : ""}
                onClick={() => setFormat("knockout")}
              >
                <Trophy /> Mata-mata
              </button>
            </div>
            {formError && <div className="arena-form-error">{formError}</div>}
            <button className="launch-championship" type="submit">
              <CirclePlus size={18} />{" "}
              {mode === "mad" ? "Iniciar desafio" : "Criar campeonato"}
              <ArrowRight size={17} />
            </button>
          </form>
        </article>

        <article className="team-selector-card">
          <div className="section-label">
            <div>
              <span className="eyebrow">EQUIPES DA PARTIDA</span>
              <h2>Escolha ou sorteie</h2>
            </div>
            <button className="random-team" type="button" onClick={drawTeam}>
              <Shuffle size={14} /> Sortear aleatório
            </button>
          </div>
          <div className="team-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Buscar clube por nome, liga ou país..."
              value={teamQuery}
              onChange={(event) => setTeamQuery(event.target.value)}
              aria-label="Buscar clube no catálogo"
            />
            {teamQuery.trim() && (
              <button
                type="button"
                onClick={() => setTeamQuery("")}
                aria-label="Limpar busca"
              >
                ×
              </button>
            )}
          </div>
          <div className="drawn-team">
            <Shield size={22} />
            <span>
              <small>EQUIPE SORTEADA / SELECIONADA</small>
              <b>{team?.name ?? "Carregando clubes..."}</b>
              <em>
                {team?.league} · {team?.country}
              </em>
            </span>
          </div>
          {selectorTeams.length ? (
            <div className="nation-grid">
              {selectorTeams
                .slice(0, teamQuery.trim() ? 12 : 9)
                .map((option, index) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => setTeam(option)}
                    className={team?.id === option.id ? "picked" : ""}
                    style={
                      {
                        "--team-tone": CARD_TONES[index % CARD_TONES.length],
                      } as React.CSSProperties
                    }
                  >
                    <span>
                      <Shield size={18} />
                    </span>
                    <b>{option.name}</b>
                    <i>
                      <Check size={12} />
                    </i>
                  </button>
                ))}
            </div>
          ) : (
            <p className="selector-hint">
              <Search size={14} /> Nenhum clube encontrado para "
              {teamQuery.trim()}".
            </p>
          )}
          <p className="selector-hint">
            <Flag size={14} /> Catálogo real da Arena · disponível em todos os
            modos.
          </p>
        </article>
      </section>

      {mode === "mad" && (
        <section className="mutator-zone">
          <div className="mutator-copy">
            <span className="eyebrow">
              <Dices size={13} /> DRAFT CEGO · CAMPEONATO MALUCO
            </span>
            <h2>Qual regra vai virar o jogo?</h2>
            <p>
              A roleta define obrigatoriamente o desafio da rodada antes do
              apito inicial.
            </p>
            <button type="button" onClick={drawMutator} disabled={rolling}>
              <Shuffle size={17} />{" "}
              {rolling ? "Roleta girando..." : "Sortear 5 desafios"}
            </button>
          </div>
          <div className={`mutator-cards ${rolling ? "rolling" : ""}`}>
            {displayedMutators.map((index) => {
              const rule = MUTATORS[index];
              const Icon = rule.icon;

              const rarityColors: Record<string, string> = {
                comum: "#8b95a7",
                incomum: "#35c987",
                raro: "#5aa8ff",
                epico: "#b875ff",
                lendario: "#e4bd55",
              };

              const rarityLabels: Record<string, string> = {
                comum: "COMUM",
                incomum: "INCOMUM",
                raro: "RARO",
                epico: "ÉPICO",
                lendario: "LENDÁRIO",
              };

              const rarityColor =
                rarityColors[rule.rarity] ?? rarityColors.comum;

              return (
                <button
                  type="button"
                  key={rule.title}
                  onClick={() => setMutator(index)}
                  className={`mutator-card ${
                    mutator === index ? "revealed" : ""
                  }`}
                  >
                  <span className="mutator-icon">
                    <Icon size={20} />
                  </span>

                  <div className="mutator-card-labels">
                    <small className="mutator-tag">{rule.tag}</small>

                    <small
                      className="mutator-rarity"
                      style={{
                        color: rarityColor,
                        borderColor: rarityColor,
                      }}
                    >
                      {rarityLabels[rule.rarity] ?? "COMUM"}
                    </small>
                  </div>

                  <b>{rule.title}</b>

                  <p>{rule.text}</p>

                  {mutator === index && (
                    <i>
                      <Check size={15} /> selecionado
                    </i>
                  )}
                </button>
              );
            })}

            {!displayedMutators.length && (
              <div className="mutator-empty">
                <Dices size={24} />
                <p>
                  Clique em <b>Sortear desafio obrigatório</b> para revelar
                  cinco mutators.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="enrollment-section">
        <div className="section-label">
          <div>
            <span className="eyebrow">
              {mode === "duo"
                ? "INSCRIÇÕES EM DUPLA"
                : "CONFIRMAR PARTICIPANTES"}
            </span>
            <h2>
              {mode === "duo" ? "Forme os esquadrões" : "Quem entra em campo?"}
            </h2>
          </div>
          <span className="selection-count">
            {participants.length} selecionados
          </span>
        </div>
        {mode === "duo" && (
          <div className="duo-notice">
            <UsersRound size={19} />
            <span>
              <b>Modo dupla ativo.</b> Selecione jogadores em pares ou deixe a
              Arena equilibrar os esquadrões.
            </span>
            <button type="button" onClick={pairPlayers}>
              <Shuffle size={14} /> Sortear duplas
            </button>
          </div>
        )}
        <div className={`player-picks ${mode === "duo" ? "duo-picks" : ""}`}>
          {players.map((p) => {
            const included = participants.includes(p.id);
            return (
              <div
                className={`player-pick ${included ? "chosen" : ""}`}
                key={p.id}
              >
                <button
                  type="button"
                  className="player-pick-toggle"
                  onClick={() => toggleParticipant(p.id)}
                >
                  <span className="player-initial">{p.name[0]}</span>
                  <span>
                    <b>{p.name}</b>
                    <small>
                      {included
                        ? mode === "duo"
                          ? "Na dupla"
                          : "Participante"
                        : mode === "duo"
                          ? "Toque para compor dupla"
                          : "Toque para incluir"}
                    </small>
                  </span>
                  {included && <Check size={16} />}
                </button>
                {included && (
                  <TeamPicker
                    label={`Time de ${p.name}`}
                    teams={teams}
                    value={assignments[p.id] ?? null}
                    excludeTeamIds={participants
                      .filter((otherId) => otherId !== p.id)
                      .map((otherId) => assignments[otherId]?.id)
                      .filter(
                        (teamId): teamId is number =>
                          typeof teamId === "number",
                      )}
                    onChange={(picked) =>
                      setAssignments((current) => {
                        const next = { ...current };
                        if (picked) next[p.id] = picked;
                        else delete next[p.id];
                        return next;
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        {mode === "duo" && participants.length > 0 && (
          <div className="duo-preview">
            {participants
              .reduce<number[][]>((pairs, id, index) => {
                if (index % 2 === 0) pairs.push([id]);
                else pairs[pairs.length - 1].push(id);
                return pairs;
              }, [])
              .map((pair, index) => (
                <div className="duo-team" key={pair.join("-")}>
                  <span className="duo-team-label">DUPLA {index + 1}</span>
                  <div>
                    {pair.map((id) => {
                      const player = players.find((p) => p.id === id);
                      return (
                        player && (
                          <span className="duo-member" key={id}>
                            <i>{player.name[0]}</i>
                            {player.name}
                          </span>
                        )
                      );
                    })}
                    {pair.length === 1 && (
                      <span className="duo-empty">+ Convide alguém</span>
                    )}
                    <span className="duo-club">
                      → {assignments[pair[0]]?.name ?? "Sorteie uma equipe"}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
        {!players.length && (
          <Empty text="Cadastre jogadores para montar o campeonato." />
        )}
      </section>

      <div className="championship-overview">
        <div className="championship-overview-main">
      <section className="season-gallery">
        <div className="section-label">
          <div>
            <span className="eyebrow">HISTÓRICO DA ARENA</span>
            <h2>Suas temporadas</h2>
          </div>
        </div>
        <div className="championship-cards">
          {items.map((c, index) => (
            <article
              className={`season-card ${championshipCover(c.name)} ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(c.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(c.id);
                }
              }}
              tabIndex={0}
              aria-label={`Temporada ${c.name}`}
              key={c.id}
            >
              <div
                className="season-card-glow"
                style={{ background: CARD_TONES[index % CARD_TONES.length] }}
              />
              <div className="season-card-head">
                <span className="season-emblem">
                  <Trophy size={20} />
                </span>
                <span className={`status-pill ${c.status}`}>
                  {c.status === "finished"
                    ? "FINALIZADO"
                    : c.status === "draft"
                      ? "RASCUNHO"
                      : "EM ANDAMENTO"}
                </span>
              </div>
              <div>
                <span className="eyebrow">
                  {c.format === "knockout" ? "MATA-MATA" : "PONTOS CORRIDOS"}
                </span>
                <h3>{c.name}</h3>
                <ModeBadge championship={c} />
              </div>
              <footer>
                <span>
                  <Users size={15} /> {c.participants} participantes
                </span>
                <span>
                  Ver arena <ArrowRight size={15} />
                </span>
                <div
                  className="season-card-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    title="Editar nome"
                    aria-label={`Editar nome de ${c.name}`}
                    onClick={() => setRenaming(c)}
                  >
                    <SquarePen size={14} />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title="Excluir campeonato"
                    aria-label={`Excluir ${c.name}`}
                    onClick={() => setDeletingChampionship(c)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </footer>
              {detail?.championship.id === c.id && (
                <div className="season-avatars" aria-label="Avatares dos participantes">
                  {detail.standing.map((standing) => players.find((player) => player.id === standing.id)).filter((player): player is Player => Boolean(player?.avatar)).map((player) => (
                    <img key={player.id} src={player.avatar} alt={player.name} title={player.name} />
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        {!items.length && <Empty text="Sua primeira temporada começa aqui." />}
      </section>
      {detail && (
        <ChampionshipDetailView
          detail={detail}
          teams={teams}
          onDelete={() => setDeletingChampionship(detail.championship)}
          onRegistered={async () => {
            await load();
            if (selected)
              setDetail(await window.arena.championshipDetail(selected));
          }}
        />
      )}
        </div>
        <article className="panel arena-news">
          <div className="panel-head"><h2>Notícias da Arena</h2></div>
          {news.length ? news.map((item) => {
            const Icon = item.type === "goleada" ? Trophy : item.type === "sequencia" ? Sparkles : Gamepad2;
            return <div className="arena-news-card" key={item.id}><Icon size={20} /><div><strong>{item.title}</strong><p>{item.description}</p></div></div>;
          }) : <>
          <small>Em breve: notícias geradas automaticamente</small>
          <div className="arena-news-card"><Trophy size={20} /><div><strong>Goleada da Semana</strong><p>Os destaques da arena aparecerão aqui.</p></div></div>
          <div className="arena-news-card"><Sparkles size={20} /><div><strong>Virada Épica</strong><p>As reviravoltas ganharão destaque aqui.</p></div></div>
          <div className="arena-news-card"><Gamepad2 size={20} /><div><strong>Pato do Mês</strong><p>Os momentos divertidos aparecerão aqui.</p></div></div>
          </>}
        </article>
      </div>
      {confirming && (
        <AppModal
          title="Confirmar campeonato"
          message={`Você vai abrir ${name || "uma nova competição"}${mode === "mad" && mutator !== null ? ` com o desafio ${MUTATORS[mutator].title}` : ""}. Participantes selecionados: ${participants.length}.`}
          confirmText="Abrir temporada"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await save({ preventDefault() {} } as FormEvent);
          }}
        />
      )}
      {deletingChampionship && (
        <AppModal
          title="Apagar campeonato?"
          message={`A temporada ${deletingChampionship.name}, suas partidas e confrontos serão removidos permanentemente.`}
          confirmText="Apagar campeonato"
          danger
          onClose={() => setDeletingChampionship(null)}
          onConfirm={async () => {
            await window.arena.deleteChampionship(deletingChampionship.id);
            if (selected === deletingChampionship.id) {
              setDetail(undefined);
              setSelected(undefined);
            }
            await load();
          }}
        />
      )}
      {renaming && (
        <ChampionshipNameModal
          championship={renaming}
          onClose={() => setRenaming(null)}
          onSaved={async () => {
            await load();
            if (selected === renaming.id)
              setDetail(await window.arena.championshipDetail(selected));
          }}
        />
      )}
    </>
  );
}
function ChampionshipDetailView({
  detail,
  teams,
  onDelete,
  onRegistered,
}: {
  detail: ChampionshipDetail;
  teams: Team[];
  onDelete: () => void;
  onRegistered: () => Promise<void>;
}) {
  const [registering, setRegistering] = useState<Fixture | null>(null);
  const grouped = detail.fixtures.reduce<Record<string, Fixture[]>>(
    (all, fixture) => {
      const group =
        fixture.stage === "league" ? `Rodada ${fixture.round}` : fixture.stage;
      (all[group] ??= []).push(fixture);
      return all;
    },
    {},
  );
  return (
    <section className="grid championship-detail">
      <article className="panel">
        <div className="panel-head">
          <div className="panel-head-group">
            <h2>
              {detail.championship.format === "league"
                ? "Tabela"
                : "Participantes"}
            </h2>
            <ModeBadge championship={detail.championship} />
          </div>
          <button
            type="button"
            className="delete-championship-btn"
            onClick={onDelete}
          >
            <Trash2 size={15} /> Apagar campeonato
          </button>
        </div>
        <Ranking rows={detail.standing} />
      </article>
      <article className="panel wide">
        <div className="upcoming-fixtures">
          <div className="panel-head"><h2>Próximos jogos</h2></div>
          {detail.fixtures.some((fixture) => !fixture.matchId) ? (
            detail.fixtures.filter((fixture) => !fixture.matchId).slice(0, 5).map((fixture) => (
              <div className="upcoming-fixture" key={fixture.id}>
                <span>{fixture.player1} × {fixture.player2}</span>
                <small>{fixture.stage === "league" ? `Rodada ${fixture.round}` : fixture.stage}</small>
              </div>
            ))
          ) : <Empty text="Nenhum próximo jogo." />}
        </div>
        <div className="panel-head">
          <h2>
            {detail.championship.format === "league" ? "Calendário" : "Chave"}
          </h2>
        </div>
        <div className="fixtures">
          {Object.entries(grouped).map(([stage, fixtures]) => (
            <React.Fragment key={stage}>
              <p className="fixture-stage">{stage}</p>
              {fixtures.map((f) => (
                <div className="fixture" key={f.id}>
                  <small>{stage}</small>
                  <span>{f.player1}</span>
                  {f.matchId ? (
                    <b>
                      {f.score1} × {f.score2}
                    </b>
                  ) : (
                    <button
                      type="button"
                      className="fixture-register"
                      onClick={() => setRegistering(f)}
                    >
                      vs · Registrar
                    </button>
                  )}
                  <span>{f.player2}</span>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </article>
      {registering && (
        <FixtureResultModal
          fixture={registering}
          championship={detail.championship}
          teams={teams}
          onClose={() => setRegistering(null)}
          onSaved={onRegistered}
        />
      )}
    </section>
  );
}

type ChampionshipMode = NonNullable<Championship["mode"]>;

const MODE_META: Record<
  ChampionshipMode,
  { label: string; icon: React.ElementType; tone: string }
> = {
  classic: { label: "Clássico", icon: Trophy, tone: "mode-classic" },
  duo: { label: "Dupla · 2v2", icon: UsersRound, tone: "mode-duo" },
  mad: { label: "Maluco", icon: Dices, tone: "mode-mad" },
};

function ModeBadge({ championship }: { championship: Championship }) {
  const meta = MODE_META[championship.mode ?? "classic"];
  const Icon = meta.icon;
  return (
    <span className={`mode-badge ${meta.tone}`}>
      <Icon size={12} />
      {meta.label}
      {championship.mode === "mad" && championship.mutator ? (
        <em title="Desafio sorteado no modo maluco">
          · {championship.mutator}
        </em>
      ) : null}
    </span>
  );
}

function ChampionshipNameModal({
  championship,
  onClose,
  onSaved,
}: {
  championship: Championship;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(championship.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      setError("Informe um nome para o campeonato.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await window.arena.updateChampionship(championship.id, nextName);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o campeonato.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="championship-edit-backdrop" onMouseDown={onClose}>
      <div
        className="championship-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="championship-edit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="championship-edit-head">
          <div>
            <span className="eyebrow">EDITAR CAMPEONATO</span>
            <h2 id="championship-edit-title">Nome da temporada</h2>
          </div>
          <button
            type="button"
            className="championship-edit-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <label className="championship-edit-field">
          <span>Nome</span>
          <input
            type="text"
            maxLength={80}
            value={name}
            autoComplete="off"
            autoFocus
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
              if (event.key === "Escape") onClose();
            }}
          />
        </label>
        {error && (
          <p className="championship-edit-error" role="alert">
            {error}
          </p>
        )}
        <div className="championship-edit-actions">
          <button
            type="button"
            className="championship-edit-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="championship-edit-save"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FixtureResultModal({
  fixture,
  championship,
  teams,
  onClose,
  onSaved,
}: {
  fixture: Fixture;
  championship: Championship;
  teams: Team[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [team1, setTeam1] = useState<Team | null>(
    () => teams.find((t) => t.id === fixture.team1Id) ?? null,
  );
  const [team2, setTeam2] = useState<Team | null>(
    () => teams.find((t) => t.id === fixture.team2Id) ?? null,
  );
  const [score1, setScore1] = useState("0");
  const [score2, setScore2] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const knockout = fixture.stage !== "league";
  const stageLabel = knockout ? fixture.stage : `Rodada ${fixture.round}`;

  const isDuo = fixture.team1DuoId != null;

  async function submit() {
    if (isDuo ? fixture.team2DuoId == null : fixture.player1Id == null || fixture.player2Id == null) {
      setError("Os participantes do confronto estão incompletos.");
      return;
    }
    const goals1 = Number(score1);
    const goals2 = Number(score2);
    const team1Id = fixture.team1Id ?? team1?.id;
    const team2Id = fixture.team2Id ?? team2?.id;
    if (
      !Number.isInteger(goals1) ||
      goals1 < 0 ||
      !Number.isInteger(goals2) ||
      goals2 < 0
    ) {
      setError("Informe um placar válido (inteiros maiores ou iguais a zero).");
      return;
    }
    if (!isDuo && (team1Id == null || team2Id == null)) {
      setError("Selecione os dois times.");
      return;
    }
    if (!isDuo && team1Id === team2Id) {
      setError("Escolha times diferentes.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await window.arena.saveMatch({
        ...(isDuo
          ? { team1DuoId: fixture.team1DuoId, team2DuoId: fixture.team2DuoId }
          : { player1Id: fixture.player1Id, player2Id: fixture.player2Id, team1Id, team2Id }),
        score1: goals1,
        score2: goals2,
        championshipId: championship.id,
      });
      playArenaSound("whistle");
      await onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível registrar a partida.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-modal-backdrop" onMouseDown={onClose}>
      <div
        className="edit-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="edit-modal-header">
          <div>
            <span>REGISTRAR RESULTADO · {championship.name}</span>
            <h2>
              {fixture.player1} vs {fixture.player2}
            </h2>
          </div>
          <button
            type="button"
            className="edit-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="edit-match-info">
          <small>
            {stageLabel}
            {knockout
              ? " · empate não permitido — o vencedor avança automaticamente"
              : ""}
          </small>
        </div>

        <div className="edit-scoreboard">
          <div className="edit-player">
            <strong>{fixture.player1}</strong>
            <span>{fixture.team1 ?? team1?.name ?? "Sem time"}</span>
          </div>

          <div className="edit-score">
            <input
              type="number"
              min="0"
              value={score1}
              onChange={(event) => setScore1(event.target.value)}
              disabled={saving}
              autoFocus
            />

            <span>×</span>

            <input
              type="number"
              min="0"
              value={score2}
              onChange={(event) => setScore2(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="edit-player edit-player-right">
            <strong>{fixture.player2}</strong>
            <span>{fixture.team2 ?? team2?.name ?? "Sem time"}</span>
          </div>
        </div>

        <div className="fixture-teams">
          {isDuo || fixture.team1Id != null ? (
            <div>Time de {fixture.player1}: {fixture.team1 ?? team1?.name ?? "Time indisponível"}</div>
          ) : (
            <TeamPicker
              label={`Time de ${fixture.player1}`}
              teams={teams}
              value={team1}
              onChange={setTeam1}
            />
          )}
          {isDuo || fixture.team2Id != null ? (
            <div>Time de {fixture.player2}: {fixture.team2 ?? team2?.name ?? "Time indisponível"}</div>
          ) : (
            <TeamPicker
              label={`Time de ${fixture.player2}`}
              teams={teams}
              value={team2}
              onChange={setTeam2}
            />
          )}
        </div>

        {error && <div className="edit-error">{error}</div>}

        <div className="edit-modal-actions">
          <button
            type="button"
            className="edit-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            type="button"
            className="edit-save"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar resultado"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({ reload }: { reload: () => Promise<void> }) {
  type SettingsSection =
    | "account"
    | "password"
    | "email"
    | "appearance"
    | "notifications"
    | "privacy"
    | "about";

  type SettingsGroup = "CONTA" | "APLICATIVO" | "PRIVACIDADE";

  const sections: Array<{
    id: SettingsSection;
    label: string;
    description: string;
    icon: React.ElementType;
    group: SettingsGroup;
  }> = [
    {
      id: "account",
      label: "Conta",
      description: "Dados do perfil",
      icon: UserCircle,
      group: "CONTA",
    },
    {
      id: "password",
      label: "Senha",
      description: "Acesso à conta",
      icon: Shield,
      group: "CONTA",
    },
    {
      id: "email",
      label: "E-mail",
      description: "Endereço da conta",
      icon: MessageCircle,
      group: "CONTA",
    },
    {
      id: "appearance",
      label: "Aparência",
      description: "Cores e efeitos",
      icon: Sparkles,
      group: "APLICATIVO",
    },
    {
      id: "notifications",
      label: "Notificações",
      description: "Preferências de alertas",
      icon: Volume2,
      group: "PRIVACIDADE",
    },
    {
      id: "privacy",
      label: "Privacidade",
      description: "Controle de privacidade",
      icon: EyeOff,
      group: "PRIVACIDADE",
    },
    {
      id: "about",
      label: "Sobre",
      description: "Informações do app",
      icon: Gamepad2,
      group: "APLICATIVO",
    },
  ];

  const [accent, setAccent] = useState(
    () => localStorage.getItem("arena-accent") ?? "#7e5ff0",
  );

  const [background, setBackground] = useState(
    () => localStorage.getItem("arena-background") ?? "#0a0c10",
  );

  const [paletteId, setPaletteId] = useState<ArenaPalette["id"] | "custom">(() => {
    const saved = localStorage.getItem("arena-palette");
    if (saved && ARENA_PALETTES.some((palette) => palette.id === saved)) {
      return saved as ArenaPalette["id"];
    }

    const theme: ArenaTheme =
      localStorage.getItem("arena-theme") === "light" ? "light" : "dark";
    const currentAccent = localStorage.getItem("arena-accent") ?? "#7e5ff0";
    const currentBackground =
      localStorage.getItem("arena-background") ?? "#0a0c10";
    const matchingPalette = ARENA_PALETTES.find((palette) => {
      const colors = getArenaPaletteVariant(palette, theme);
      return (
        colors.accent.toLowerCase() === currentAccent.toLowerCase() &&
        colors.background.toLowerCase() === currentBackground.toLowerCase()
      );
    });

    return matchingPalette?.id ?? "custom";
  });

  const [muted, setMuted] = useState(
    () => localStorage.getItem("arena-muted") === "true",
  );

  const [section, setSection] = useState<SettingsSection>("account");

  const [message, setMessage] = useState("");

  useEffect(() => {
    document.documentElement.style.setProperty("--arena-accent", accent);
    document.documentElement.style.setProperty("--arena-bg", background);

    localStorage.setItem("arena-accent", accent);
    localStorage.setItem("arena-background", background);
  }, [accent, background]);

  useEffect(() => {
    localStorage.setItem("arena-palette", paletteId);
  }, [paletteId]);

  const currentTheme: ArenaTheme =
    localStorage.getItem("arena-theme") === "light" ? "light" : "dark";

  const selectPalette = (id: ArenaPalette["id"]) => {
    const palette = getArenaPalette(id);
    const colors = getArenaPaletteVariant(palette, currentTheme);
    setPaletteId(id);
    setAccent(colors.accent);
    setBackground(colors.background);
  };

  const setManualAccent = (color: string) => {
    setPaletteId("custom");
    setAccent(color);
  };

  const setManualBackground = (color: string) => {
    setPaletteId("custom");
    setBackground(color);
  };

  const restoreDefaultPalette = () => {
    selectPalette(DEFAULT_PALETTE_ID);
  };

  useEffect(() => {
    localStorage.setItem("arena-muted", String(muted));
  }, [muted]);


  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">CONFIGURAÇÕES</span>

          <h1>Configurações</h1>

          <p>
            Personalize o FC Arena e configure o funcionamento da sua Arena.
          </p>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <span>CONFIGURAÇÕES</span>
          </div>

          <nav className="settings-nav">
            {sections.map((item, index) => {
              const Icon = item.icon;
              const active = section === item.id;
              const showGroup =
                index === 0 || sections[index - 1].group !== item.group;

              return (
                <React.Fragment key={item.id}>
                  {showGroup && (
                    <div className="settings-nav-group">{item.group}</div>
                  )}

                  <button
                    type="button"
                    className={`settings-nav-item ${active ? "active" : ""}`}
                    onClick={() => setSection(item.id)}
                  >
                    <span className="settings-nav-icon">
                      <Icon size={18} />
                    </span>

                    <span className="settings-nav-content">
                      <strong>{item.label}</strong>

                      <small>{item.description}</small>
                    </span>

                    <ArrowRight size={15} className="settings-nav-arrow" />
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        </aside>

        <div className="settings-content">
          {message && (
            <div className="settings-message">
              <Check size={16} />
              <span>{message}</span>
            </div>
          )}

          {section === "account" ? (
            <AccountSettings />
          ) : section === "password" ? (
            <PasswordSettings />
          ) : section === "email" ? (
            <EmailSettings />
          ) : section === "appearance" ? (
            <article className="settings-card">
              <div className="settings-card-header">
                <div>
                  <span className="settings-card-label">PERSONALIZAÇÃO</span>

                  <h2>Aparência</h2>

                  <p>
                    Escolha uma paleta ou personalize as cores usadas pelo
                    FC Arena.
                  </p>
                </div>

                <Sparkles size={22} />
              </div>

              <div className="settings-section">
                <div className="settings-section-heading">
                  <div>
                    <h3>Paletas</h3>

                    <p>
                      Cada paleta se adapta ao modo claro ou escuro atual.
                    </p>
                  </div>

                  <span className="settings-palette-current">
                    {paletteId === "custom"
                      ? "Personalizada"
                      : getArenaPalette(paletteId).name}
                  </span>
                </div>

                <div className="settings-palette-grid">
                  {ARENA_PALETTES.map((palette) => {
                    const colors = getArenaPaletteVariant(palette, currentTheme);
                    const active = paletteId === palette.id;

                    return (
                      <button
                        key={palette.id}
                        type="button"
                        className={`settings-palette-card ${active ? "active" : ""}`}
                        aria-pressed={active}
                        onClick={() => selectPalette(palette.id)}
                      >
                        <span
                          className="settings-palette-preview"
                          style={{
                            background: colors.background,
                            color: colors.text,
                          }}
                        >
                          <span
                            className="settings-palette-preview-accent"
                            style={{ background: colors.accent }}
                          />
                          <span className="settings-palette-preview-line">
                            {palette.name}
                          </span>
                          <span className="settings-palette-preview-text">
                            Texto de exemplo
                          </span>
                        </span>

                        <span className="settings-palette-card-body">
                          <strong>{palette.name}</strong>
                          <small>{palette.description}</small>
                          {active && (
                            <span className="settings-palette-active">
                              <Check size={13} /> Ativa
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-heading">
                  <div>
                    <h3>Cor de destaque</h3>

                    <p>
                      Alterar esta cor manualmente transforma a escolha em
                      Personalizada.
                    </p>
                  </div>

                  <div
                    className="settings-color-preview"
                    style={{
                      background: accent,
                    }}
                  />
                </div>

                <div className="settings-color-row">
                  {[
                    "#8872ff",
                    "#4f8cff",
                    "#00c896",
                    "#f5a524",
                    "#ef5da8",
                    "#ef5350",
                  ].map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Selecionar cor ${color}`}
                      className={`settings-color-option ${
                        paletteId === "custom" && accent === color ? "active" : ""
                      }`}
                      style={{
                        background: color,
                      }}
                      onClick={() => setManualAccent(color)}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-heading">
                  <div>
                    <h3>Fundo</h3>

                    <p>
                      Alterar este fundo manualmente transforma a escolha em
                      Personalizada.
                    </p>
                  </div>

                  <div
                    className="settings-color-preview"
                    style={{
                      background: background,
                    }}
                  />
                </div>

                <div className="settings-color-row">
                  {["#0a0f1f", "#0d1117", "#111318", "#15121d"].map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Selecionar fundo ${color}`}
                      className={`settings-color-option ${
                        paletteId === "custom" && background === color
                          ? "active"
                          : ""
                      }`}
                      style={{
                        background: color,
                      }}
                      onClick={() => setManualBackground(color)}
                    />
                  ))}
                </div>

                <div className="settings-actions settings-appearance-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={restoreDefaultPalette}
                    disabled={paletteId === DEFAULT_PALETTE_ID}
                  >
                    Restaurar padrão
                  </button>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-toggle-row">
                  <div className="settings-toggle-content">
                    <h3>Efeitos sonoros</h3>

                    <p>Ative ou desative os sons da interface.</p>
                  </div>

                  <button
                    type="button"
                    className={`settings-toggle ${!muted ? "active" : ""}`}
                    aria-pressed={!muted}
                    onClick={() => setMuted((value) => !value)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            </article>
          ) : section === "notifications" ? (
            <NotificationsSettings onOpenAppearance={() => setSection("appearance")} />
          ) : section === "privacy" ? (
            <PrivacySettings />
          ) : section === "about" ? (
            <article className="settings-card settings-about-app">
              <div className="settings-about-app-header">
                <div className="settings-about-app-icon">
                  <img src={fcArenaLogo} alt="Logo FC Arena" />
                </div>

                <div className="settings-about-app-heading">
                  <span className="settings-about-app-label">
                    SOBRE O APLICATIVO
                  </span>

                  <h2>FC Arena</h2>

                  <p>Gerenciador de campeonatos para EA Sports FC.</p>
                </div>
              </div>

              <div className="settings-about-app-info">
                <div className="settings-about-app-item">
                  <span>Versão</span>
                  <strong>0.1.0</strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Plataforma</span>
                  <strong>Desktop</strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Tecnologia</span>
                  <strong>Electron + React + TypeScript</strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Banco de dados</span>
                  <strong>SQLite + Supabase</strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Desenvolvedor</span>
                  <strong>Victor Henrique</strong>
                </div>
              </div>

              <div className="settings-about-app-description">
                <span className="settings-about-app-section-label">
                  O PROJETO
                </span>

                <h3>Sobre o FC Arena</h3>

                <p>
                  O FC Arena foi desenvolvido para facilitar a criação e o
                  gerenciamento de campeonatos de EA Sports FC, permitindo
                  organizar jogadores, equipes, partidas, rankings e competições
                  em um único lugar.
                </p>
              </div>
            </article>
          ): null}
        </div>
      </div>

    </section>
  );
}

function ArenaApp({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [loadedRoomId, setLoadedRoomId] = useState<string | null | undefined>(undefined);
  const [roomLoadAttempt, setRoomLoadAttempt] = useState(0);
  const switchingRoom = loadedRoomId !== activeRoomId;
  const showRoomOnlyTabs = activeRoomId !== null;
  const [page, setPage] = useState<Page>("dashboard"),
    [data, setData] = useState<Dashboard>(),
    [loadError, setLoadError] = useState(""),
    [players, setPlayers] = useState<Player[]>([]),
    [teams, setTeams] = useState<Team[]>([]),
    [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);
  const reload = async () => {
    try {
      const [dashboard, playerList, teamList] = await Promise.all([
        window.arena.dashboard(),
        window.arena.players(),
        window.arena.teams(),
      ]);
      setData(dashboard);
      setPlayers(playerList);
      setTeams(teamList);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os dados da Arena.",
      );
    }
  };
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        await window.arena.setActiveRoom(activeRoomId);
        const [dashboard, playerList, teamList] = await Promise.all([
          window.arena.dashboard(), window.arena.players(), window.arena.teams(),
        ]);
        if (!current) return;
        setData(dashboard);
        setPlayers(playerList);
        setTeams(teamList);
        setLoadError("");
        setLoadedRoomId(activeRoomId);
      } catch {
        if (!current) return;
        setLoadError("Não foi possível carregar os dados da sala.");
        setData(undefined);
      }
    })();
    return () => { current = false; };
  }, [activeRoomId, roomLoadAttempt]);
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);
  if (loadError && !data)
    return (
      <main className="error-state">
        <h1>Não foi possível carregar a Arena</h1>
        <p>{loadError}</p>
        <button className="primary" onClick={() => setRoomLoadAttempt((attempt) => attempt + 1)}>
          Tentar novamente
        </button>
      </main>
    );
  if (!data) return <main className="loading">Carregando arena…</main>;
  const nav: [Page, string, React.ElementType][] = [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["rooms", "Salas personalizadas", DoorOpen],
    ...(showRoomOnlyTabs
      ? ([["matches", "Partidas", Gamepad2], ["ranking", "Ranking", BarChart3]] as [Page, string, React.ElementType][])
      : []),
    ["players", "Jogadores", Users],
    ["championships", "Campeonatos", Trophy],
    ["friends", "Amigos", UsersRound],
  ];
  const view =
    switchingRoom && page !== "rooms" ? (
      <main className="loading">Carregando dados da sala...</main>
    ) : page === "dashboard" ? (
      <DashboardPage data={data} players={players} go={setPage} reload={reload} showRoomOnlyTabs={showRoomOnlyTabs} />
    ) : page === "rooms" ? (
      <RoomsPage activeRoomId={activeRoomId} setActiveRoomId={setActiveRoomId} switchingRoom={switchingRoom} />
    ) : page === "friends" ? (
      <FriendsPage />
    ) : page === "players" ? (
      <PlayersPage players={players} reload={reload} activeRoomId={activeRoomId} />
    ) : page === "matches" ? (
      <MatchesPage players={players} teams={teams} reload={reload} totalMatches={data.matches} />
    ) : page === "ranking" ? (
      <RankingPage data={data} players={players} />
    ) : page === "championships" ? (
      <ChampionshipPage players={players} teams={teams} activeRoomId={activeRoomId} />
    ) : page === "profile" ? (
      <ProfilePage
        onEditProfile={() => {
          setPage("settings");
        }}
      />
    ) : page === "settings" ? (
      <SettingsPage reload={reload} />
    ) : (
      <TeamsPage teams={teams} />
    );
  // Oculto até as ações da Central da Arena serem implementadas.
  const showArenaMenu = false;
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <Gamepad2 />
          <b>
            FC <em>ARENA</em>
          </b>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
              key={id}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="sidebar-status" aria-live="polite">
            <span className={online ? "sidebar-status-dot online" : "sidebar-status-dot"} aria-hidden="true" />
            {online ? "Online" : "Offline"}
          </div>
          <small>v0.1.0 · dados locais</small>
        </div>
      </aside>
      <main>{view}</main>
      <div className="account-menu" ref={accountMenuRef}>
        <button
          type="button"
          className="account-menu-trigger"
          onClick={() => setAccountMenuOpen((open) => !open)}
          aria-expanded={accountMenuOpen}
          aria-haspopup="menu"
        >
          <span className="account-menu-avatar">
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>

          <span className="account-menu-identity">
            <strong>{user.displayName}</strong>
            <small>{user.email}</small>
          </span>

          <ChevronDown
            size={15}
            className={
              accountMenuOpen
                ? "account-menu-chevron open"
                : "account-menu-chevron"
            }
          />
        </button>

        {accountMenuOpen && (
          <div className="account-menu-panel" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPage("profile");
                setAccountMenuOpen(false);
              }}
            >
              <UserCircle size={17} />
              <span>Meu perfil</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPage("settings");
                setAccountMenuOpen(false);
              }}
            >
              <Settings2 size={17} />
              <span>Configurações</span>
            </button>

            <div className="account-menu-divider" />

            <button
              type="button"
              role="menuitem"
              className="account-menu-danger"
              onClick={() => {
                setAccountMenuOpen(false);
                onSignOut();
              }}
            >
              <LogOut size={17} />
              <span>Sair</span>
            </button>
          </div>
        )}
      </div>

      {showArenaMenu && <ArenaTools mutators={MUTATORS} teams={teams} />}
    </div>
  );
}
function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    void window.arena.auth.session()
      .then((session) => {
        setUser(session.user);
      })
      .catch((error) => {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Não foi possível verificar a sessão.",
        );
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) {
    return <main className="loading">Verificando sessão…</main>;
  }

  if (authError) {
    return (
      <main className="error-state">
        <h1>Não foi possível verificar sua sessão</h1>
        <p>{authError}</p>
        <button
          className="primary"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </main>
    );
  }

  if (!user) {
    return <AuthPage onAuthenticated={setUser} />;
  }

  return (
    <ArenaApp
      user={user}
      onSignOut={() => {
        void window.arena.auth.signOut().then(() => setUser(null));
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
