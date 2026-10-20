import { Bell, Check } from "lucide-react";

type Props = {
  onOpenAppearance: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
};

export function NotificationsSettings({
  onOpenAppearance,
  soundEnabled,
  onToggleSound,
}: Props) {
  return (
    <article className="settings-card">
      <div className="settings-card-header">
        <div>
          <span className="settings-card-label">NOTIFICAÇÕES</span>
          <h2>Notificações</h2>
          <p>Escolha quais avisos locais o FC Arena deve mostrar.</p>
        </div>
        <Bell size={22} />
      </div>

      <div className="settings-section">
        <div className="grouped-list">
          <div className="settings-toggle-row">
            <div className="settings-toggle-content">
              <h3>Efeitos sonoros</h3>
              <p>Esta preferência é a mesma de Configurações &gt; Aparência.</p>
            </div>
            <button
              type="button"
              className={`settings-toggle ${soundEnabled ? "active" : ""}`}
              aria-pressed={soundEnabled}
              onClick={onToggleSound}
              aria-label="Alternar efeitos sonoros"
            >
              <span />
            </button>
          </div>

          <div className="grouped-list-row">
            <div>
              <strong>Personalização de sons</strong>
              <p>Abra Aparência para ajustar as demais preferências visuais.</p>
            </div>
            <button type="button" className="button--ghost" onClick={onOpenAppearance}>Abrir</button>
          </div>

          <div className="grouped-list-row">
            <div>
              <strong>E-mails de segurança</strong>
              <p>E-mails de segurança para troca de senha e de e-mail são sempre enviados.</p>
            </div>
            <span className="settings-status-badge info"><Check size={13} /> Sempre ativos</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h3>Outros avisos</h3>
            <p>Estes recursos ainda não possuem funcionamento real no aplicativo.</p>
          </div>
        </div>
        <div className="settings-coming-grid">
          {[
            ["Convites de sala", "Avisará quando alguém convidar você para uma sala."],
            ["Partida agendada", "Avisará quando houver uma partida agendada para você."],
            ["Resultado para confirmar", "Avisará quando um resultado depender da sua confirmação."],
            ["Campeonato iniciado ou finalizado", "Avisará sobre o início ou encerramento de um campeonato."],
            ["Novidades do FC Arena", "Avisará sobre novidades e atualizações do aplicativo."],
          ].map(([title, description]) => (
            <div className="settings-coming-item" key={title}>
              <div><strong>{title}</strong><p>{description}</p></div>
              <span>Em breve</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
