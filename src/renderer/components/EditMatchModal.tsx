import { useState } from "react";
import type { Match } from "../../shared/models";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
    new Date(value),
  );

export function EditMatchModal({
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
            {formatDate(match.playedAt)}
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
