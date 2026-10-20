import { useState } from "react";

type Props = {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export function AppModal({
  title,
  message,
  onClose,
  onConfirm,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  danger = false,
}: Props) {
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
      <div
        className="app-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="app-modal-close"
          onClick={onClose}
          disabled={loading}
          aria-label="Fechar"
        >
          ×
        </button>
        <div className={`app-modal-icon ${danger ? "danger" : ""}`}>
          {danger ? "!" : "?"}
        </div>

        <div className="app-modal-content">
          <h2 id="app-modal-title">{title}</h2>
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
