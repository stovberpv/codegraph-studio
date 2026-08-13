/*
 * Lucide icon paths and the card/folder header control layout: hit rectangles,
 * per-action icon names, and localized control labels.
 */
import { ctx } from "./dom.js";
import { ACTIONS, BTN, CTRL_GAP, FOLDER_ACTIONS, FOLDER_HEAD, HEADER_H, ICON_PX } from "./constants.js";
import { t } from "./i18n.js";

// ---- Lucide icons (24×24, stroked) --------------------------------------
const ICON_D = {
  squarePen: [
    "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
    "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
  ],
  pin: [
    "M12 17v5",
    "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
  ],
  eyeOff: [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20",
  ],
  arrowRightToLine: ["M17 12H3", "m11 18 6-6-6-6", "M21 5v14"], // →| incoming
  arrowRightFromLine: ["M3 5v14", "M21 12H7", "m15 18 6-6-6-6"], // |→ outgoing
  chevronDown: ["m6 9 6 6 6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
};
const iconCache = new Map();
/** Cached Path2D list for a Lucide icon name. */
function iconPaths(name) {
  let ps = iconCache.get(name);
  if (!ps) {
    ps = ICON_D[name].map((d) => new Path2D(d));
    iconCache.set(name, ps);
  }
  return ps;
}
/** Stroke a Lucide icon centered in a control cell at world scale. */
export function drawIcon(name, cellX, cellY, color, active) {
  const s = ICON_PX / 24;
  ctx.save();
  ctx.translate(cellX + (BTN - ICON_PX) / 2, cellY + (BTN - ICON_PX) / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  // stroke width in icon units (viewBox 24) → scales with the world,
  // so when zoomed out the stroke thins instead of blobbing together
  ctx.lineWidth = active ? 2.4 : 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of iconPaths(name)) ctx.stroke(p);
  ctx.restore();
}

// control rectangles in the card header (right-aligned)
/** World-space hit rectangles for a file card's header controls. */
export function controlRects(g) {
  const groupW = ACTIONS.length * BTN + (ACTIONS.length - 1) * CTRL_GAP;
  const startX = g.x + g.w - 6 - groupW;
  const by = g.y + (HEADER_H - BTN) / 2;
  return ACTIONS.map((a, i) => ({ action: a, x: startX + i * (BTN + CTRL_GAP), y: by }));
}
/** Lucide icon name for a file-card control action (and expand state). */
export function iconFor(g, action) {
  if (action === "edit") return "squarePen";
  if (action === "pin") return "pin";
  if (action === "hideFile") return "eyeOff";
  if (action === "hideIncoming") return "arrowRightToLine";
  if (action === "hideOutgoing") return "arrowRightFromLine";
  return g.expanded ? "chevronUp" : "chevronDown";
}
export const CTRL_LABEL = {
  edit: (g) => (g.editing ? t("ctrl_edit_collapse") : t("ctrl_edit_open")),
  pin: (g) => (g.pinned ? t("ctrl_unpin") : t("ctrl_pin")),
  hideFile: () => t("ctrl_hide_file"),
  hideIncoming: (g) => (g.hideIncoming ? t("ctrl_show_incoming") : t("ctrl_hide_incoming")),
  hideOutgoing: (g) => (g.hideOutgoing ? t("ctrl_show_outgoing") : t("ctrl_hide_outgoing")),
  toggle: (g) => (g.expanded ? t("ctrl_collapse") : t("ctrl_expand")),
};

/** World-space hit rectangles for a folder header's controls. */
export function folderControlRects(f) {
  const groupW = FOLDER_ACTIONS.length * BTN + (FOLDER_ACTIONS.length - 1) * CTRL_GAP;
  const startX = f.x + f.w - 6 - groupW;
  const by = f.y + (FOLDER_HEAD - BTN) / 2;
  return FOLDER_ACTIONS.map((a, i) => ({ action: a, x: startX + i * (BTN + CTRL_GAP), y: by }));
}
/** Lucide icon name for a folder control action (and collapse state). */
export function folderIconFor(f, action) {
  if (action === "hideFolder") return "eyeOff";
  if (action === "hideIncoming") return "arrowRightToLine";
  if (action === "hideOutgoing") return "arrowRightFromLine";
  return f.collapsed ? "chevronDown" : "chevronUp";
}
export const FOLDER_CTRL_LABEL = {
  hideFolder: () => t("fctrl_hide_folder"),
  hideIncoming: (f) => (f.hideIncoming ? t("fctrl_show_incoming") : t("fctrl_hide_incoming")),
  hideOutgoing: (f) => (f.hideOutgoing ? t("fctrl_show_outgoing") : t("fctrl_hide_outgoing")),
  toggle: (f) => (f.collapsed ? t("fctrl_expand") : t("fctrl_collapse")),
};
