// Theme engine: every color is a CSS variable. Two looks (frosted glass / minimal),
// light or dark, preset palettes, and any color can be changed with a picker.

export const PRESETS = {
  aurora: {
    name: "Midnight aurora",
    dark: { bg: "#0B1020", bg2: "#121935", panel: "#1A2140", text: "#F1F3FF", dim: "#8C95BF", faint: "#5E6690", accent: "#7C5CFF", accent2: "#22D3EE", good: "#34D399", bad: "#F87171", warn: "#FBBF24", glow1: "#7C5CFF", glow2: "#22D3EE", glow3: "#34D399" },
    light: { bg: "#EEF0FB", bg2: "#FFFFFF", panel: "#FFFFFF", text: "#161A33", dim: "#5A6190", faint: "#9AA0C3", accent: "#6A48F5", accent2: "#0EA5C6", good: "#0F9F6E", bad: "#DC4B4B", warn: "#C98A06", glow1: "#9B85FF", glow2: "#67E3F5", glow3: "#7EE8C0" },
  },
  ember: {
    name: "Ember",
    dark: { bg: "#140E0B", bg2: "#22170F", panel: "#2A1D16", text: "#FFF4EC", dim: "#B39886", faint: "#7D685A", accent: "#FF8A3D", accent2: "#F43F5E", good: "#A3E635", bad: "#FB7185", warn: "#FBBF24", glow1: "#FF8A3D", glow2: "#F43F5E", glow3: "#F59E0B" },
    light: { bg: "#FBF3EC", bg2: "#FFFFFF", panel: "#FFFFFF", text: "#2A1609", dim: "#8A6A55", faint: "#C0A592", accent: "#E8681A", accent2: "#E11D48", good: "#4D8A12", bad: "#D63A55", warn: "#B7791F", glow1: "#FFB37D", glow2: "#FDA4AF", glow3: "#FCD34D" },
  },
  forest: {
    name: "Deep forest",
    dark: { bg: "#08130F", bg2: "#0F1F18", panel: "#13261E", text: "#EEFAF4", dim: "#86A99A", faint: "#587567", accent: "#3DDC97", accent2: "#E3B341", good: "#5EEAD4", bad: "#F59E8B", warn: "#E3B341", glow1: "#3DDC97", glow2: "#E3B341", glow3: "#5EEAD4" },
    light: { bg: "#EEF6F1", bg2: "#FFFFFF", panel: "#FFFFFF", text: "#0E2A1E", dim: "#4E7363", faint: "#93B3A4", accent: "#12A06A", accent2: "#B7861F", good: "#0F8F78", bad: "#D0583F", warn: "#B7861F", glow1: "#8BE8BF", glow2: "#F2D58A", glow3: "#9BEFE3" },
  },
  arctic: {
    name: "Arctic glass",
    dark: { bg: "#0A1418", bg2: "#10202A", panel: "#16262E", text: "#F2FAFF", dim: "#8AA6B3", faint: "#5C7682", accent: "#5EC8FF", accent2: "#C4B5FD", good: "#6EE7B7", bad: "#FCA5A5", warn: "#FCD34D", glow1: "#5EC8FF", glow2: "#C4B5FD", glow3: "#6EE7B7" },
    light: { bg: "#EDF5FA", bg2: "#FFFFFF", panel: "#FFFFFF", text: "#0D2330", dim: "#55707E", faint: "#9FB5C0", accent: "#1A95D8", accent2: "#7C5CE0", good: "#0F9B6E", bad: "#D44848", warn: "#B88207", glow1: "#9ED9FF", glow2: "#D9CEFF", glow3: "#A7F0D2" },
  },
};

// Minimal ("Apple") neutrals; accents come from the chosen palette.
const MINIMAL = {
  dark: { bg: "#000000", bg2: "#1C1C1E", panel: "#1C1C1E", text: "#F5F5F7", dim: "#98989F", faint: "#636366" },
  light: { bg: "#F5F5F7", bg2: "#FFFFFF", panel: "#FFFFFF", text: "#1D1D1F", dim: "#6E6E73", faint: "#AEAEB2" },
};

