export type ArenaTheme = "dark" | "light";

export type ArenaPalette = {
  id:
    | "violeta-arena"
    | "gramado"
    | "ouro-campeao"
    | "azul-champions"
    | "fogo"
    | "ciano-neon"
    | "grafite"
    | "alto-contraste";
  name: string;
  description: string;
  dark: {
    accent: string;
    background: string;
    text: string;
  };
  light: {
    accent: string;
    background: string;
    text: string;
  };
};

export const DEFAULT_PALETTE_ID: ArenaPalette["id"] = "violeta-arena";

export const ARENA_PALETTES: ArenaPalette[] = [
  {
    id: "violeta-arena",
    name: "Violeta Arena",
    description: "A aparência padrão atual do FC Arena.",
    dark: { accent: "#8872ff", background: "#0a0f1f", text: "#f4f6ff" },
    light: { accent: "#6346d9", background: "#f5f7fc", text: "#182033" },
  },
  {
    id: "gramado",
    name: "Gramado",
    description: "Verde inspirado no campo.",
    dark: { accent: "#22c55e", background: "#07150d", text: "#f1fbf4" },
    light: { accent: "#15803d", background: "#f3faf5", text: "#12301d" },
  },
  {
    id: "ouro-campeao",
    name: "Ouro Campeão",
    description: "Destaque dourado para uma interface de competição.",
    dark: { accent: "#eab308", background: "#171205", text: "#fff9df" },
    light: { accent: "#a16207", background: "#fffaf0", text: "#332407" },
  },
  {
    id: "azul-champions",
    name: "Azul Champions",
    description: "Azul profundo com destaque de alta legibilidade.",
    dark: { accent: "#3b82f6", background: "#071326", text: "#f1f7ff" },
    light: { accent: "#1d4ed8", background: "#f2f7ff", text: "#14284b" },
  },
  {
    id: "fogo",
    name: "Fogo",
    description: "Tons quentes para uma aparência mais intensa.",
    dark: { accent: "#f97316", background: "#1a0b05", text: "#fff5ed" },
    light: { accent: "#c2410c", background: "#fff7f2", text: "#3a1708" },
  },
  {
    id: "ciano-neon",
    name: "Ciano Neon",
    description: "Ciano vibrante sobre fundo escuro.",
    dark: { accent: "#06b6d4", background: "#03151a", text: "#ecfeff" },
    light: { accent: "#0e7490", background: "#f0fbfd", text: "#12343b" },
  },
  {
    id: "grafite",
    name: "Grafite",
    description: "Neutro, discreto e com pouco destaque cromático.",
    dark: { accent: "#cbd5e1", background: "#11151b", text: "#f8fafc" },
    light: { accent: "#475569", background: "#f4f6f8", text: "#17202b" },
  },
  {
    id: "alto-contraste",
    name: "Alto contraste",
    description: "Contraste reforçado para facilitar a leitura.",
    dark: { accent: "#ffff00", background: "#000000", text: "#ffffff" },
    light: { accent: "#0000ee", background: "#ffffff", text: "#000000" },
  },
];

export const getArenaPalette = (id: ArenaPalette["id"]) =>
  ARENA_PALETTES.find((palette) => palette.id === id) ??
  ARENA_PALETTES.find((palette) => palette.id === DEFAULT_PALETTE_ID)!;

export const getArenaPaletteVariant = (
  palette: ArenaPalette,
  theme: ArenaTheme,
) => palette[theme];
