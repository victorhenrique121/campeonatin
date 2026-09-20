import { Flame, Swords } from "lucide-react";
import { useMemo } from "react";
import type { Match, Player } from "../shared/models";

/**
 * Confronto direto (H2H) entre os dois jogadores escolhidos no formulário
 * "Registrar partida".
 *
 * Feature aditiva de leitura: não toca em saveMatch, fixtures nem em nenhuma
 * lógica de campeonato. Consome o MESMO array de partidas que a tela já
 * carrega (`arena.matches()`, leitura sempre local — decisão da Etapa 4) e o
 * MESMO estado de seleção de jogadores que alimenta os TeamPickers, ou seja,
 * o card reage assim que os dois jogadores são escolhidos, sem esperar pelos
 * times.
 *
 * Escopo (decisão de produto): considera SOMENTE partidas avulsas
 * (`championshipId` nulo). Resultados de campeonato continuam sendo vistos no
 * detalhe da própria temporada.
 */

/** Partida do par já orientada: lado 1 = jogador 1 do formulário. */
type Duel = {
  id: number;
  playedAt: string;
  score1: number;
  score2: number;
  team1: string;
  team2: string;
};

type HeadToHeadSummary = {
  total: number;
  wins1: number;
  wins2: number;
  draws: number;
  /** Saldo de gols do jogador 1 do formulário (pode ser negativo). */
  balance: number;
  /** Vitórias seguidas do mesmo jogador, contadas do duelo mais recente. */
  streak: number;
  /** Lado dono da sequência (1 = jogador do formulário, 2 = adversário). */
  streakSide: 1 | 2 | null;
  last: Duel | null;
};

type HeadToHeadCardProps = {
  matches: Match[];
  players: Player[];
  /** Valores do <select> do formulário: string vazia = nada escolhido. */
  player1Id: string;
  player2Id: string;
  /** true enquanto o histórico ainda não terminou de carregar. */
  loading?: boolean;
};

