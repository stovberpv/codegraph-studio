/*
 * Expand/collapse a card, dispatch file-card and folder toolbar actions, unhide
 * everything, and expand/collapse all cards at once.
 */
import { state, markDirty } from "./state.js";
import { applySize, openEditor } from "./sizing.js";
import { layoutInner, separateOverlapping } from "./layout.js";
import { rebuildRenderEdges } from "./edges.js";
import { saveLayout } from "./persistence.js";
import { setHover } from "./interaction.js";
import { fit } from "./fit.js";

/** Expand/collapse a file card, reflow neighbors, and persist layout. */
export function toggleExpand(g) {
  g.expanded = !g.expanded;
  const kx = g.x, ky = g.y; // keep the top-left corner fixed
  applySize(g);
  g.x = kx;
  g.y = ky;
  if (g.expanded) layoutInner(g);

  // push neighbors apart (do not move the expanded card)
  separateOverlapping(state.groups, 60, new Set([g]));

  rebuildRenderEdges();
  saveLayout();
  markDirty();
}

// Run a file-card control action.
/** Dispatch a file-card toolbar action (expand, edit, pin, hide, edge toggles). */
export function runControl(g, action) {
  if (action === "toggle") {
    toggleExpand(g);
    return;
  }
  if (action === "edit") {
    openEditor(g);
    return;
  }
  if (action === "pin") {
    g.pinned = !g.pinned;
  } else if (action === "hideFile") {
    g.hidden = true;
    if (g.editing && window.__cgEditor) window.__cgEditor.close(g.path);
    if (state.hoverEntity === g) setHover(null);
  } else if (action === "hideIncoming") {
    g.hideIncoming = !g.hideIncoming;
  } else if (action === "hideOutgoing") {
    g.hideOutgoing = !g.hideOutgoing;
  }
  rebuildRenderEdges();
  saveLayout();
  markDirty();
}

// Run a folder control action.
/** Dispatch a folder toolbar action (collapse, hide, edge toggles). */
export function runFolderControl(f, action) {
  if (action === "toggle") {
    f.collapsed = !f.collapsed;
    if (f.collapsed) f.cardPlaced = false; // re-center the card on the current files
  } else if (action === "hideFolder") {
    f.hidden = true;
    if (state.hoverEntity === f) setHover(null);
  } else if (action === "hideIncoming") {
    f.hideIncoming = !f.hideIncoming;
  } else if (action === "hideOutgoing") {
    f.hideOutgoing = !f.hideOutgoing;
  }
  rebuildRenderEdges();
  saveLayout();
  markDirty();
}

/** Unhide all manually hidden files/folders and clear edge hide toggles. */
export function showAllHidden() {
  for (const g of state.groups) {
    g.hidden = false;
    g.hideIncoming = false;
    g.hideOutgoing = false;
  }
  for (const f of state.folders) {
    f.hidden = false;
    f.hideIncoming = false;
    f.hideOutgoing = false;
  }
  rebuildRenderEdges();
  saveLayout();
  markDirty();
}

/** Expand or collapse every file card, resolve overlaps, and fit the view. */
export function setAllExpanded(v) {
  for (const g of state.groups) {
    const kx = g.x, ky = g.y;
    g.expanded = v;
    applySize(g);
    g.x = kx;
    g.y = ky;
    if (v) layoutInner(g);
  }
  separateOverlapping(state.groups, 220);
  rebuildRenderEdges();
  saveLayout();
  fit();
}
