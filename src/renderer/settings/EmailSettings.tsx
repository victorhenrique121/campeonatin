import { useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import type { EmailSettings as EmailSettingsData } from "../../shared/api";
import { getFriendlyEmailSettingsError } from "./auth-error";

function formatEmailStatus(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : null;
}

export function EmailSettings() {
  const [settings, setSettings] = useState<EmailSettingsData | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const loadSettings = async () => {
    setLoadingSettings(true);
    setError("");

    try {
      setSettings(await window.arena.auth.emailSettings());
    } catch (err) {
      setError(getFriendlyEmailSettingsError(err));
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = window.setInterval(() => {
      setResendCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const normalizedNewEmail = newEmail.trim().toLowerCase();

  const validation = useMemo(() => {
    const current = settings?.email.trim().toLowerCase() ?? "";
    const validFormat =
      normalizedNewEmail.length > 0 &&
      /^\S+@\S+\.\S+$/.test(normalizedNewEmail);

    return {
      validFormat,
      different: validFormat && normalizedNewEmail !== current,
    };
  }, [normalizedNewEmail, settings?.email]);

  const canSubmit =
    !loading &&
    !loadingSettings &&
    Boolean(currentPassword) &&
    validation.validFormat &&
    validation.different;

  const submit = async () => {
    setError("");
    setSuccess("");
    setNotice("");

    if (!currentPassword) {
      setError("Informe sua senha atual.");
      return;
    }

    if (!validation.validFormat) {
      setError("Informe um e-mail válido.");
      return;
    }

    if (!validation.different) {
      setError("O novo e-mail deve ser diferente do e-mail atual.");
      return;
    }

    setLoading(true);

    try {
      const updated = await window.arena.auth.changeEmail({
        currentPassword,
        newEmail: normalizedNewEmail,
      });

      setSettings(updated);
      setCurrentPassword("");
      setNewEmail("");
      setSuccess(
        "Enviamos um e-mail de confirmação. Seu e-mail só muda depois da confirmação. Até lá, continue entrando com o e-mail atual.",
      );
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

  const resend = async () => {
    if (!settings?.pendingEmail || resending || resendCooldown > 0) return;

    setError("");
    setSuccess("");
    setNotice("");
    setResending(true);

    try {
      await window.arena.auth.resendEmailChange(settings.pendingEmail);
      setResendCooldown(60);
      setNotice(
        "Solicitação de reenvio aceita. Verifique o endereço pendente e a pasta de spam.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Algo deu errado. Tente novamente em instantes.",
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <article className="settings-card settings-email-card">
      <div className="settings-card-header">
        <div>
          <span className="settings-card-label">CONTA</span>
          <h2>E-mail</h2>
          <p>Gerencie o endereço usado para entrar no FC Arena.</p>
        </div>
        <Mail size={22} />
      </div>

      {loadingSettings ? (
        <div className="settings-loading">
          <span />
          <p>Carregando e-mail...</p>
        </div>
      ) : (
        <div className="settings-email-body">
          <section className="settings-email-status">
            <div className="settings-email-status-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <span className="settings-email-label">E-MAIL ATUAL</span>
              <strong>{settings?.email || "—"}</strong>
              <small>
                {settings?.emailConfirmedAt
                  ? "Verificado em " + formatEmailStatus(settings.emailConfirmedAt)
                  : "Ainda não verificado"}
              </small>
            </div>
          </section>

          {settings?.pendingEmail && (
            <section className="settings-email-pending">
              <div>
                <span className="settings-email-label">TROCA PENDENTE</span>
                <strong>{settings.pendingEmail}</strong>
                <p>
                  O endereço só será alterado depois da confirmação. Até lá,
                  continue entrando com o e-mail atual.
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void resend()}
                disabled={resending || resendCooldown > 0}
              >
                {resending ? (
                  <>
                    <RefreshCw size={14} className="settings-email-spin" />
                    Reenviando...
                  </>
                ) : resendCooldown > 0 ? (
                  "Reenviar em " + resendCooldown + "s"
                ) : (
                  "Reenviar confirmação"
                )}
              </button>
            </section>
          )}

          <div className="settings-email-security-note">
            <ShieldCheck size={16} />
            <p>
              Se a opção de troca segura de e-mail estiver ativa no Supabase,
              será necessário confirmar a alteração nos dois endereços.
            </p>
          </div>

          <div className="settings-email-form">
            <label className="settings-email-field">
              <span>Novo e-mail</span>
              <div className="settings-email-input">
                <Mail size={16} />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder="novo@email.com"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              {newEmail && !validation.validFormat && (
                <small>Informe um e-mail válido.</small>
              )}
              {newEmail && validation.validFormat && !validation.different && (
                <small>O novo e-mail deve ser diferente do atual.</small>
              )}
            </label>

            <label className="settings-email-field">
              <span>Senha atual</span>
              <div className="settings-email-input">
                <ShieldCheck size={16} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Digite sua senha atual"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="settings-email-visibility"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                  aria-label={
                    showPassword ? "Ocultar senha atual" : "Mostrar senha atual"
                  }
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>

          {notice && (
            <div className="settings-email-notice" role="status">
              {notice}
            </div>
          )}

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
                  <RefreshCw size={15} className="settings-email-spin" />
                  Enviando...
                </>
              ) : (
                "Alterar e-mail"
              )}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