/** `played_at` é TEXT (ISO ou "AAAA-MM-DD HH:MM:SS"); ambos ordenam por tempo. */
const timeOf = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const formatDate = (value: string) => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "data inválida";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(time);
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function HeadToHeadCard({
  matches,
  players,
  player1Id,
  player2Id,
  loading = false,
}: HeadToHeadCardProps) {
  const id1 = Number(player1Id);
  const id2 = Number(player2Id);
  const hasBoth = Boolean(id1) && Boolean(id2);
  const samePlayer = hasBoth && id1 === id2;
  const ready = hasBoth && !samePlayer;

  const duels = useMemo<Duel[]>(() => {
    if (!ready) return [];
    return matches
      .filter(
        (match) =>
          match.championshipId === null || match.championshipId === undefined,
      )
      .filter(
        (match) =>
          (match.player1Id === id1 && match.player2Id === id2) ||
          (match.player1Id === id2 && match.player2Id === id1),
      )
      .map((match) => {
        // Orienta a partida para o ponto de vista do jogador 1 do formulário:
        // ele pode ter sido mandante (player1) ou visitante (player2).
        const asPlayerOne = match.player1Id === id1;
        return {
          id: match.id,
          playedAt: match.playedAt,
          score1: asPlayerOne ? match.score1 : match.score2,
          score2: asPlayerOne ? match.score2 : match.score1,
          team1: asPlayerOne ? match.team1 : match.team2,
          team2: asPlayerOne ? match.team2 : match.team1,
        };
      })
      .sort((a, b) => timeOf(b.playedAt) - timeOf(a.playedAt) || b.id - a.id);
  }, [matches, id1, id2, ready]);

  const summary = useMemo<HeadToHeadSummary>(() => {
    const wins1 = duels.filter((duel) => duel.score1 > duel.score2).length;
    const wins2 = duels.filter((duel) => duel.score2 > duel.score1).length;
    let streak = 0;
    let streakSide: 1 | 2 | null = null;
    // Caminha do duelo mais recente para o mais antigo (mesma ideia do
    // withStreaks do repository, só que restrita ao par): empate ou vitória do
    // outro lado interrompe a sequência.
    for (const duel of duels) {
      const winner: 1 | 2 | null =
        duel.score1 > duel.score2 ? 1 : duel.score2 > duel.score1 ? 2 : null;
      if (winner === null) break;
      if (streakSide === null) {
        streakSide = winner;
        streak = 1;
        continue;
      }
      if (winner !== streakSide) break;
      streak += 1;
    }
    return {
      total: duels.length,
      wins1,
      wins2,
      draws: duels.length - wins1 - wins2,
      balance: duels.reduce((sum, duel) => sum + (duel.score1 - duel.score2), 0),
      streak,
      streakSide,
      last: duels[0] ?? null,
    };
  }, [duels]);

  const name1 = players.find((player) => player.id === id1)?.name ?? "Jogador 1";
  const name2 = players.find((player) => player.id === id2)?.name ?? "Jogador 2";

  const renderBody = () => {
    if (loading)
      return (
        <div className="h2h-loading">
          <span className="h2h-skeleton h2h-skeleton-title" />
          <span className="h2h-skeleton" />
          <span className="h2h-skeleton h2h-skeleton-short" />
          <small>Carregando confrontos…</small>
        </div>
      );

    if (!hasBoth)
      return (
        <p className="h2h-hint">
          Selecione dois jogadores acima para carregar o histórico de
          confrontos.
        </p>
      );

    if (samePlayer)
      return (
        <p className="h2h-hint">
          Escolha dois jogadores diferentes para ver o retrospecto.
        </p>
      );

    if (!summary.total || !summary.last)
      return (
        <div className="h2h-empty">
          <p>
            <b>{name1}</b> e <b>{name2}</b> ainda não se enfrentaram em partidas
            avulsas.
          </p>
          <small>
            Resultados de campeonato aparecem no detalhe da temporada.
          </small>
        </div>
      );

    const last = summary.last;
    const streakName = summary.streakSide === 1 ? name1 : name2;
    const streakRival = summary.streakSide === 1 ? name2 : name1;

    return (
      <div className="h2h-body">
        <div className="h2h-score">
          <div className="h2h-side">
            <strong title={name1}>{name1}</strong>
            <span>{plural(summary.wins1, "vitória", "vitórias")}</span>
          </div>
          <div className="h2h-mid">
            <b>
              {summary.wins1}
              <i>×</i>
              {summary.wins2}
            </b>
            <small>
              {plural(summary.total, "jogo", "jogos")} ·{" "}
              {plural(summary.draws, "empate", "empates")}
            </small>
          </div>
          <div className="h2h-side is-right">
            <strong title={name2}>{name2}</strong>
            <span>{plural(summary.wins2, "vitória", "vitórias")}</span>
          </div>
        </div>

        <dl className="h2h-facts">
          <div>
            <dt>Último duelo</dt>
            <dd>
              {formatDate(last.playedAt)} · <b>{last.score1} × {last.score2}</b>
              <small>
                {last.team1} × {last.team2}
              </small>
            </dd>
          </div>
          <div>
            <dt>Saldo de gols ({name1})</dt>
            <dd>
              {summary.balance > 0 ? "+" : ""}
              {summary.balance}
            </dd>
          </div>
        </dl>

        {/* Só existe destaque quando há sequência real de 2+ vitórias; caso
            contrário o bloco é omitido (nada de texto genérico). */}
        {summary.streak >= 2 && summary.streakSide !== null && (
          <p className="h2h-streak">
            <Flame size={13} />
            <span>
              <b>{streakName}</b> venceu os últimos <b>{summary.streak}</b>{" "}
              jogos contra {streakRival}.
            </span>
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="h2h-card" aria-live="polite" aria-busy={loading}>
      <header className="h2h-head">
        <span className="h2h-eyebrow">
          <Swords size={12} /> CONFRONTO DIRETO
        </span>
        <small className="h2h-scope" title="Considera apenas partidas avulsas">
          partidas avulsas
        </small>
      </header>
      {renderBody()}
    </section>
  );
}