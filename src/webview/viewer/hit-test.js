/*
 * World-space hit-testing: header controls, function nodes, draggable cards,
 * the topmost entity, and folder controls / drag targets.
 */
import { state, cam, nodes } from "./state.js";
import { BTN, FOLDER_HEAD, HEADER_H, ICON_ZOOM } from "./constants.js";
import { controlRects, folderControlRects } from "./icons.js";
import { folderVisible, groupVisible, nodeVisible } from "./visibility.js";
import { ensureFolderBoxes } from "./folders.js";

/** Hit-test file-card header controls at a world point. */
export function controlAt(wx, wy) {
  if (cam.scale <= ICON_ZOOM) return null; // icons are hidden when zoomed out — do not hit-test them
  for (const g of state.groups) {
    if (!groupVisible(g) || g.editing) continue;
    // quick reject: controls only in the right part of the header
    if (wy < g.y || wy > g.y + HEADER_H || wx < g.x || wx > g.x + g.w) continue;
    for (const r of controlRects(g)) {
      if (wx >= r.x && wx <= r.x + BTN && wy >= r.y && wy <= r.y + BTN) return { g, action: r.action };
    }
  }
  return null;
}
/** Hit-test an expanded function node at a world point. */
export function nodeAt(wx, wy) {
  for (const n of nodes.values()) {
    if (!nodeVisible(n) || !n.group.expanded) continue;
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n;
  }
  return null;
}
/** Hit-test a draggable file card (header if expanded, whole if collapsed). */
export function groupDragAt(wx, wy) {
  for (const g of state.groups) {
    if (!groupVisible(g) || g.editing) continue;
    if (wx < g.x || wx > g.x + g.w) continue;
    if (g.expanded) {
      if (wy >= g.y && wy <= g.y + HEADER_H) return g;
    } else if (wy >= g.y && wy <= g.y + g.h) return g;
  }
  return null;
}
/** Topmost entity under a world point (node > file > folder). */
export function entityAt(wx, wy) {
  const n = nodeAt(wx, wy);
  if (n) return n;
  for (const g of state.groups) {
    if (!groupVisible(g)) continue;
    if (wx >= g.x && wx <= g.x + g.w && wy >= g.y && wy <= g.y + g.h) return g;
  }
  // folders rank below files: whole collapsed card, header-only when expanded
  if (state.layoutMode === "folder") {
    ensureFolderBoxes();
    for (const f of state.folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      if (wx < f.x || wx > f.x + f.w) continue;
      if (f.collapsed) {
        if (wy >= f.y && wy <= f.y + f.h) return f;
      } else if (wy >= f.y && wy <= f.y + FOLDER_HEAD) return f;
    }
  }
  return null;
}
/** Hit-test folder header controls at a world point. */
export function folderControlAt(wx, wy) {
  if (state.layoutMode !== "folder" || cam.scale <= ICON_ZOOM) return null;
  ensureFolderBoxes();
  for (const f of state.folders) {
    if (!folderVisible(f) || f.w <= 0) continue;
    if (wy < f.y || wy > f.y + FOLDER_HEAD || wx < f.x || wx > f.x + f.w) continue;
    for (const r of folderControlRects(f)) {
      if (wx >= r.x && wx <= r.x + BTN && wy >= r.y && wy <= r.y + BTN) return { g: f, action: r.action };
    }
  }
  return null;
}
/** Hit-test a folder drag target (whole card or header when expanded). */
export function folderHeaderAt(wx, wy) {
  if (state.layoutMode !== "folder") return null;
  ensureFolderBoxes();
  for (const f of state.folders) {
    if (!folderVisible(f) || f.w <= 0) continue;
    if (wx < f.x || wx > f.x + f.w) continue;
    if (f.collapsed) {
      if (wy >= f.y && wy <= f.y + f.h) return f;
    } else if (wy >= f.y && wy <= f.y + FOLDER_HEAD) return f;
  }
  return null;
}
