import { FormEvent, useState } from "react";
import { Eye, EyeOff, Mail, LockKeyhole, UserRound, ArrowRight, RefreshCw } from "lucide-react";
import type { AuthUser } from "../shared/api";

type Mode = "login" | "signup";

type Props = {
  onAuthenticated: (user: AuthUser) => void;
};

export function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");

  const resetMessages = () => {
    setError("");
    setNotice("");
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    resetMessages();
    setPassword("");
    setPasswordConfirmation("");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    resetMessages();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError("Informe seu e-mail.");
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        setError("Informe seu nome.");
        return;
      }
      if (password.length < 8) {
        setError("A senha deve ter pelo menos 8 caracteres.");
        return;
      }
      if (password !== passwordConfirmation) {
        setError("As senhas não coincidem.");
        return;
      }
    } else if (!password) {
      setError("Informe sua senha.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "signup") {
        const result = await window.arena.auth.signUp(
          normalizedEmail,
          password,
          name.trim(),
        );

        setVerificationEmail(result.email);
        setNotice(
          result.requiresEmailConfirmation
            ? "Conta criada. Enviamos um e-mail de confirmação. Confirme seu endereço antes de entrar."
            : "Conta criada. Você já pode entrar.",
        );
        setMode("login");
        setPassword("");
        setPasswordConfirmation("");
      } else {
        const user = await window.arena.auth.signIn(normalizedEmail, password);
        onAuthenticated(user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a operação.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!verificationEmail) return;
    setLoading(true);
    setError("");
    setNotice("");

    try {
      await window.arena.auth.resendConfirmation(verificationEmail);
      setNotice("Novo e-mail de confirmação enviado. Verifique também a pasta de spam.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reenviar o e-mail.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">FC</div>
          <div>
            <strong>FC <em>ARENA</em></strong>
            <span>GERENCIADOR DE CAMPEONATOS</span>
          </div>
        </div>

        <div className="auth-heading">
          <span>{mode === "login" ? "BEM-VINDO DE VOLTA" : "NOVA CONTA"}</span>
          <h1>{mode === "login" ? "Entrar no FC Arena" : "Criar sua conta"}</h1>
          <p>
            {mode === "login"
              ? "Entre para continuar seus campeonatos e partidas."
              : "Crie seu acesso para usar o FC Arena."}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>
              <span>Nome</span>
              <div className="auth-input">
                <UserRound size={17} />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Como você quer aparecer"
                  autoComplete="name"
                  maxLength={60}
                  disabled={loading}
                />
              </div>
            </label>
          )}

          <label>
            <span>E-mail</span>
            <div className="auth-input">
              <Mail size={17} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@email.com"
                autoComplete="email"
                maxLength={254}
                disabled={loading}
              />
            </div>
          </label>

          <label>
            <span>Senha</span>
            <div className="auth-input">
              <LockKeyhole size={17} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo de 8 caracteres"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                disabled={loading}
              />
              <button
                type="button"
                className="auth-input-action"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {mode === "signup" && (
            <label>
              <span>Confirmar senha</span>
              <div className="auth-input">
                <LockKeyhole size={17} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={passwordConfirmation}
                  onChange={(e) => setPasswordConfirmation(e.target.value)}
                  placeholder="Digite a senha novamente"
                  autoComplete="new-password"
                  disabled={loading}
                />
              </div>
            </label>
          )}

          {notice && (
            <div className="auth-notice" role="status">
              <Mail size={16} />
              <div>
                <strong>{notice}</strong>
                {verificationEmail && mode === "login" && (
                  <span>
                    Endereço: <b>{verificationEmail}</b>. Depois da confirmação, volte aqui e entre normalmente.
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? (
              <>
                <RefreshCw size={16} className="auth-spin" />
                Aguarde...
              </>
            ) : (
              <>
                {mode === "login" ? "Entrar" : "Criar conta"}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {verificationEmail && mode === "login" && (
          <button className="auth-resend" type="button" onClick={() => void resend()} disabled={loading}>
            Reenviar e-mail de confirmação
          </button>
        )}

        <div className="auth-switch">
          <span>
            {mode === "login" ? "Ainda não tem uma conta?" : "Já tem uma conta?"}
          </span>
          <button type="button" onClick={() => changeMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Criar conta" : "Entrar"}
          </button>
        </div>

        <small className="auth-footnote">
          Ao criar uma conta, você precisará confirmar o e-mail antes do primeiro login.
        </small>
      </section>
    </main>
  );
}
