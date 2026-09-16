import "./styles/config.css";
import fcArenaLogo from "../midia/fcarena-icon.png";
import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Clipboard,
  CirclePlus,
  Dices,
  EyeOff,
  Flag,
  Gamepad2,
  Gauge,
  Goal,
  LayoutDashboard,
  Shuffle,
  Shield,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  UsersRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  Championship,
  ChampionshipDetail,
  Dashboard,
  Fixture,
  GameRulesSettings,
  Match,
  Player,
  Standing,
  Team,
} from "../shared/models";
import "./styles/app.css";
import "./styles/fixtures.css";

type Page =
  | "dashboard"
  | "players"
  | "matches"
  | "ranking"
  | "championships"
  | "settings"
  | "teams";
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
    new Date(value),
  );
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
  await navigator.clipboard.writeText(
    `⚽ *FC Arena*\n${match.player1} ${match.score1} × ${match.score2} ${match.player2}\n🏟️ ${match.team1} vs ${match.team2}${match.championship ? `\n🏆 ${match.championship}` : ""}`,
  );
  playArenaSound("whistle");
  alert("Resumo copiado para o WhatsApp.");
};
const Empty = ({ text }: { text: string }) => (
  <div className="empty">{text}</div>
);
function Ranking({ rows }: { rows: Standing[] }) {
  return (
    <div className="table">
      <div className="row header">
        <span>#</span>
        <span>Jogador</span>
        <span>PTS</span>
        <span>J</span>
        <span>V</span>
        <span>E</span>
        <span>D</span>
        <span>SG</span>
        <span>APROV.</span>
      </div>
      {rows.map((row, index) => (
        <div className="row" key={row.id}>
          <span className="rank">{index + 1}</span>
          <span className="player-cell">
            <i>{row.name[0]}</i>
            {row.name}
            {row.streak >= 3 && (
              <span className="hot-streak">🔥 Em chamas</span>
            )}
          </span>
          <b>{row.points}</b>
          <span>{row.played}</span>
          <span>{row.wins}</span>
          <span>{row.draws}</span>
          <span>{row.losses}</span>
          <span>{row.goalsFor - row.goalsAgainst}</span>
          <span>{row.winRate}%</span>
        </div>
      ))}
    </div>
  );
}
function EditMatchModal({
  match,
  onClose,
  onSaved,
}: {
  match: Match;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [score1, setScore1] = useState(String(match.score1));
  const [score2, setScore2] = useState(String(match.score2));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const newScore1 = Number(score1);
    const newScore2 = Number(score2);

    if (!Number.isInteger(newScore1) || newScore1 < 0) {
      setError("O placar do primeiro jogador é inválido.");
      return;
    }

    if (!Number.isInteger(newScore2) || newScore2 < 0) {
      setError("O placar do segundo jogador é inválido.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await window.arena.updateMatch({
        id: match.id,
        player1Id: match.player1Id,
        player2Id: match.player2Id,
        team1Id: match.team1Id,
        team2Id: match.team2Id,
        score1: newScore1,
        score2: newScore2,
        championshipId: match.championshipId ?? undefined,
        playedAt: match.playedAt,
      });

      await onSaved();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar a partida.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="edit-modal-backdrop" onMouseDown={onClose}>
      <div className="edit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <div>
            <span>EDITAR PARTIDA</span>
            <h2>Alterar resultado</h2>
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
            {date(match.playedAt)}
            {match.championship ? ` · ${match.championship}` : ""}
          </small>
        </div>

        <div className="edit-scoreboard">
          <div className="edit-player">
            <strong>{match.player1}</strong>
            <span>{match.team1}</span>
          </div>

          <div className="edit-score">
            <input
              type="number"
              min="0"
              value={score1}
              onChange={(e) => setScore1(e.target.value)}
              disabled={saving}
              autoFocus
            />

            <span>×</span>

            <input
              type="number"
              min="0"
              value={score2}
              onChange={(e) => setScore2(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="edit-player edit-player-right">
            <strong>{match.player2}</strong>
            <span>{match.team2}</span>
          </div>
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
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar resultado"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Game({
  match,
  onEdit,
  onDelete,
  onShare,
}: {
  match: Match;
  onEdit: (match: Match) => void;
  onDelete?: (match: Match) => void;
  onShare?: (match: Match) => void;
}) {
  return (
    <div className="game">
      <small>
        {date(match.playedAt)}{" "}
        {match.championship ? `· ${match.championship}` : ""}
      </small>

      <div>
        <span>
          {match.player1}
          <em>{match.team1}</em>
        </span>

        <b>
          {match.score1} <i>×</i> {match.score2}
        </b>

        <span>
          {match.player2}
          <em>{match.team2}</em>
        </span>
      </div>

      <button
        type="button"
        className="edit-match-btn"
        onClick={() => onEdit(match)}
      >
        Editar resultado
      </button>
      {onDelete && (
        <button
          type="button"
          className="delete-match-btn"
          onClick={() => onDelete(match)}
          aria-label={`Apagar partida entre ${match.player1} e ${match.player2}`}
        >
          <Trash2 size={15} /> Apagar
        </button>
      )}
      {onShare && (
        <button
          type="button"
          className="share-match-btn"
          onClick={() => onShare(match)}
        >
          <Clipboard size={14} /> WhatsApp
        </button>
      )}
    </div>
  );
}

function DashboardPage({
  data,
  go,
}: {
  data: Dashboard;
  go: (page: Page) => void;
}) {
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const stats = data.statistics;
  const metrics = [
    ["PARTIDAS", data.matches],
    ["JOGADORES", data.players],
    ["LÍDER", data.leader?.name ?? "—"],
    ["TIME MAIS USADO", data.mostUsedTeam ?? "—"],
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
        <button className="primary" onClick={() => go("matches")}>
          <CirclePlus size={18} /> Registrar partida
        </button>
      </section>
      <section className="metrics">
        {metrics.map(([label, value]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>
              {label === "LÍDER" && data.leader
                ? `${data.leader.points} pontos`
                : "Dados locais"}
            </small>
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
            <h2>Últimas partidas</h2>
          </div>
          {data.recent.length ? (
            <div className="games">
              {data.recent.map((m) => (
                <Game
                  key={m.id}
                  match={m}
                  onEdit={setEditingMatch}
                  onShare={copyMatchSummary}
                />
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
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
function PlayersPage({
  players,
  reload,
}: {
  players: Player[];
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [deletePlayer, setDeletePlayer] = useState<Player | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await window.arena.savePlayer({ name, nickname });
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
            <button className="primary">Salvar jogador</button>
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
function MatchesPage({
  players,
  teams,
  reload,
}: {
  players: Player[];
  teams: Team[];
  reload: () => Promise<void>;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [deletingMatch, setDeletingMatch] = useState<Match | null>(null);
  const [championships, setChampionships] = useState<Championship[]>([]);
  const [teamSearch1, setTeamSearch1] = useState("");
  const [teamSearch2, setTeamSearch2] = useState("");
  const [showTeamList1, setShowTeamList1] = useState(false);
  const [showTeamList2, setShowTeamList2] = useState(false);
  const [form, setForm] = useState({
    championshipId: "",
    player1Id: "",
    team1Id: "",
    score1: "0",
    score2: "0",
    player2Id: "",
    team2Id: "",
  });

  const filteredTeams1 = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(teamSearch1.toLowerCase()) ||
      t.league.toLowerCase().includes(teamSearch1.toLowerCase()) ||
      t.country.toLowerCase().includes(teamSearch1.toLowerCase()),
  );

  const filteredTeams2 = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(teamSearch2.toLowerCase()) ||
      t.league.toLowerCase().includes(teamSearch2.toLowerCase()) ||
      t.country.toLowerCase().includes(teamSearch2.toLowerCase()),
  );

  useEffect(() => {
    Promise.all([window.arena.matches(), window.arena.championships()]).then(
      ([m, c]) => {
        setMatches(m);
        setChampionships(c);
      },
    );
  }, []);

  useEffect(() => {
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);
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

  const selectTeam = (
    key: "team1Id" | "team2Id",
    label: string,
    search: string,
    setSearch: (v: string) => void,
    showList: boolean,
    setShowList: (v: boolean) => void,
    filtered: Team[],
  ) => (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <label style={{ display: "block", marginBottom: "7px" }}>
        {label}
        <input
          type="text"
          placeholder="Buscar time..."
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            // Ao editar a busca, o time selecionado deixa de ser válido.
            if (form[key]) {
              setForm({ ...form, [key]: "" });
            }
          }}
          onFocus={() => setShowList(true)}
          onMouseDown={(e) => e.stopPropagation()}
          required
          style={{
            background: "#0b1224",
            border: "1px solid #293653",
            color: "#f0f2f9",
            padding: "11px",
            borderRadius: "7px",
            font: "inherit",
            width: "100%",
            outline: "none",
          }}
        />
      </label>
      {showList && (
        <div
          className="team-results"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#0b1224",
            border: "1px solid #293653",
            borderRadius: "7px",
            zIndex: 1000,
            marginTop: "-20px",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {filtered.map((team) => (
            <div
              key={team.id}
              onClick={() => {
                setForm({ ...form, [key]: String(team.id) });
                setSearch(team.name);
                setShowList(false);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                padding: "10px 11px",
                cursor: "pointer",
                borderBottom: "1px solid #202942",
                fontSize: "14px",
                backgroundColor:
                  form[key] === String(team.id) ? "#17213a" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (form[key] !== String(team.id)) {
                  (e.target as HTMLElement).style.background = "#17213a";
                }
              }}
              onMouseLeave={(e) => {
                if (form[key] !== String(team.id)) {
                  (e.target as HTMLElement).style.background = "transparent";
                }
              }}
            >
              <div style={{ fontWeight: 500 }}>{team.name}</div>
              <div
                style={{ fontSize: "12px", color: "#9ca9c0", marginTop: "4px" }}
              >
                {team.league} · {team.country}
              </div>
            </div>
          ))}
          {!filtered.length && (
            <div
              style={{
                padding: "15px",
                textAlign: "center",
                color: "#9ca9c0",
                fontSize: "14px",
              }}
            >
              Nenhum time encontrado
            </div>
          )}
        </div>
      )}
    </div>
  );

  const handleClickOutside = () => {
    setShowTeamList1(false);
    setShowTeamList2(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();

    const player1Id = Number(form.player1Id);
    const player2Id = Number(form.player2Id);
    const team1Id = Number(form.team1Id);
    const team2Id = Number(form.team2Id);
    const championshipId = form.championshipId
      ? Number(form.championshipId)
      : undefined;

    if (!player1Id || !player2Id || !team1Id || !team2Id) {
      alert("Selecione os dois jogadores e os dois times.");
      return;
    }

    if (player1Id === player2Id) {
      alert("Escolha jogadores diferentes.");
      return;
    }

    if (team1Id === team2Id) {
      alert("Escolha times diferentes.");
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
        championshipId,
      });
      playArenaSound("whistle");

      setMatches(await window.arena.matches());
      setForm({
        championshipId: "",
        player1Id: "",
        team1Id: "",
        score1: "0",
        score2: "0",
        player2Id: "",
        team2Id: "",
      });
      setTeamSearch1("");
      setTeamSearch2("");
      await reload();
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível registrar a partida.",
      );
    }
  };
  const scores = Array.from({ length: 21 }, (_, id) => ({
    id,
    name: String(id),
  }));
  const headToHead = matches.filter(
    (match) =>
      (match.player1Id === Number(form.player1Id) &&
        match.player2Id === Number(form.player2Id)) ||
      (match.player1Id === Number(form.player2Id) &&
        match.player2Id === Number(form.player1Id)),
  );
  const playerOneWins = headToHead.filter((match) =>
    match.player1Id === Number(form.player1Id)
      ? match.score1 > match.score2
      : match.score2 > match.score1,
  ).length;
  const playerTwoWins = headToHead.filter((match) =>
    match.player1Id === Number(form.player2Id)
      ? match.score1 > match.score2
      : match.score2 > match.score1,
  ).length;
  const goalBalance = headToHead.reduce(
    (sum, match) =>
      sum +
      (match.player1Id === Number(form.player1Id)
        ? match.score1 - match.score2
        : match.score2 - match.score1),
    0,
  );
  return (
    <>
      <section className="page-title">
        <div>
          <p>CENTRO DE JOGOS</p>
          <h1>Registrar partida</h1>
          <span>
            Em mata-mata, o empate é bloqueado e o vencedor avança
            automaticamente.
          </span>
        </div>
      </section>
      <section className="grid">
        <article className="panel">
          <form className="form" onSubmit={submit}>
            {select("championshipId", "Campeonato", championships, true)}
            {select("player1Id", "Jogador 1", players)}
            {form.player1Id && form.player2Id && (
              <div className="head-to-head">
                <span className="eyebrow">CONFRONTO DIRETO</span>
                <b>
                  {players.find((p) => p.id === Number(form.player1Id))?.name}{" "}
                  <em>{playerOneWins}V</em> · {headToHead.length} jogos ·{" "}
                  <em>{playerTwoWins}V</em>{" "}
                  {players.find((p) => p.id === Number(form.player2Id))?.name}
                </b>
                <small>
                  Saldo de gols: {goalBalance > 0 ? "+" : ""}
                  {goalBalance}
                </small>
              </div>
            )}
            {selectTeam(
              "team1Id",
              "Time do jogador 1",
              teamSearch1,
              setTeamSearch1,
              showTeamList1,
              setShowTeamList1,
              filteredTeams1,
            )}
            <div className="score">
              {select("score1", "Gols", scores)}
              <strong>×</strong>
              {select("score2", "Gols", scores)}
            </div>
            {select("player2Id", "Jogador 2", players)}
            {selectTeam(
              "team2Id",
              "Time do jogador 2",
              teamSearch2,
              setTeamSearch2,
              showTeamList2,
              setShowTeamList2,
              filteredTeams2,
            )}
            <button className="primary">Salvar resultado</button>
          </form>
        </article>
        <article className="panel wide">
          <div className="panel-head">
            <h2>Histórico</h2>
            <button className="danger" onClick={() => setShowClearModal(true)}>
              Limpar histórico
            </button>
          </div>
          <div className="games matches-history">
            {matches.map((m) => (
              <Game
                key={m.id}
                match={m}
                onEdit={setEditingMatch}
                onDelete={setDeletingMatch}
                onShare={copyMatchSummary}
              />
            ))}
            {!matches.length && <Empty text="As partidas aparecerão aqui." />}
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

const MUTATORS = [
  {
    icon: UsersRound,
    title: "10 em Campo",
    text: "Jogue com um a menos até o apito final.",
    tag: "ELENCO",
  },
  {
    icon: EyeOff,
    title: "Visão Turva",
    text: "Sem minimapa ou HUD durante 10 minutos.",
    tag: "FOCO",
  },
  {
    icon: Goal,
    title: "Pé Ruim",
    text: "Finalizações só valem com o pé não dominante.",
    tag: "TÉCNICA",
  },
  {
    icon: Gauge,
    title: "Goleiro Linha",
    text: "A cada ataque, seu goleiro deve cruzar o meio-campo.",
    tag: "CAOS",
  },
];

function ChampionshipPage({
  players,
  teams,
}: {
  players: Player[];
  teams: Team[];
}) {
  const [items, setItems] = useState<Championship[]>([]),
    [selected, setSelected] = useState<number>(),
    [detail, setDetail] = useState<ChampionshipDetail>(),
    [name, setName] = useState(""),
    [format, setFormat] = useState<"league" | "knockout">("league"),
    [participants, setParticipants] = useState<number[]>([]),
    [mode, setMode] = useState<"classic" | "duo" | "mad">("classic"),
    [team, setTeam] = useState<Team | undefined>(),
    [mutator, setMutator] = useState<number | null>(null),
    [rolling, setRolling] = useState(false),
    [confirming, setConfirming] = useState(false),
    [formError, setFormError] = useState(""),
    [deletingChampionship, setDeletingChampionship] =
      useState<Championship | null>(null),
    [assignments, setAssignments] = useState<Record<number, Team>>({});
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
    if (selected) window.arena.championshipDetail(selected).then(setDetail);
  }, [selected, items.length]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const champ = await window.arena.saveChampionship({
        name,
        format,
        startsAt: new Date().toISOString(),
        status: "active",
        participantIds: participants,
      });
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
        if (included) delete next[id];
        else if (team) next[id] = team;
        return next;
      });
      return included ? list.filter((item) => item !== id) : [...list, id];
    });
  const drawMutator = () => {
    playArenaSound("draw");
    setRolling(true);
    setMutator(null);
    window.setTimeout(() => {
      setMutator(Math.floor(Math.random() * MUTATORS.length));
      setRolling(false);
    }, 700);
  };
  const drawTeam = () => {
    playArenaSound("draw");
    if (teams.length) setTeam(teams[Math.floor(Math.random() * teams.length)]);
  };
  const pairPlayers = () => {
    playArenaSound("draw");
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    setParticipants(shuffled.map((p) => p.id));
    setAssignments(
      Object.fromEntries(
        shuffled.map(
          (p) =>
            [p.id, teams[Math.floor(Math.random() * teams.length)]].filter(
              Boolean,
            ) as [number, Team],
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
          className={mode === "duo" ? "active duo" : ""}
          onClick={() => setMode("duo")}
        >
          <UsersRound />{" "}
          <span>
            Modo Dupla<small>Co-op · 2v2</small>
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
          <div className="nation-grid">
            {teams.slice(0, 9).map((option, index) => (
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
              {rolling ? "Roleta girando..." : "Sortear desafio obrigatório"}
            </button>
          </div>
          <div className={`mutator-cards ${rolling ? "rolling" : ""}`}>
            {MUTATORS.map((rule, index) => {
              const Icon = rule.icon;
              return (
                <button
                  type="button"
                  key={rule.title}
                  onClick={() => setMutator(index)}
                  className={mutator === index ? "revealed" : ""}
                  title={rule.text}
                >
                  <span className="mutator-icon">
                    <Icon size={20} />
                  </span>
                  <small>{rule.tag}</small>
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
          {players.map((p) => (
            <button
              type="button"
              onClick={() => toggleParticipant(p.id)}
              className={participants.includes(p.id) ? "chosen" : ""}
              key={p.id}
            >
              <span className="player-initial">{p.name[0]}</span>
              <span>
                <b>{p.name}</b>
                <small>
                  {participants.includes(p.id)
                    ? `→ ${assignments[p.id]?.name ?? "Escolha uma equipe"}`
                    : mode === "duo"
                      ? "Toque para compor dupla"
                      : "Participante"}
                </small>
              </span>
              {participants.includes(p.id) && <Check size={16} />}
            </button>
          ))}
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

      <section className="season-gallery">
        <div className="section-label">
          <div>
            <span className="eyebrow">HISTÓRICO DA ARENA</span>
            <h2>Suas temporadas</h2>
          </div>
        </div>
        <div className="championship-cards">
          {items.map((c, index) => (
            <button
              className={`season-card ${selected === c.id ? "selected" : ""}`}
              onClick={() => setSelected(c.id)}
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
              </div>
              <footer>
                <span>
                  <Users size={15} /> {c.participants} players
                </span>
                <span>
                  Ver arena <ArrowRight size={15} />
                </span>
              </footer>
            </button>
          ))}
        </div>
        {!items.length && <Empty text="Sua primeira temporada começa aqui." />}
      </section>
      {detail && (
        <ChampionshipDetailView
          detail={detail}
          onDelete={() => {
            if (
              window.confirm(
                `Apagar definitivamente o campeonato “${detail.championship.name}”?`,
              )
            )
              setDeletingChampionship(detail.championship);
          }}
        />
      )}
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
            setDetail(undefined);
            setSelected(undefined);
            await load();
          }}
        />
      )}
    </>
  );
}
function ChampionshipDetailView({
  detail,
  onDelete,
}: {
  detail: ChampionshipDetail;
  onDelete: () => void;
}) {
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
          <h2>
            {detail.championship.format === "league"
              ? "Tabela"
              : "Participantes"}
          </h2>
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
                  <b>{f.matchId ? `${f.score1} × ${f.score2}` : "vs"}</b>
                  <span>{f.player2}</span>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </article>
    </section>
  );
}
function TeamsPage({ teams }: { teams: Team[] }) {
  return (
    <>
      <section className="page-title">
        <div>
          <p>CATÁLOGO</p>
          <h1>Times</h1>
        </div>
      </section>
      <div className="team-directory">
        <div className="team-grid">
          {teams.map((t) => (
            <article className="team-card" key={t.id}>
              <i>
                <Shield size={24} />
              </i>
              <div>
                <b>{t.name}</b>
                <small>
                  {t.league} · {t.country}
                </small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}

function AppModal({
  title,
  message,
  onClose,
  onConfirm,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  danger = false,
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!onConfirm) {
      onClose();
      return;
    }

    setLoading(true);
    setError("");

    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível realizar esta ação.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-modal-backdrop" onMouseDown={onClose}>
      <div className="app-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`app-modal-icon ${danger ? "danger" : ""}`}>
          {danger ? "!" : "?"}
        </div>

        <div className="app-modal-content">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>

        {error && <div className="app-modal-error">{error}</div>}

        <div className="app-modal-actions">
          <button
            type="button"
            className="app-modal-cancel"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </button>

          <button
            type="button"
            className={danger ? "app-modal-danger" : "app-modal-confirm"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Aguarde..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeControl() {
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState(
    () => localStorage.getItem("arena-accent") ?? "#8872ff",
  );
  const [background, setBackground] = useState(
    () => localStorage.getItem("arena-background") ?? "#0a0f1f",
  );
  useEffect(() => {
    document.documentElement.style.setProperty("--arena-accent", accent);
    document.documentElement.style.setProperty("--arena-bg", background);
    localStorage.setItem("arena-accent", accent);
    localStorage.setItem("arena-background", background);
  }, [accent, background]);
  return (
    <div className="theme-control">
      <button
        type="button"
        className="theme-fab"
        onClick={() => setOpen(!open)}
        aria-label="Personalizar tema"
      >
        <Sparkles size={18} />
      </button>
      {open && (
        <div className="theme-popover">
          <b>Personalizar arena</b>
          <label>
            Cor de destaque
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
            />
          </label>
          <label>
            Fundo principal
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            />
          </label>
          <div className="theme-swatches">
            {["#8872ff", "#22c7b8", "#ef4f91", "#f0a947"].map((color) => (
              <button
                type="button"
                key={color}
                style={{ background: color }}
                onClick={() => setAccent(color)}
                aria-label={`Usar destaque ${color}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  reload,
}: {
  reload: () => Promise<void>;
}) {
  type SettingsSection =
    | "appearance"
    | "data"
    | "rules"
    | "catalog"
    | "players"
    | "notifications"
    | "about";

  const sections: Array<{
    id: SettingsSection;
    label: string;
    description: string;
    icon: React.ElementType;
  }> = [
    {
      id: "appearance",
      label: "Aparência",
      description: "Cores e efeitos",
      icon: Sparkles,
    },
    {
      id: "data",
      label: "Dados e backup",
      description: "Estrutura preparada",
      icon: CalendarDays,
    },
    {
      id: "rules",
      label: "Regras do jogo",
      description: "Estrutura preparada",
      icon: Gauge,
    },
    {
      id: "catalog",
      label: "Catálogo de times",
      description: "Estrutura preparada",
      icon: Shield,
    },
    {
      id: "players",
      label: "Jogadores",
      description: "Estrutura preparada",
      icon: Users,
    },
    {
      id: "notifications",
      label: "Notificações",
      description: "Estrutura preparada",
      icon: Volume2,
    },
    {
      id: "about",
      label: "Sobre",
      description: "Informações do app",
      icon: Gamepad2,
    },
  ];

  const [accent, setAccent] = useState(
    () => localStorage.getItem("arena-accent") ?? "#8872ff",
  );

  const [background, setBackground] = useState(
    () => localStorage.getItem("arena-background") ?? "#0a0f1f",
  );

  const [muted, setMuted] = useState(
    () => localStorage.getItem("arena-muted") === "true",
  );

  const [section, setSection] =
    useState<SettingsSection>("appearance");

  const [message, setMessage] = useState("");

  const [rules, setRules] =
    useState<GameRulesSettings | null>(null);

  const [rulesError, setRulesError] = useState("");

  const [savingRules, setSavingRules] =
    useState(false);

  /*
   * ============================================================
   * APARÊNCIA
   * ============================================================
   */

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--arena-accent",
      accent,
    );

    document.documentElement.style.setProperty(
      "--arena-bg",
      background,
    );

    localStorage.setItem("arena-accent", accent);
    localStorage.setItem("arena-background", background);
  }, [accent, background]);

  /*
   * ============================================================
   * ÁUDIO
   * ============================================================
   */

  useEffect(() => {
    localStorage.setItem(
      "arena-muted",
      String(muted),
    );
  }, [muted]);

  /*
   * ============================================================
   * REGRAS DO JOGO
   * ============================================================
   */

  useEffect(() => {
    if (section !== "rules") {
      return;
    }

    setRulesError("");

    void window.arena
      .gameRules()
      .then((savedRules) => {
        setRules(savedRules);
        setRulesError("");
      })
      .catch((error: unknown) => {
        setRulesError(
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as regras do jogo.",
        );
      });
  }, [section]);

  /*
   * ============================================================
   * RESET DOS DADOS
   * ============================================================
   */

  const reset = async () => {
    if (
      !window.confirm(
        "Limpar jogadores, partidas e campeonatos? Esta ação não pode ser desfeita.",
      )
    ) {
      return;
    }

    await window.arena.resetArena();
    await reload();

    setMessage("Dados da Arena limpos.");

    window.setTimeout(() => {
      setMessage("");
    }, 3000);
  };

  /*
   * ============================================================
   * SALVAR REGRAS
   * ============================================================
   */

  const saveRules = async () => {
    if (!rules) {
      return;
    }

    setSavingRules(true);
    setRulesError("");

    try {
      await window.arena.saveGameRules(rules);

      setMessage("Regras do jogo salvas.");

      window.setTimeout(() => {
        setMessage("");
      }, 3000);
    } catch (error: unknown) {
      setRulesError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as regras.",
      );
    } finally {
      setSavingRules(false);
    }
  };

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">
            CONFIGURAÇÕES
          </span>

          <h1>Configurações</h1>

          <p>
            Personalize o FC Arena e configure o funcionamento
            da sua Arena.
          </p>
        </div>
      </header>

      <div className="settings-layout">
        {/* =====================================================
            MENU LATERAL
            ===================================================== */}

        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <span>CONFIGURAÇÕES</span>
          </div>

          <nav className="settings-nav">
            {sections.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${
                    active ? "active" : ""
                  }`}
                  onClick={() => setSection(item.id)}
                >
                  <span className="settings-nav-icon">
                    <Icon size={18} />
                  </span>

                  <span className="settings-nav-content">
                    <strong>{item.label}</strong>

                    <small>
                      {item.description}
                    </small>
                  </span>

                  <ArrowRight
                    size={15}
                    className="settings-nav-arrow"
                  />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* =====================================================
            CONTEÚDO
            ===================================================== */}

        <div className="settings-content">
          {message && (
            <div className="settings-message">
              <Check size={16} />
              <span>{message}</span>
            </div>
          )}

          {/* ===================================================
              APARÊNCIA
              =================================================== */}

          {section === "appearance" ? (
            <article className="settings-card">
              <div className="settings-card-header">
                <div>
                  <span className="settings-card-label">
                    PERSONALIZAÇÃO
                  </span>

                  <h2>Aparência</h2>

                  <p>
                    Personalize as cores e efeitos visuais
                    do FC Arena.
                  </p>
                </div>

                <Sparkles size={22} />
              </div>

              <div className="settings-section">
                <div className="settings-section-heading">
                  <div>
                    <h3>Cor de destaque</h3>

                    <p>
                      Escolha a cor principal utilizada
                      nos elementos da interface.
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
                        accent === color ? "active" : ""
                      }`}
                      style={{
                        background: color,
                      }}
                      onClick={() => setAccent(color)}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-heading">
                  <div>
                    <h3>Fundo</h3>

                    <p>
                      Defina a tonalidade principal do
                      aplicativo.
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
                  {[
                    "#0a0f1f",
                    "#0d1117",
                    "#111318",
                    "#15121d",
                  ].map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Selecionar fundo ${color}`}
                      className={`settings-color-option ${
                        background === color
                          ? "active"
                          : ""
                      }`}
                      style={{
                        background: color,
                      }}
                      onClick={() =>
                        setBackground(color)
                      }
                    />
                  ))}
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-toggle-row">
                  <div className="settings-toggle-content">
                    <h3>Efeitos sonoros</h3>

                    <p>
                      Ative ou desative os sons da
                      interface.
                    </p>
                  </div>

                  <button
                    type="button"
                    className={`settings-toggle ${
                      !muted ? "active" : ""
                    }`}
                    aria-pressed={!muted}
                    onClick={() =>
                      setMuted((value) => !value)
                    }
                  >
                    <span />
                  </button>
                </div>
              </div>
            </article>

          /* ===================================================
             REGRAS
             =================================================== */

          ) : section === "rules" ? (
            <article className="settings-card">
              <div className="settings-card-header">
                <div>
                  <span className="settings-card-label">
                    REGRAS
                  </span>

                  <h2>Regras do jogo</h2>

                  <p>
                    Configure as regras utilizadas nos
                    campeonatos da Arena.
                  </p>
                </div>

                <Gauge size={22} />
              </div>

              {rulesError && (
                <div className="settings-error">
                  {rulesError}
                </div>
              )}

              {!rules ? (
                <div className="settings-loading">
                  <span />
                  <p>
                    Carregando regras...
                  </p>
                </div>
              ) : (
                <>
                  <div className="settings-section">
                    <div className="settings-section-heading">
                      <div>
                        <h3>
                          Configurações gerais
                        </h3>

                        <p>
                          Regras padrão para novos
                          campeonatos.
                        </p>
                      </div>
                    </div>

                    <div className="settings-form-grid">
                      {/* Mantenha aqui os campos de
                          GameRulesSettings que já existiam
                          anteriormente no seu arquivo. */}
                    </div>
                  </div>

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={savingRules}
                      onClick={saveRules}
                    >
                      {savingRules
                        ? "Salvando..."
                        : "Salvar regras"}
                    </button>
                  </div>
                </>
              )}
            </article>

          /* ===================================================
             SOBRE
             =================================================== */

          ) : section === "about" ? (
            <article className="settings-card settings-about-app">
              <div className="settings-about-app-header">
                <div className="settings-about-app-icon">
                  <img
                    src={fcArenaLogo}
                    alt="Logo FC Arena"
                  />
                </div>

                <div className="settings-about-app-heading">
                  <span className="settings-about-app-label">
                    SOBRE O APLICATIVO
                  </span>

                  <h2>FC Arena</h2>

                  <p>
                    Gerenciador de campeonatos para
                    EA Sports FC.
                  </p>
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
                  <strong>
                    Electron + React + TypeScript
                  </strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Banco de dados</span>
                  <strong>
                    SQLite + Supabase
                  </strong>
                </div>

                <div className="settings-about-app-item">
                  <span>Desenvolvedor</span>
                  <strong>
                    Victor Henrique
                  </strong>
                </div>
              </div>

              <div className="settings-about-app-description">
                <span className="settings-about-app-section-label">
                  O PROJETO
                </span>

                <h3>
                  Sobre o FC Arena
                </h3>

                <p>
                  O FC Arena foi desenvolvido para
                  facilitar a criação e o gerenciamento
                  de campeonatos de EA Sports FC,
                  permitindo organizar jogadores,
                  equipes, partidas, rankings e
                  competições em um único lugar.
                </p>
              </div>
            </article>

          /* ===================================================
             OUTRAS SEÇÕES
             =================================================== */

          ) : (
            <article className="settings-card settings-placeholder">
              <div className="settings-placeholder-icon">
                {(() => {
                  const currentSection =
                    sections.find(
                      (item) =>
                        item.id === section,
                    );

                  const Icon =
                    currentSection?.icon ??
                    Sparkles;

                  return <Icon size={22} />;
                })()}
              </div>

              <div>
                <span className="settings-placeholder-label">
                  CONFIGURAÇÃO
                </span>

                <h2>
                  {
                    sections.find(
                      (item) =>
                        item.id === section,
                    )?.label
                  }
                </h2>

                <p>
                  Esta categoria está preparada
                  para uma próxima fase e ainda
                  não possui ações configuradas.
                </p>
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [page, setPage] = useState<Page>("dashboard"),
    [data, setData] = useState<Dashboard>(),
    [loadError, setLoadError] = useState(""),
    [players, setPlayers] = useState<Player[]>([]),
    [teams, setTeams] = useState<Team[]>([]);
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
    void reload();
  }, []);
  if (loadError && !data)
    return (
      <main className="error-state">
        <h1>Não foi possível carregar a Arena</h1>
        <p>{loadError}</p>
        <button className="primary" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  if (!data) return <main className="loading">Carregando arena…</main>;
  const nav: [Page, string, React.ElementType][] = [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["players", "Jogadores", Users],
    ["matches", "Partidas", Gamepad2],
    ["ranking", "Ranking", BarChart3],
    ["championships", "Campeonatos", Trophy],
    ["teams", "Times", Shield],
    ["settings", "Configurações", Sparkles],
  ];
  const view =
    page === "dashboard" ? (
      <DashboardPage data={data} go={setPage} />
    ) : page === "players" ? (
      <PlayersPage players={players} reload={reload} />
    ) : page === "matches" ? (
      <MatchesPage players={players} teams={teams} reload={reload} />
    ) : page === "ranking" ? (
      <>
        <section className="page-title">
          <div>
            <p>CLASSIFICAÇÃO</p>
            <h1>Ranking geral</h1>
          </div>
        </section>
        <article className="panel">
          <Ranking rows={data.ranking} />
        </article>
      </>
    ) : page === "championships" ? (
      <ChampionshipPage players={players} teams={teams} />
    ) : page === "settings" ? (
      <SettingsPage reload={reload} />
    ) : (
      <TeamsPage teams={teams} />
    );
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
          <button onClick={() => window.arena.backup()}>
            <CalendarDays size={18} /> Fazer backup
          </button>
          <button onClick={() => window.arena.restore()}>
            <CalendarDays size={18} /> Restaurar backup
          </button>
          <small>v0.1.0 · dados locais</small>
        </div>
      </aside>
      <main>{view}</main>
      <ThemeControl />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
