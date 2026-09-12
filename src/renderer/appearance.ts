const STORAGE = {
  theme: "arena-theme",
  compactSidebar: "arena-compact-sidebar",
  stats: "arena-visible-stats",
} as const;

const DEFAULT_STATS = ["best-form", "top-scorer", "goal-difference", "most-played", "trend", "champion"];
const STAT_LABELS: Record<string, string> = {
  "best-form": "Melhor forma",
  "top-scorer": "Artilheiro",
  "goal-difference": "Melhor saldo",
  "most-played": "Mais partidas",
  trend: "Tendência do ranking",
  champion: "Último campeão",
};

const readStats = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE.stats) ?? "null");
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) {
      return DEFAULT_STATS.filter((id) => parsed.includes(id));
    }
  } catch {
    // Use defaults for malformed local settings.
  }
  return [...DEFAULT_STATS];
};

const applyAppearance = () => {
  const root = document.documentElement;
  const body = document.body;
  const theme = localStorage.getItem(STORAGE.theme) === "light" ? "light" : "dark";
  const compact = localStorage.getItem(STORAGE.compactSidebar) === "true";
  const visible = new Set(readStats());

  root.dataset.arenaTheme = theme;
  body.classList.toggle("arena-light", theme === "light");
  body.classList.toggle("arena-compact-sidebar", compact);

  const selectors: Record<string, string> = {
    "best-form": ".stats-grid .stat-card:nth-child(1)",
    "top-scorer": ".stats-grid .stat-card:nth-child(2)",
    "goal-difference": ".stats-grid .stat-card:nth-child(3)",
    "most-played": ".stats-grid .stat-card:nth-child(4)",
    trend: ".stats-surface .stats-mini:nth-child(1)",
    champion: ".stats-surface .stats-mini:nth-child(2)",
  };

  Object.entries(selectors).forEach(([id, selector]) => {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.hidden = !visible.has(id);
    });
  });
};

const buildAppearanceCard = () => {
  const settings = document.querySelector<HTMLElement>(".settings-appearance");
  if (!settings || settings.querySelector(".appearance-preferences")) return;

  const card = document.createElement("article");
  card.className = "settings-card appearance-preferences";
  card.innerHTML = `
    <div class="appearance-preferences-head">
      <div class="appearance-icon">✦</div>
      <div>
        <h2>Preferências da interface</h2>
        <p>Personalize o tema, a navegação e os cards da Central de Estatísticas.</p>
      </div>
    </div>
    <div class="appearance-options">
      <label class="appearance-choice">
        <span><b>Tema claro</b><small>Usar uma interface clara.</small></span>
        <input type="checkbox" data-appearance="theme" />
      </label>
      <label class="appearance-choice">
        <span><b>Sidebar compacta</b><small>Reduzir a navegação lateral no desktop.</small></span>
        <input type="checkbox" data-appearance="compact" />
      </label>
    </div>
    <div class="appearance-stats">
      <div class="appearance-stats-title">
        <b>Cards da Central</b>
        <small>Escolha quais indicadores aparecem no Dashboard.</small>
      </div>
      <div class="appearance-stat-list"></div>
    </div>
  `;

  const statsList = card.querySelector<HTMLElement>(".appearance-stat-list")!;
  DEFAULT_STATS.forEach((id) => {
    const label = document.createElement("label");
    label.className = "appearance-choice compact-choice";
    label.innerHTML = `<span>${STAT_LABELS[id]}</span><input type="checkbox" data-stat="${id}" />`;
    statsList.appendChild(label);
  });

  settings.appendChild(card);

  const themeInput = card.querySelector<HTMLInputElement>('[data-appearance="theme"]')!;
  const compactInput = card.querySelector<HTMLInputElement>('[data-appearance="compact"]')!;
  themeInput.checked = localStorage.getItem(STORAGE.theme) === "light";
  compactInput.checked = localStorage.getItem(STORAGE.compactSidebar) === "true";
  card.querySelectorAll<HTMLInputElement>("[data-stat]").forEach((input) => {
    input.checked = readStats().includes(input.dataset.stat ?? "");
  });
};

const handleClick = (event: Event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.dataset.appearance === "theme") {
    localStorage.setItem(STORAGE.theme, target.checked ? "light" : "dark");
    applyAppearance();
  }

  if (target.dataset.appearance === "compact") {
    localStorage.setItem(STORAGE.compactSidebar, String(target.checked));
    applyAppearance();
  }

  if (target.dataset.stat) {
    const next = new Set(readStats());
    if (target.checked) next.add(target.dataset.stat);
    else next.delete(target.dataset.stat);
    localStorage.setItem(STORAGE.stats, JSON.stringify(DEFAULT_STATS.filter((id) => next.has(id))));
    applyAppearance();
  }
};

let championshipActionRequest = 0;
let activeChampionshipId: number | null = null;
let activeChampionshipName = "";

