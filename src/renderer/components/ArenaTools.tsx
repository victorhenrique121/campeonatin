import { Dices, Goal, Route, Shuffle } from "lucide-react";
import { useState } from "react";

type ArenaToolResult = { title: string; text: string };

const challenges: ArenaToolResult[] = [
  { title: "Marque 3 gols", text: "Marque pelo menos três gols na partida." },
  { title: "Não sofra gols", text: "Termine a partida sem sofrer gols." },
  { title: "Vença por 2 gols de diferença", text: "Vença com pelo menos dois gols de vantagem." },
  { title: "Faça um gol de cabeça", text: "Marque pelo menos um gol de cabeça." },
  { title: "Vença com um time de 3 estrelas", text: "Escolha um time de três estrelas e vença a partida." },
  { title: "Jogue com um time aleatório", text: "Escolha seu time aleatoriamente antes da partida." },
];

const rules: ArenaToolResult[] = [
  { title: "Partida valendo o dobro", text: "Combine com os jogadores que esta partida vale o dobro." },
  { title: "Jogar com time aleatório", text: "Escolha o time aleatoriamente antes da partida." },
  { title: "Jogar com um jogador a menos", text: "Jogue a partida com um jogador a menos." },
  { title: "Gols de fora da área valem 2", text: "Conte em dobro os gols marcados de fora da área." },
  { title: "Sem faltas", text: "Evite cometer faltas durante a partida." },
  { title: "Jogo com duração reduzida", text: "Combine uma duração menor antes de começar." },
  { title: "Time espelhado", text: "Os dois jogadores usam o mesmo time." },
  { title: "Pênalti no início", text: "Comece a partida com um pênalti combinado entre os jogadores." },
];

function drawResult<T>(items: readonly T[], previous: T | null): T | null {
  const choices = items.length > 1 ? items.filter((item) => item !== previous) : items;
  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}

export function ArenaTools({ mutators }: { mutators: Array<{ title: string; text: string }> }) {
  const [open, setOpen] = useState(false);
  const [mutator, setMutator] = useState<ArenaToolResult | null>(null);
  const [challenge, setChallenge] = useState<ArenaToolResult | null>(null);
  const [rule, setRule] = useState<ArenaToolResult | null>(null);

  return (
    <div className="arena-tools">
      <button
        type="button"
        className="arena-tools-fab"
        onClick={() => setOpen(!open)}
        aria-label="Abrir ferramentas da Arena"
      >
        <Route size={18} />
      </button>

      {open && (
        <div className="arena-tools-popover">
          <b>Central da Arena</b>

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
            onClick={() => setRule(drawResult(rules, rule))}
          >
            <Shuffle size={17} />
            <span>
              <strong>Roleta da Arena</strong>
              <small>Deixe a sorte decidir</small>
            </span>
          </button>
          {rule && <div className="panel" aria-live="polite"><strong>{rule.title}</strong><p>{rule.text}</p></div>}
        </div>
      )}
    </div>
  );
}
