/*
 * Card sizing and the in-card editor toggle: derive a card's width/height from
 * its editing/expanded/collapsed state and react to editor open/close/resize.
 */
import { statsEl } from "./dom.js";
import { state, markDirty } from "./state.js";
import { COLLAPSED_H, COLLAPSED_W, EDIT_H, EDIT_MIN_H, EDIT_MIN_W, EDIT_W } from "./constants.js";
import { t } from "./i18n.js";
import { layoutInner, separateOverlapping } from "./layout.js";
import { rebuildRenderEdges } from "./edges.js";
import { saveLayout } from "./persistence.js";

/** Set a card's w/h from editing, expanded, or collapsed size. */
export function applySize(g) {
  if (g.editing) {
    g.w = g.editW || EDIT_W;
    g.h = g.editH || EDIT_H;
  } else if (g.expanded) {
    g.w = g.expandedW;
    g.h = g.expandedH;
  } else {
    g.w = COLLAPSED_W;
    g.h = COLLAPSED_H;
  }
}

/** Toggle the in-card editor when available; otherwise show a status hint. */
export function openEditor(g) {
  if (!g) return;
  if (window.__cgEditor && typeof window.__cgEditor.toggle === "function") {
    // editor takes the card body — hide the function list
    if (!g.editing) g.expanded = false;
    window.__cgEditor.toggle(g);
    return;
  }
  // standalone / no editor.js
  statsEl.textContent = t("edit_only_vscode");
}

/** React to editor open/close: resize card, push neighbors apart, refresh edges. */
export function onEditingChange(g) {
  if (!g) return;
  applySize(g);
  // Leaving edit mode shrinks the card back to its expanded width; re-flow the
  // function rows so their pills track the card and never overflow it.
  if (g.expanded) layoutInner(g);
  // Keep this card's top-left; neighbors move (same as expand).
  separateOverlapping(state.groups, 60, new Set([g]));
  rebuildRenderEdges();
  saveLayout();
  markDirty();
}

/**
 * Set the edit-mode size of a card from the overlay's resize grip.
 * `w`/`h` are world-space; clamped to the minimums. Live drag only updates
 * geometry (edges reattach on the next paint). On `commit`, neighbors are
 * pushed apart (`COLLIDE_GAP`) and the size is persisted.
 */
export function setEditorSize(g, w, h, commit) {
  if (!g || !g.editing) return;
  g.editW = Math.max(EDIT_MIN_W, Math.round(w));
  g.editH = Math.max(EDIT_MIN_H, Math.round(h));
  applySize(g);
  g.cx = g.x + g.w / 2;
  g.cy = g.y + g.h / 2;
  markDirty();
  if (commit) {
    separateOverlapping(state.groups, 60, new Set([g]));
    saveLayout();
  }
}
