import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { validatePasswordChange } from "../../shared/validation";

type PasswordFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  show: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  disabled: boolean;
};

function PasswordField({
  label,
  value,
  placeholder,
  autoComplete,
  show,
  onChange,
  onToggle,
  disabled,
}: PasswordFieldProps) {
  return (
    <label className="settings-password-field">
      <span>{label}</span>
      <div className="settings-password-input">
        <LockKeyhole size={16} />
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="settings-password-visibility"
          onClick={onToggle}
          disabled={disabled}
          aria-label={show ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  // Ao sair da seção, o componente é desmontado e os estados das senhas
  // deixam de existir; ao voltar, o formulário começa vazio.

  const validation = useMemo(
    () => validatePasswordChange(currentPassword, newPassword, confirmation),
    [currentPassword, newPassword, confirmation],
  );

  const hasNewPassword = newPassword.length > 0;
  const hasConfirmation = confirmation.length > 0;

  const canSubmit =
    !loading &&
    validation.currentFilled &&
    validation.minimumLength &&
    validation.confirmationMatches &&
    validation.differentFromCurrent;

  const submit = async () => {
    setError("");
    setSuccess("");

    if (!currentPassword) {
      setError("Informe sua senha atual.");
      return;
    }
    if (newPassword.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("A nova senha deve ser diferente da senha atual.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("A confirmação da nova senha não coincide.");
      return;
    }

    setLoading(true);

    try {
      await window.arena.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSuccess("Senha alterada com sucesso. As outras sessões foram encerradas.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Algo deu errado. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="settings-card settings-password-card">
      <div className="settings-card-header">
        <div>
          <span className="settings-card-label">SEGURANÇA</span>
          <h2>Senha</h2>
          <p>Altere a senha da sua conta com uma confirmação da senha atual.</p>
        </div>
        <ShieldCheck size={22} />
      </div>

      <div className="settings-password-body">
        <div className="settings-password-form">
          <PasswordField
            label="Senha atual"
            value={currentPassword}
            placeholder="Digite sua senha atual"
            autoComplete="current-password"
            show={showCurrent}
            onChange={setCurrentPassword}
            onToggle={() => setShowCurrent((value) => !value)}
            disabled={loading}
          />

          <PasswordField
            label="Nova senha"
            value={newPassword}
            placeholder="Mínimo de 8 caracteres"
            autoComplete="new-password"
            show={showNew}
            onChange={setNewPassword}
            onToggle={() => setShowNew((value) => !value)}
            disabled={loading}
          />

          <PasswordField
            label="Confirmar nova senha"
            value={confirmation}
            placeholder="Digite a nova senha novamente"
            autoComplete="new-password"
            show={showConfirmation}
            onChange={setConfirmation}
            onToggle={() => setShowConfirmation((value) => !value)}
            disabled={loading}
          />
        </div>

        <div className="settings-password-validation" aria-live="polite">
          <span className={hasNewPassword ? (validation.minimumLength ? "valid" : "invalid") : ""}>
            {validation.minimumLength ? <Check size={14} /> : <span className="settings-password-dot" />}
            Mínimo de 8 caracteres
          </span>
          <span className={hasNewPassword ? (validation.differentFromCurrent ? "valid" : "invalid") : ""}>
            {validation.differentFromCurrent ? <Check size={14} /> : <span className="settings-password-dot" />}
            Diferente da senha atual
          </span>
          <span className={hasConfirmation ? (validation.confirmationMatches ? "valid" : "invalid") : ""}>
            {validation.confirmationMatches ? <Check size={14} /> : <span className="settings-password-dot" />}
            As senhas coincidem
          </span>
        </div>

        {success && (
          <div className="settings-password-success" role="status">
            <Check size={16} />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}

        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {loading ? (
              <>
                <RefreshCw size={15} className="settings-password-spin" />
                Alterando senha...
              </>
            ) : (
              "Alterar senha"
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