const closeChampionshipEditor = () => {
  document.querySelector<HTMLElement>(".championship-edit-backdrop")?.remove();
};

const openChampionshipEditor = (id: number, name: string) => {
  closeChampionshipEditor();
  const backdrop = document.createElement("div");
  backdrop.className = "championship-edit-backdrop";
  backdrop.innerHTML = `
    <div class="championship-edit-modal" role="dialog" aria-modal="true" aria-labelledby="championship-edit-title">
      <div class="championship-edit-head">
        <div>
          <span class="eyebrow">EDITAR CAMPEONATO</span>
          <h2 id="championship-edit-title">Nome da temporada</h2>
        </div>
        <button type="button" class="championship-edit-close" aria-label="Fechar">×</button>
      </div>
      <label class="championship-edit-field">
        <span>Nome</span>
        <input type="text" maxlength="80" value="" autocomplete="off" />
      </label>
      <p class="championship-edit-error" role="alert" hidden></p>
      <div class="championship-edit-actions">
        <button type="button" class="championship-edit-cancel">Cancelar</button>
        <button type="button" class="championship-edit-save">Salvar alterações</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const input = backdrop.querySelector<HTMLInputElement>("input")!;
  const error = backdrop.querySelector<HTMLElement>(".championship-edit-error")!;
  input.value = name;
  input.focus();
  input.select();

  const close = () => backdrop.remove();
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector(".championship-edit-close")?.addEventListener("click", close);
  backdrop.querySelector(".championship-edit-cancel")?.addEventListener("click", close);
  backdrop.querySelector(".championship-edit-save")?.addEventListener("click", async () => {
    const nextName = input.value.trim();
    if (!nextName) {
      error.textContent = "Informe um nome para o campeonato.";
      error.hidden = false;
      input.focus();
      return;
    }
    const save = backdrop.querySelector<HTMLButtonElement>(".championship-edit-save")!;
    save.disabled = true;
    save.textContent = "Salvando...";
    error.hidden = true;
    try {
      await window.arena.updateChampionship(id, nextName);
      close();
      window.location.reload();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : "Não foi possível salvar o campeonato.";
      error.hidden = false;
      save.disabled = false;
      save.textContent = "Salvar alterações";
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      backdrop.querySelector<HTMLButtonElement>(".championship-edit-save")?.click();
    }
    if (event.key === "Escape") close();
  });
};

const buildChampionshipActions = async () => {
  const gallery = document.querySelector<HTMLElement>(".season-gallery");
  if (!gallery) return;
  const cards = Array.from(gallery.querySelectorAll<HTMLElement>(".season-card"));
  if (!cards.length || gallery.querySelector(".championship-actions-floating")) return;

  const request = ++championshipActionRequest;
  let championships;
  try {
    championships = await window.arena.championships();
  } catch {
    return;
  }
  if (request !== championshipActionRequest || !document.body.contains(gallery)) return;

  const floating = document.createElement("div");
  floating.className = "championship-actions-floating";
  floating.hidden = true;
  floating.innerHTML = `
    <button type="button" data-action="edit" title="Editar campeonato"><span>Editar</span></button>
    <button type="button" data-action="delete" title="Excluir campeonato"><span>Excluir</span></button>
  `;
  document.body.appendChild(floating);

  let currentIndex = -1;
  const showFor = (index: number) => {
    currentIndex = index;
    const card = cards[index];
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const top = Math.max(12, Math.min(window.innerHeight - 64, rect.bottom - 50));
    floating.style.top = `${top}px`;
    floating.style.left = `${Math.max(12, Math.min(window.innerWidth - 210, rect.right - 204))}px`;
    floating.hidden = false;
  };

  cards.forEach((card, index) => {
    card.addEventListener("mouseenter", () => showFor(index));
    card.addEventListener("focus", () => showFor(index));
  });

  floating.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
    const championship = championships[currentIndex];
    if (championship) {
      activeChampionshipId = championship.id;
      activeChampionshipName = championship.name;
      openChampionshipEditor(championship.id, championship.name);
    }
  });

  floating.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
    const championship = championships[currentIndex];
    if (!championship) return;
    const confirmed = window.confirm(
      `Excluir definitivamente “${championship.name}”? Todas as partidas e confrontos desse campeonato serão removidos.`,
    );
    if (!confirmed) return;
    try {
      await window.arena.deleteChampionship(championship.id);
      window.location.reload();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Não foi possível excluir o campeonato.");
    }
  });

  window.addEventListener("scroll", () => {
    if (currentIndex >= 0 && !floating.hidden) showFor(currentIndex);
  }, { passive: true });
  window.addEventListener("resize", () => {
    if (currentIndex >= 0 && !floating.hidden) showFor(currentIndex);
  });
};

const sync = () => {
  applyAppearance();
  buildAppearanceCard();
  void buildChampionshipActions();
};

document.addEventListener("change", handleClick);
const observer = new MutationObserver(sync);
observer.observe(document.body, { childList: true, subtree: true });

sync();
