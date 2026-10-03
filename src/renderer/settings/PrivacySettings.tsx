import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { getFriendlyPrivacyError } from "./auth-error";

export function PrivacySettings() {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const endOtherSessions = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await window.arena.auth.signOutOthers();
      setSuccess("As outras sessões foram encerradas com sucesso.");
      setConfirming(false);
    } catch (requestError) {
      setError(getFriendlyPrivacyError(requestError));
    } finally {
      setSaving(false);
    }
  };

  const comingSoon = [
    ["Perfil público ou privado", "Permitirá escolher quem pode visualizar seu perfil."],
    ["Estatísticas e títulos", "Permitirá controlar a exibição dessas informações."],
    ["Quem pode me convidar para salas", "Permitirá escolher quem pode enviar convites."],
    ["Aparecer na busca por @username", "Permitirá controlar sua presença na busca."],
    ["Baixar meus dados", "Permitirá solicitar uma cópia dos seus dados."],
    ["Excluir conta", "Permitirá solicitar a exclusão da conta e dos dados associados."],
    ["Autenticação em dois fatores", "Permitirá adicionar uma segunda etapa de proteção à conta."],
  ];

  return (
    <article className="settings-card">
      <div className="settings-card-header">
        <div><span className="settings-card-label">PRIVACIDADE</span><h2>Privacidade</h2><p>Controle o acesso à sua conta e as opções de privacidade.</p></div>
        <ShieldCheck size={22} />
      </div>
      {success && <div className="settings-message"><ShieldCheck size={16} /><span>{success}</span></div>}
      {error && <div className="settings-error">{error}</div>}
      <div className="settings-section">
        <div className="settings-section-heading"><div><h3>Encerrar outras sessões</h3><p>Encerra as sessões abertas em outros dispositivos sem sair desta sessão.</p></div></div>
        <button type="button" className="primary-button" disabled={saving} onClick={() => setConfirming(true)}>{saving ? "Encerrando..." : "Encerrar outras sessões"}</button>
      </div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>E-mail</h3><p>Seu e-mail não é exibido a outros usuários.</p></div></div></div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>Outras opções</h3><p>Estas opções ainda não possuem funcionamento real no aplicativo.</p></div></div><div className="settings-coming-grid">{comingSoon.map(([title, description]) => <div className="settings-coming-item" key={title}><div><strong>{title}</strong><p>{description}</p></div><span>Em breve</span></div>)}</div></div>
      {confirming && <div className="settings-confirm-backdrop" role="presentation"><div className="settings-confirm-modal" role="dialog" aria-modal="true"><span className="settings-placeholder-label">CONFIRMAÇÃO</span><h3>Encerrar outras sessões?</h3><p>As sessões abertas em outros dispositivos serão encerradas. Esta sessão continuará ativa.</p><div className="settings-confirm-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setConfirming(false)}>Cancelar</button><button type="button" className="primary-button" disabled={saving} onClick={() => void endOtherSessions()}>{saving ? "Encerrando..." : "Confirmar"}</button></div></div></div>}
    </article>
  );
}
