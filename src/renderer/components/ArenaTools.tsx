import { Dices, Goal, Route, Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Team } from "../../shared/models";

type ArenaToolResult = { title: string; text: string };

const challenges: ArenaToolResult[] = [
  { title: "Marque 3 gols", text: "Marque pelo menos três gols na partida." },
  { title: "Não sofra gols", text: "Termine a partida sem sofrer gols." },
  { title: "Vença por 2 gols de diferença", text: "Vença com pelo menos dois gols de vantagem." },
  { title: "Faça um gol de cabeça", text: "Marque pelo menos um gol de cabeça." },
  { title: "Vença com um time de 3 estrelas", text: "Escolha um time de três estrelas e vença a partida." },
  { title: "Jogue com um time aleatório", text: "Escolha seu time aleatoriamente antes da partida." },
];

function drawResult<T>(items: readonly T[], previous: T | null): T | null {
  const choices = items.length > 1 ? items.filter((item) => item !== previous) : items;
  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}

export function ArenaTools({ mutators, teams }: { mutators: Array<{ title: string; text: string }>; teams: Team[] }) {
  const [open, setOpen] = useState(false);
  const [mutator, setMutator] = useState<ArenaToolResult | null>(null);
  const [challenge, setChallenge] = useState<ArenaToolResult | null>(null);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [rouletteTeams, setRouletteTeams] = useState<Team[]>([]);
  const [winner, setWinner] = useState<Team | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
  }, []);

  const closePanel = () => {
    if (spinTimer.current !== null) window.clearTimeout(spinTimer.current);
    spinTimer.current = null;
    setSpinning(false);
    setRouletteOpen(false);
    setOpen(false);
  };

  const toggleRoulette = () => {
    if (spinning) return;
    if (rouletteOpen) {
      setRouletteOpen(false);
      return;
    }
    const shuffled = [...new Map(teams.map((team) => [team.id, team])).values()];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setRouletteTeams(shuffled.slice(0, 8));
    setWinner(null);
    setRotation(0);
    setRouletteOpen(true);
  };

  const spin = () => {
    if (spinTimer.current !== null || rouletteTeams.length === 0) return;
    const index = Math.floor(Math.random() * rouletteTeams.length);
    const result = rouletteTeams[index];
    const target = (360 - index * 360 / rouletteTeams.length) % 360;
    const current = ((rotation % 360) + 360) % 360;
    const nextRotation = rotation + 5 * 360 + ((target - current + 360) % 360);
    setWinner(null);
    setSpinning(true);
    setRotation(nextRotation);
    spinTimer.current = window.setTimeout(() => {
      setWinner(result);
      setSpinning(false);
      spinTimer.current = null;
    }, 2000);
  };

  return (
    <div className="arena-tools">
      <button
        type="button"
        className="arena-tools-fab"
        onClick={() => open ? closePanel() : setOpen(true)}
        aria-label="Abrir ferramentas da Arena"
      >
        <Route size={18} />
      </button>

      {open && (
        <div className="arena-tools-popover">
          <b>Central da Arena</b>
          <button type="button" className="arena-tools-close" onClick={closePanel} aria-label="Fechar Central da Arena">
            Fechar
          </button>

          <button
            type="button"
            className="arena-tool-button"
            onClick={() => setMutator(drawResult(mutators, mutator))}
            disabled={!mutators.length}
          >
            <Dices size={17} />
            <span>
              <strong>Mutador aleatório</strong>
              <small>Sortear um desafio para a partida</small>
            </span>
          </button>
          {mutator && <div className="panel" aria-live="polite"><strong>{mutator.title}</strong><p>{mutator.text}</p></div>}

          <button
            type="button"
            className="arena-tool-button"
            onClick={() => setChallenge(drawResult(challenges, challenge))}
          >
            <Goal size={17} />
            <span>
              <strong>Desafio rápido</strong>
              <small>Criar uma missão para os jogadores</small>
            </span>
          </button>
          {challenge && <div className="panel" aria-live="polite"><strong>{challenge.title}</strong><p>{challenge.text}</p></div>}

          <button
            type="button"
            className="arena-tool-button"
            onClick={toggleRoulette}
            disabled={spinning}
          >
            <Shuffle size={17} />
            <span>
              <strong>Roleta da Arena</strong>
              <small>Sortear um time</small>
            </span>
          </button>
          {rouletteOpen && (
            <div className="roulette-panel">
              {rouletteTeams.length ? <>
                <div className="roulette-frame">
                  <span className="roulette-pointer" aria-hidden="true">▼</span>
                  <div className="roulette" style={{ transform: `rotate(${rotation}deg)` }} aria-label="Times sorteados para a roleta">
                    {rouletteTeams.map((team, index) => (
                      <span className="roulette-item" key={team.id} style={{ transform: `translate(-50%, -50%) rotate(${index * 360 / rouletteTeams.length}deg) translateY(-78px)` }} title={team.name}>{team.name}</span>
                    ))}
                  </div>
                </div>
                <button type="button" className="button button--primary" onClick={spin} disabled={spinning}>Girar</button>
                <p aria-live="polite">{spinning ? "Sorteando..." : winner ? `Time sorteado: ${winner.name}` : "Gire para sortear um time."}</p>
              </> : <p>Nenhum time disponível para sortear.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
