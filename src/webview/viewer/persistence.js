/*
 * Persist and restore per-root layout to localStorage: card/folder positions,
 * collapsed/hidden flags, edit sizes, grouping mode, and function offsets.
 */
import { state, nodes, markDirty } from "./state.js";
import { EDIT_H, EDIT_MIN_H, EDIT_MIN_W, EDIT_W } from "./constants.js";
import { applySize } from "./sizing.js";
import { layoutInner, separateOverlapping } from "./layout.js";

/** Persist card/folder positions and collapsed/hidden flags to localStorage. */
export function saveLayout() {
  const data = { v: 2, mode: state.layoutMode, nodes: {}, groups: {} };
  for (const n of nodes.values()) {
    if (!n.group) continue;
    // function offset relative to the card — when the file moves, functions
    // move with it and do not "detach"
    data.nodes[n.id] = [Math.round(n.x - n.group.x), Math.round(n.y - n.group.y)];
  }
  for (const g of state.groups) {
    data.groups[g.path] = {
      x: Math.round(g.x),
      y: Math.round(g.y),
      exp: g.expanded ? 1 : 0,
      pin: g.pinned ? 1 : 0,
      hid: g.hidden ? 1 : 0,
      hin: g.hideIncoming ? 1 : 0,
      hout: g.hideOutgoing ? 1 : 0,
      ew: Math.round(g.editW || EDIT_W),
      eh: Math.round(g.editH || EDIT_H),
    };
  }
  data.folders = {};
  for (const f of state.folders) {
    data.folders[f.key] = {
      col: f.collapsed ? 1 : 0,
      hid: f.hidden ? 1 : 0,
      hin: f.hideIncoming ? 1 : 0,
      hout: f.hideOutgoing ? 1 : 0,
      cx: Math.round(f.cardX),
      cy: Math.round(f.cardY),
      cp: f.cardPlaced ? 1 : 0,
    };
  }
  try {
    localStorage.setItem(state.storeKey, JSON.stringify(data));
  } catch {
    /* private mode / quota exceeded */
  }
}

/** Read and parse the saved layout JSON for the current root (or null). */
export function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(state.storeKey) || "null");
  } catch {
    return null;
  }
}

/** Apply a previously saved layout onto current groups/folders/nodes. */
export function applySaved() {
  const s = loadSaved();
  if (!s) return false;
  if (s.groups) {
    for (const g of state.groups) {
      const p = s.groups[g.path];
      if (!p) continue;
      if (Array.isArray(p)) {
        g.x = p[0];
        g.y = p[1];
      } else {
        g.x = p.x;
        g.y = p.y;
        g.expanded = !!p.exp;
        g.pinned = !!p.pin;
        g.hidden = !!p.hid;
        g.hideIncoming = !!p.hin;
        g.hideOutgoing = !!p.hout;
        if (p.ew) g.editW = Math.max(EDIT_MIN_W, p.ew);
        if (p.eh) g.editH = Math.max(EDIT_MIN_H, p.eh);
      }
      applySize(g);
    }
  }
  for (const g of state.groups) if (g.expanded) layoutInner(g);
  if (s.folders) {
    for (const f of state.folders) {
      const p = s.folders[f.key];
      if (!p) continue;
      f.collapsed = !!p.col;
      f.hidden = !!p.hid;
      f.hideIncoming = !!p.hin;
      f.hideOutgoing = !!p.hout;
      f.cardX = p.cx || 0;
      f.cardY = p.cy || 0;
      f.cardPlaced = !!p.cp;
    }
  }
  // function positions are relative only (v2); ignore the old absolute format,
  // functions simply stay in place inside the card
  if (s.v === 2 && s.nodes) {
    for (const n of nodes.values()) {
      if (!n.group) continue;
      const off = s.nodes[n.id];
      if (off) {
        n.x = n.group.x + off[0];
        n.y = n.group.y + off[1];
      }
    }
  }
  // Saved coordinates can stack (an older session, or a grown editor that was
  // never separated). Unstick before the first paint.
  separateOverlapping(state.groups, 80);
  markDirty();
  return true;
}

/** Remove the saved layout for the current root from localStorage. */
export function clearSaved() {
  try {
    localStorage.removeItem(state.storeKey);
  } catch {
    /* nop */
  }
}
