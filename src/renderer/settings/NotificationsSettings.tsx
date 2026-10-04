import { Bell, Check, Volume2 } from "lucide-react";
export function NotificationsSettings({ onOpenAppearance }: { onOpenAppearance: () => void }) {
  const soundEnabled = localStorage.getItem("arena-muted") !== "true";

  return (
    <article className="settings-card">
      <div className="settings-card-header">
        <div><span className="settings-card-label">PRIVACIDADE</span><h2>Notificações</h2><p>Escolha quais avisos locais o FC Arena deve mostrar.</p></div>
        <Bell size={22} />
      </div>
      <div className="settings-section">
        <div className="settings-section-heading"><div><h3>Efeitos sonoros</h3><p>Esta preferência é a mesma de Configurações &gt; Aparência. Não há uma segunda configuração.</p></div><span className={"settings-status-badge " + (soundEnabled ? "enabled" : "disabled")}><Volume2 size={13} />{soundEnabled ? "Ativados" : "Desativados"}</span></div>
        <button type="button" className="secondary-button settings-link-button" onClick={onOpenAppearance}>Configurar em Aparência</button>
      </div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>E-mails de segurança</h3><p>E-mails de segurança para troca de senha e de e-mail são sempre enviados.</p></div><span className="settings-status-badge info"><Check size={13} /> Sempre ativos</span></div></div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>Outros avisos</h3><p>Estes recursos ainda não possuem funcionamento real no aplicativo.</p></div></div>
        <div className="settings-coming-grid">
          {[["Convites de sala","Avisará quando alguém convidar você para uma sala."],["Partida agendada","Avisará quando houver uma partida agendada para você."],["Resultado para confirmar","Avisará quando um resultado depender da sua confirmação."],["Campeonato iniciado ou finalizado","Avisará sobre o início ou encerramento de um campeonato."],["Novidades do FC Arena","Avisará sobre novidades e atualizações do aplicativo."]].map(([title, description]) => <div className="settings-coming-item" key={title}><div><strong>{title}</strong><p>{description}</p></div><span>Em breve</span></div>)}
        </div>
      </div>
    </article>
  );
}
