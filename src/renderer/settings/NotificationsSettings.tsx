import { Bell, Check, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

type BackupFrequency = "7" | "30" | "never";
const STORAGE_FREQUENCY = "arena-backup-reminder-frequency";
const STORAGE_LAST = "arena-backup-reminder-last";
const frequencyLabels: Record<BackupFrequency, string> = {
  "7": "Toda semana",
  "30": "Todo mês",
  never: "Desativado",
};

function isReminderDue(frequency: BackupFrequency): boolean {
  if (frequency === "never") return false;
  const last = Number(localStorage.getItem(STORAGE_LAST) ?? 0);
  if (!last) return true;
  return Date.now() - last >= Number(frequency) * 24 * 60 * 60 * 1000;
}

export function NotificationsSettings({ onOpenAppearance }: { onOpenAppearance: () => void }) {
  const [frequency, setFrequency] = useState<BackupFrequency>(() => {
    const saved = localStorage.getItem(STORAGE_FREQUENCY);
    return saved === "7" || saved === "30" || saved === "never" ? saved : "30";
  });
  const [due, setDue] = useState(() => isReminderDue(frequency));

  useEffect(() => {
    localStorage.setItem(STORAGE_FREQUENCY, frequency);
    setDue(isReminderDue(frequency));
  }, [frequency]);

  const acknowledgeReminder = () => {
    localStorage.setItem(STORAGE_LAST, String(Date.now()));
    setDue(false);
  };

  const soundEnabled = localStorage.getItem("arena-muted") !== "true";

  return (
    <article className="settings-card">
      <div className="settings-card-header">
        <div><span className="settings-card-label">APLICATIVO</span><h2>Notificações</h2><p>Escolha quais avisos locais o FC Arena deve mostrar.</p></div>
        <Bell size={22} />
      </div>
      {due && <div className="settings-backup-warning" role="status"><div><strong>Está na hora de lembrar do backup.</strong><p>Revise seus dados e faça um backup pelos recursos disponíveis no aplicativo.</p></div><button type="button" className="secondary-button" onClick={acknowledgeReminder}>Lembrar depois</button></div>}
      <div className="settings-section">
        <div className="settings-section-heading"><div><h3>Efeitos sonoros</h3><p>Esta preferência é a mesma de Configurações &gt; Aparência. Não há uma segunda configuração.</p></div><span className={"settings-status-badge " + (soundEnabled ? "enabled" : "disabled")}><Volume2 size={13} />{soundEnabled ? "Ativados" : "Desativados"}</span></div>
        <button type="button" className="secondary-button settings-link-button" onClick={onOpenAppearance}>Configurar em Aparência</button>
      </div>
      <div className="settings-section">
        <div className="settings-section-heading"><div><h3>Lembrete de backup</h3><p>Mostra um aviso dentro do app quando o período escolhido vencer.</p></div></div>
        <label className="settings-select-label">Frequência<select value={frequency} onChange={(event) => setFrequency(event.target.value as BackupFrequency)}>{(Object.keys(frequencyLabels) as BackupFrequency[]).map((value) => <option key={value} value={value}>{frequencyLabels[value]}</option>)}</select></label>
        {frequency !== "never" && <p className="settings-local-note">{due ? "O lembrete está vencido e foi mostrado acima." : "O próximo lembrete será calculado localmente a partir deste momento."}</p>}
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
