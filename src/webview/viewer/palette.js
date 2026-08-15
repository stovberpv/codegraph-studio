/*
 * Named colors for chrome (CSS `--cg-*`) and the canvas painter.
 * Keep in lockstep with `:root` in `styles.css` and `docs/UI_TOKENS.md`.
 */

export const pal = {
  bg: "#0e1116",
  surface2: "rgba(17, 21, 28, 0.72)",
  surfacePop: "rgba(17, 21, 28, 0.94)",
  surface3: "rgba(17, 21, 28, 0.66)",
  surfaceToast: "rgba(17, 21, 28, 0.92)",
  surfaceSolid: "#1b222b",
  surfaceHover: "#232c37",
  surfaceGroup: "#12171e",
  surfaceAccent: "#243552",
  editorBg: "#161b22",
  tooltipBg: "rgba(20, 24, 31, 0.97)",
  overlay: "rgba(14, 17, 22, 0.35)",
  overlayStrong: "rgba(14, 17, 22, 0.55)",

  border: "#232a33",
  borderStrong: "#2b333d",
  borderSep: "#262e39",
  borderHover: "#3a4552",

  text: "#e6edf3",
  text2: "#cdd7e1",
  textMuted: "#9aa7b4",
  textDim: "#8b97a4",
  textDimmer: "#7d8b9a",
  textFaint: "#6b7684",
  placeholder: "#4d5763",
  icon: "#5b6672",
  textDimDeep: "#454e58",

  accent: "#3d7de6",
  accentStrong: "#2f6fe0",
  accentHover: "#5aa0ff",
  accentSoft: "#9ec0ff",
  accentGlow: "rgba(61, 125, 230, 0.6)",
  accentRing: "rgba(61, 125, 230, 0.18)",
  accentWash: "rgba(90, 160, 255, 0.18)",
  brandPurple: "#8b5cf6",
  onAccent: "#ffffff",

  statusDirty: "#e0a83d",
  statusOk: "#3fb950",
  statusError: "#f85149",
  editedDot: "#5ac47d",

  fnHover: "#2a3546",
  fnMatch: "#3a2f12",
  fnBg: "#1c232c",
  fnBgDim: "#171b21",

  edgeImport: "#4094a8",
  edgeImportHot: "#46bec8",

  shadow: "rgba(0, 0, 0, 0.35)",
  shadowMid: "rgba(0, 0, 0, 0.45)",
  shadowStrong: "rgba(0, 0, 0, 0.5)",
};

const lerp = (a, b, t) => a + (b - a) * t;

/** `hex` `#rrggbb` plus alpha → `rgba(...)`. */
export function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function mixHex(a, b, t) {
  const an = parseInt(a.slice(1), 16);
  const bn = parseInt(b.slice(1), 16);
  const r = Math.round(lerp(an >> 16, bn >> 16, t));
  const g = Math.round(lerp((an >> 8) & 255, (bn >> 8) & 255, t));
  const bl = Math.round(lerp(an & 255, bn & 255, t));
  return `rgb(${r},${g},${bl})`;
}

export const edgeAlpha = {
  call: [0.32, 0.12],
  import: [0.26, 0.1],
  bundleCall: [0.28, 0.1],
  bundleImport: [0.22, 0.08],
  hotCall: 0.9,
  hotImport: 0.85,
  arrow: 0.95,
  marqueeFill: 0.1,
  marqueeStroke: 0.85,
};
