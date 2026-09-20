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

/*
 * As ações de editar/excluir campeonato que antes viviam aqui (DOM injetado
 * com window.confirm/alert/location.reload) foram migradas para a árvore
 * React em main.tsx (botões nos cards da galeria + ChampionshipNameModal +
 * AppModal de exclusão). Este arquivo agora cuida exclusivamente de tema,
 * sidebar compacta e visibilidade dos cards do dashboard.
 */

const sync = () => {
  applyAppearance();
  buildAppearanceCard();
};

document.addEventListener("change", handleClick);
const observer = new MutationObserver(sync);
observer.observe(document.body, { childList: true, subtree: true });

sync();