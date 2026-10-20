export function DesignGallery() {
  return (
    <section className="page design-gallery" aria-labelledby="design-gallery-title">
      <header className="page-header">
        <div>
          <span className="eyebrow">DESENVOLVIMENTO</span>
          <h1 id="design-gallery-title">Galeria de componentes</h1>
          <p>Referência local para os estados visuais compartilhados.</p>
        </div>
      </header>

      <div className="design-gallery-grid">
        <article className="card design-gallery-card">
          <h2>Botões</h2>
          <div className="design-gallery-row">
            <button type="button" className="button button--primary">Primário</button>
            <button type="button" className="button--secondary">Secundário</button>
            <button type="button" className="button--ghost">Fantasma</button>
            <button type="button" className="button--danger">Destrutivo</button>
            <button type="button" className="button--icon" aria-label="Ação de ícone">+</button>
            <button type="button" className="button button--primary" disabled>Desabilitado</button>
            <button type="button" className="button button--primary is-loading">Carregando...</button>
          </div>
        </article>

        <article className="card design-gallery-card">
          <h2>Campos</h2>
          <label className="design-gallery-field">
            <span className="field-label">Campo com dica</span>
            <input placeholder="Digite algo" />
            <small className="field-hint">Texto auxiliar da ação.</small>
          </label>
          <label className="design-gallery-field">
            <span className="field-label">Seleção</span>
            <select defaultValue="normal"><option value="normal">Normal</option><option>Alternativa</option></select>
          </label>
          <label className="design-gallery-field">
            <span className="field-label">Campo com erro</span>
            <textarea placeholder="Descrição" />
            <small className="field-error">Confira este valor antes de continuar.</small>
          </label>
        </article>

        <article className="card design-gallery-card">
          <h2>Seleção</h2>
          <div className="design-gallery-row">
            <button type="button" className="switch" aria-label="Switch desligado" />
            <button type="button" className="switch is-active" aria-label="Switch ligado" />
            <span className="badge">Selo</span>
            <span className="badge">Em breve</span>
          </div>
          <div className="segmented-control" aria-label="Controle segmentado">
            <button type="button" className="button--ghost" aria-pressed="true">Lista</button>
            <button type="button" className="button--ghost" aria-pressed="false">Grade</button>
          </div>
        </article>

        <article className="card design-gallery-card">
          <h2>Lista agrupada</h2>
          <div className="grouped-list">
            <div className="grouped-list-row"><div><strong>Título da configuração</strong><p>Descrição curta da preferência.</p></div><button type="button" className="switch is-active" aria-label="Ativado" /></div>
            <div className="grouped-list-row"><div><strong>Recurso futuro</strong><p>Ainda não está disponível.</p></div><span className="badge">Em breve</span></div>
          </div>
        </article>

        <article className="card design-gallery-card">
          <h2>Feedback e avatar</h2>
          <div className="message">Ação concluída com sucesso.</div>
          <div className="message message--error">Não foi possível concluir a ação.</div>
          <div className="design-gallery-row"><span className="avatar design-gallery-avatar">FA</span><span className="avatar design-gallery-avatar">AR</span></div>
        </article>
      </div>
    </section>
  );
}