export const COLOR_KEYS = [
  ["bg", "Background"], ["panel", "Cards"], ["text", "Text"], ["dim", "Quiet text"], ["accent", "Accent"],
  ["accent2", "Second accent"], ["good", "Money in / good"], ["bad", "Overspent / problems"], ["warn", "Heads-up"],
  ["glow1", "Glow 1"], ["glow2", "Glow 2"], ["glow3", "Glow 3"],
];

export const DEFAULT_THEME = {
  preset: "aurora", style: "glass", mode: "dark", custom: {},
  roundness: 14, frost: 18, opacity: 55, glow: 55, motionAmt: 100, textSize: 100,
  density: "comfortable", motion: "full",
};

export function normalize(t) {
  const out = { ...DEFAULT_THEME, ...(t || {}) };
  if (!PRESETS[out.preset]) out.preset = "aurora";
  out.custom = out.custom || {};
  return out;
}

export function palette(t) {
  const p = PRESETS[t.preset] || PRESETS.aurora;
  const base = { ...p[t.mode] };
  if (t.style === "minimal") Object.assign(base, MINIMAL[t.mode]);
  return { ...base, ...(t.custom[`${t.style}-${t.mode}`] || {}) };
}

const hexToRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  if (!m) return "26, 33, 64";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
const luminance = (h) => {
  const [r, g, b] = hexToRgb(h).split(",").map((x) => Number(x) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function apply(theme, { glide = true } = {}) {
  const t = normalize(theme);
  const c = palette(t);
  const root = document.documentElement;
  if (glide && t.motion !== "reduced") {
    root.style.transition = "none";
    document.body.style.transition = "background-color .6s, color .6s";
  }
  const minimal = t.style === "minimal";
  const vars = {
    "--bg": c.bg, "--bg2": c.bg2, "--panel": hexToRgb(c.panel), "--text": c.text, "--dim": c.dim, "--faint": c.faint,
    "--accent": c.accent, "--accent2": c.accent2, "--good": c.good, "--bad": c.bad, "--warn": c.warn,
    "--glow1": c.glow1, "--glow2": c.glow2, "--glow3": c.glow3,
    "--on-accent": luminance(c.accent) > 0.45 ? "#0B0F1A" : "#FFFFFF",
    "--line": t.mode === "light" ? "rgba(20,25,60,.10)" : "rgba(255,255,255,.09)",
    "--radius": `${t.roundness}px`,
    "--blur": minimal ? "0px" : `${t.frost}px`,
    "--panel-alpha": minimal ? "1" : String(t.opacity / 100),
    "--glow": minimal ? "0" : String(t.glow / 100),
    "--motion": t.motion === "reduced" ? "0.0001" : String(Math.max(0.05, t.motionAmt / 100)),
    "--scale": String(t.textSize / 100),
    "--shadow": t.mode === "light" ? "0 10px 30px rgba(30,40,90,.10), 0 1px 0 rgba(255,255,255,.6) inset" : "0 10px 30px rgba(0,0,0,.28), 0 1px 0 rgba(255,255,255,.04) inset",
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.mode = t.mode;
  root.dataset.style = t.style;
  root.dataset.density = t.density;
  root.dataset.motion = t.motion;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = c.bg;
  return t;
}

export function toText(t) {
  return "HOMEBANK-THEME:" + btoa(unescape(encodeURIComponent(JSON.stringify(normalize(t)))));
}
export function fromText(s) {
  s = String(s || "").trim();
  const raw = s.startsWith("HOMEBANK-THEME:") ? decodeURIComponent(escape(atob(s.slice(15)))) : s;
  const t = JSON.parse(raw);
  if (typeof t !== "object" || !t) throw new Error("That isn't a Home Bank theme.");
  return normalize(t);
}
