import { Dices, Goal, Route, Shuffle } from "lucide-react";
import { useState } from "react";

export function ArenaTools() {
  const [open, setOpen] = useState(false);

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
            onClick={() => console.log("Mutador aleatório")}
          >
            <Dices size={17} />
            <span>
              <strong>Mutador aleatório</strong>
              <small>Sortear um desafio para a partida</small>
            </span>
          </button>

          <button
            type="button"
            className="arena-tool-button"
            onClick={() => console.log("Desafio rápido")}
          >
            <Goal size={17} />
            <span>
              <strong>Desafio rápido</strong>
              <small>Criar uma missão para os jogadores</small>
            </span>
          </button>

          <button
            type="button"
            className="arena-tool-button"
            onClick={() => console.log("Roleta")}
          >
            <Shuffle size={17} />
            <span>
              <strong>Roleta da Arena</strong>
              <small>Deixe a sorte decidir</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
