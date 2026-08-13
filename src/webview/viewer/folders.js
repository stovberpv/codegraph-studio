/*
 * Folder entities and their geometry: build folder cards from the current file
 * groups (preserving state by key), and compute island / collapsed-card boxes.
 */
import { state } from "./state.js";
import { FOLDER_CARD_H, FOLDER_CARD_W, FOLDER_HEAD, FOLDER_PAD } from "./constants.js";
import { basename, hashHue } from "./utils.js";
import { groupVisible } from "./visibility.js";

// Build folder entities from current groups (preserving state by key).
/** Build folder entities from current groups, preserving prior state by key. */
export function buildFolders() {
  const prev = state.folderByKey;
  state.folders = [];
  state.folderByKey = new Map();
  const byKey = new Map();
  for (const g of state.groups) {
    if (!byKey.has(g.folder)) byKey.set(g.folder, []);
    byKey.get(g.folder).push(g);
  }
  for (const [key, files] of byKey) {
    const old = prev.get(key);
    const f = {
      key,
      files,
      hue: hashHue(key),
      name: key === "." ? "/" : basename(key),
      collapsed: old ? old.collapsed : false,
      hidden: old ? old.hidden : false,
      hideIncoming: old ? old.hideIncoming : false,
      hideOutgoing: old ? old.hideOutgoing : false,
      cardX: old ? old.cardX : 0,
      cardY: old ? old.cardY : 0,
      cardPlaced: old ? old.cardPlaced : false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
    state.folders.push(f);
    state.folderByKey.set(key, f);
  }
}
/** Folder entity for a group in folder layout mode (else null). */
export const folderOf = (g) => (state.layoutMode === "folder" ? state.folderByKey.get(g.folder) : null);

// Geometric bbox of files in a folder (to center the card on collapse);
// visibleOnly=true — only actually drawn files (for the island backdrop,
// so follow mode does not draw empty islands around hidden files).
/** Axis-aligned bbox of a folder's files (optionally only visible ones). */
export function filesBBox(f, visibleOnly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const g of f.files) {
    if (visibleOnly ? !groupVisible(g) : g.filteredOut || g.hidden) continue;
    any = true;
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w);
    maxY = Math.max(maxY, g.y + g.h);
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

// Recompute folder geometry: island with header (expanded) or
// compact card (collapsed). Cheap — call before draw/hit-test.
/** Recompute folder island/card geometry before draw or hit-testing. */
export function ensureFolderBoxes() {
  if (state.layoutMode !== "folder") return;
  for (const f of state.folders) {
    if (f.hidden) {
      f.w = f.h = 0;
      continue;
    }
    if (f.collapsed) {
      if (!f.cardPlaced) {
        const b = filesBBox(f);
        f.cardX = (b ? (b.minX + b.maxX) / 2 : 0) - FOLDER_CARD_W / 2;
        f.cardY = (b ? (b.minY + b.maxY) / 2 : 0) - FOLDER_CARD_H / 2;
        f.cardPlaced = true;
      }
      f.x = f.cardX;
      f.y = f.cardY;
      f.w = FOLDER_CARD_W;
      f.h = FOLDER_CARD_H;
    } else {
      const b = filesBBox(f, true); // island — only from visible files
      if (!b) {
        f.w = f.h = 0;
        continue;
      }
      f.x = b.minX - FOLDER_PAD;
      f.y = b.minY - FOLDER_PAD - FOLDER_HEAD;
      f.w = b.maxX - b.minX + FOLDER_PAD * 2;
      f.h = b.maxY - b.minY + FOLDER_PAD * 2 + FOLDER_HEAD;
    }
  }
}
