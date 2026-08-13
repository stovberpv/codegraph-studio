/*
 * Toolbar wiring: search highlight, filter input, grouping mode, follow/lazy
 * toggles, reset/fit/isolate, expand/collapse all, and show-hidden. A tiny
 * CSP-safe reactive store keeps the toolbar `.active` chrome in sync.
 * Registers its listeners on import.
 */
import {
  canvas,
  filterEl,
  followModeEl,
  hideIsolatedEl,
  lazyModeEl,
  modeFilesEl,
  modeFoldersEl,
  searchEl,
  zenModeEl,
} from "./dom.js";
import { state, cam, nodes, markDirty } from "./state.js";
import { nodeVisible } from "./visibility.js";
import { applyFilter } from "./glob-filter.js";
import { applySaved, clearSaved, saveLayout } from "./persistence.js";
import { layout } from "./layout.js";
import { fit } from "./fit.js";
import { rebuildRenderEdges } from "./edges.js";
import { setAllExpanded, showAllHidden } from "./collapse.js";
import { runHeavy } from "./heavy.js";
import { t } from "./i18n.js";

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  state.highlight = new Set();
  state.highlightGroups = new Set();
  if (q) {
    let first = null;
    for (const n of nodes.values()) {
      if (!nodeVisible(n)) continue;
      if (n.name.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)) {
        state.highlight.add(n.id);
        if (n.group) state.highlightGroups.add(n.group);
        if (!first) first = n.group && !n.group.expanded ? n.group : n;
      }
    }
    if (first) centerOn(first);
  }
  markDirty();
});

if (filterEl) {
  filterEl.addEventListener("input", () => applyFilter());
}

/** Pan the camera so an entity's center is in the middle of the viewport. */
export function centerOn(ent) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  cam.x = cw / 2 - (ent.x + ent.w / 2) * cam.scale;
  cam.y = ch / 2 - (ent.y + ent.h / 2) * cam.scale;
}

// Tiny in-house reactive store for toolbar chrome — no framework, CSP-safe
// (no eval / new Function). Subscribers re-render whenever ui.notify() runs.
const ui = {
  _subs: [],
  subscribe(fn) {
    this._subs.push(fn);
    return fn;
  },
  notify() {
    for (const fn of this._subs) fn();
  },
};

/**
 * Reflects the current mode/follow/lazy state onto the toolbar buttons.
 * Why: keeps all toolbar `.active` wiring in one declarative place instead of
 * scattered classList toggles across the mode setters.
 */
function renderToolbar() {
  if (modeFilesEl) modeFilesEl.classList.toggle("active", state.layoutMode === "files");
  if (modeFoldersEl) modeFoldersEl.classList.toggle("active", state.layoutMode === "folder");
  if (followModeEl) followModeEl.classList.toggle("active", state.followMode);
  if (lazyModeEl) lazyModeEl.classList.toggle("active", state.lazyMode);
  if (hideIsolatedEl) hideIsolatedEl.classList.toggle("active", state.hideIsolated);
  if (zenModeEl) zenModeEl.classList.toggle("active", state.zenMode);
}
ui.subscribe(renderToolbar);

/** Reflect layoutMode on the files/folders toolbar buttons. */
export function syncModeButtons() {
  ui.notify();
}
/** Switch between files and folder layout modes and re-layout from scratch. */
export function setLayoutMode(mode) {
  if (mode !== "files" && mode !== "folder") return;
  if (state.layoutMode === mode) return;
  state.layoutMode = mode;
  syncModeButtons();
  clearSaved(); // fresh layout in the new mode
  layout();
  applyFilter();
  saveLayout();
  fit();
}
if (modeFilesEl) {
  modeFilesEl.addEventListener("click", () => {
    if (state.layoutMode !== "files") runHeavy(t("busy_mode_files"), () => setLayoutMode("files"));
  });
}
if (modeFoldersEl) {
  modeFoldersEl.addEventListener("click", () => {
    if (state.layoutMode !== "folder") runHeavy(t("busy_mode_folders"), () => setLayoutMode("folder"));
  });
}
syncModeButtons();

/** Enable/disable follow mode (mutually exclusive with lazy mode). */
export function setFollowMode(on) {
  state.followMode = !!on;
  state.followFocus = null;
  state.followSet = new Set();
  if (state.followMode && state.lazyMode) setLazyMode(false); // modes are mutually exclusive
  ui.notify();
  rebuildRenderEdges();
  markDirty();
}
/** Enable/disable lazy-watch mode (mutually exclusive with follow mode). */
export function setLazyMode(on) {
  state.lazyMode = !!on;
  state.lazyFocus = null;
  if (state.lazyMode && state.followMode) setFollowMode(false); // modes are mutually exclusive
  ui.notify();
  rebuildRenderEdges();
  markDirty();
}
if (followModeEl) {
  followModeEl.addEventListener("click", () => runHeavy(t("busy_links"), () => setFollowMode(!state.followMode)));
}
if (lazyModeEl) {
  lazyModeEl.addEventListener("click", () => runHeavy(t("busy_links"), () => setLazyMode(!state.lazyMode)));
}

/** Toggle Zen mode: only edited files keep their color, the rest go gray. */
export function setZenMode(on) {
  state.zenMode = !!on;
  ui.notify();
  markDirty(); // recolor only — no relayout needed
}
if (zenModeEl) {
  zenModeEl.addEventListener("click", () => setZenMode(!state.zenMode));
}

document.getElementById("relayout").addEventListener("click", () => {
  runHeavy(t("busy_reset_layout"), () => {
    clearSaved();
    layout();
    applyFilter();
    fit();
  });
});
document.getElementById("fit").addEventListener("click", fit);
if (hideIsolatedEl) {
  hideIsolatedEl.addEventListener("click", () => {
    runHeavy(t("busy_isolated"), () => {
      state.hideIsolated = !state.hideIsolated;
      ui.notify();
      layout();
      applySaved();
      applyFilter();
      fit();
    });
  });
}
const expandAllEl = document.getElementById("expandAll");
const collapseAllEl = document.getElementById("collapseAll");
if (expandAllEl) expandAllEl.addEventListener("click", () => runHeavy(t("busy_expand_all"), () => setAllExpanded(true)));
if (collapseAllEl) collapseAllEl.addEventListener("click", () => runHeavy(t("busy_collapse_all"), () => setAllExpanded(false)));
const showHiddenEl = document.getElementById("showHidden");
if (showHiddenEl) showHiddenEl.addEventListener("click", () => runHeavy(t("busy_show_hidden"), showAllHidden));
