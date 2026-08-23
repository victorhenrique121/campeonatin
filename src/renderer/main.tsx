import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  CalendarDays,
  CirclePlus,
  Gamepad2,
  LayoutDashboard,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import type {
  Championship,
  ChampionshipDetail,
  Dashboard,
  Fixture,
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
  | "teams";
const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
    new Date(value),
  );
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
}: {
  match: Match;
  onEdit: (match: Match) => void;
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
  const metrics = [
    ["PARTIDAS", data.matches],
    ["JOGADORES", data.players],
    ["LÍDER", data.leader?.name ?? "—"],
    ["TIME MAIS USADO", data.mostUsedTeam ?? "—"],
  ];
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
        <article className="panel">
          <div className="panel-head">
            <h2>Últimas partidas</h2>
          </div>
          {data.recent.length ? (
            <div className="games">
              {data.recent.map((m) => (
                <Game key={m.id} match={m} onEdit={setEditingMatch} />
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
          <div className="cards">
            {players.map((p) => (
              <div className="player-card" key={p.id}>
                <i>{p.name[0]}</i>
                <div>
                  <b>{p.name}</b>
                  <small>@{p.nickname}</small>
                </div>
                <button
                  className="danger"
                  onClick={async () => {
                    if (
                      !confirm(
                        `Excluir ${p.name}?\n\nAs partidas e participações desse jogador também serão removidas.`,
                      )
                    ) {
                      return;
                    }

                    try {
                      await window.arena.deletePlayer(p.id);
                      await reload();
                    } catch (error) {
                      alert(
                        error instanceof Error
                          ? error.message
                          : "Não foi possível excluir o jogador.",
                      );
                    }
                  }}
                >
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
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#0b1224",
            border: "1px solid #293653",
            borderRadius: "7px",
            maxHeight: "250px",
            overflowY: "auto",
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
          <div className="games">
            {matches.map((m) => (
              <Game key={m.id} match={m} onEdit={setEditingMatch} />
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
    </>
  );
}

function ChampionshipPage({ players }: { players: Player[] }) {
  const [items, setItems] = useState<Championship[]>([]),
    [selected, setSelected] = useState<number>(),
    [detail, setDetail] = useState<ChampionshipDetail>(),
    [name, setName] = useState(""),
    [format, setFormat] = useState<"league" | "knockout">("league"),
    [participants, setParticipants] = useState<number[]>([]);
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
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o campeonato.",
      );
    }
  };
  return (
    <>
      <section className="page-title">
        <div>
          <p>COMPETIÇÕES</p>
          <h1>Campeonatos</h1>
          <span>Tabela de pontos corridos ou chave eliminatória.</span>
        </div>
      </section>
      <section className="grid">
        <article className="panel">
          <form className="form" onSubmit={save}>
            <label>
              Nome do campeonato
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              Formato
              <select
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as "league" | "knockout")
                }
              >
                <option value="league">Pontos corridos</option>
                <option value="knockout">Mata-mata</option>
              </select>
            </label>
            <label>
              Participantes{" "}
              {format === "knockout" && <small>(2, 4, 8, 16 ou 32)</small>}
            </label>
            <div className="check-list">
              {players.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={participants.includes(p.id)}
                    onChange={() =>
                      setParticipants((list) =>
                        list.includes(p.id)
                          ? list.filter((id) => id !== p.id)
                          : [...list, p.id],
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <button className="primary">
              {format === "league" ? "Gerar rodadas" : "Gerar chave"}
            </button>
          </form>
        </article>
        <article className="panel wide">
          <div className="panel-head">
            <h2>Temporadas</h2>
          </div>
          {items.map((c) => (
            <button
              className={"champ " + (selected === c.id ? "selected" : "")}
              onClick={() => setSelected(c.id)}
              key={c.id}
            >
              <Trophy size={22} />
              <div>
                <b>{c.name}</b>
                <small>
                  {c.format === "knockout" ? "Mata-mata" : "Pontos corridos"} ·{" "}
                  {c.participants} participantes
                </small>
              </div>
              <span>{c.status === "draft" ? "Rascunho" : "Ativo"}</span>
            </button>
          ))}
          {!items.length && <Empty text="Nenhum campeonato criado." />}
        </article>
      </section>
      {detail && <ChampionshipDetailView detail={detail} />}
    </>
  );
}
function ChampionshipDetailView({ detail }: { detail: ChampionshipDetail }) {
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

  async function handleConfirm() {
    if (!onConfirm) {
      onClose();
      return;
    }

    try {
      setLoading(true);
      await onConfirm();
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-modal-backdrop" onMouseDown={onClose}>
      <div className="app-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="app-modal-icon">{danger ? "!" : "?"}</div>

        <div className="app-modal-content">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>

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

function App() {
  const [page, setPage] = useState<Page>("dashboard"),
    [data, setData] = useState<Dashboard>(),
    [players, setPlayers] = useState<Player[]>([]),
    [teams, setTeams] = useState<Team[]>([]);
  const reload = async () => {
    const [dashboard, playerList, teamList] = await Promise.all([
      window.arena.dashboard(),
      window.arena.players(),
      window.arena.teams(),
    ]);
    setData(dashboard);
    setPlayers(playerList);
    setTeams(teamList);
  };
  useEffect(() => {
    reload();
  }, []);
  if (!data) return <main className="loading">Carregando arena…</main>;
  const nav: [Page, string, React.ElementType][] = [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["players", "Jogadores", Users],
    ["matches", "Partidas", Gamepad2],
    ["ranking", "Ranking", BarChart3],
    ["championships", "Campeonatos", Trophy],
    ["teams", "Times", Shield],
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
      <ChampionshipPage players={players} />
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
          <small>v0.2 · dados locais</small>
        </div>
      </aside>
      <main>{view}</main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
