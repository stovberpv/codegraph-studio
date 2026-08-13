/*
 * Visibility rules under filter / follow / lazy / manual-hide, and the follow /
 * lazy focus setters. A "unit" is the file card when its folder is expanded, or
 * the folder card when the folder is collapsed.
 */
import { state, markDirty } from "./state.js";
import { isFolder, isGroup } from "./utils.js";
import { rebuildRenderEdges } from "./edges.js";

// Map "unit" for follow/lazy: the file if its folder is expanded;
// the folder card if collapsed; null if the folder is hidden.
/** Resolve the follow/lazy map unit for a file group (file or collapsed folder). */
export function unitOf(g) {
  if (!g || state.layoutMode !== "folder") return g;
  const f = state.folderByKey.get(g.folder);
  if (!f) return g;
  if (f.hidden) return null;
  if (f.collapsed) return f;
  return g;
}
/** Whether a map unit (file or folder) should currently be shown. */
export function unitVisible(u) {
  if (!u) return false;
  return isFolder(u) ? folderVisible(u) : groupVisible(u);
}
// Whether the current focus is still valid (unit exists and can be focused).
/** True if focus unit u still exists and is eligible to be focused. */
export function focusValid(u) {
  if (!u) return false;
  if (isFolder(u)) return state.layoutMode === "folder" && !u.hidden && u.collapsed;
  return !u.filteredOut && unitOf(u) === u;
}

/** Visibility of a file card under filter, follow, lazy, and manual hide. */
export function groupVisible(g) {
  if (!g || g.filteredOut) return false;
  // file is visible only if it is itself the unit (folder not hidden/collapsed)
  if (unitOf(g) !== g) return false;
  if (state.lazyMode) return true; // all files visible, even manually hidden ones
  if (state.followMode) return !state.followFocus || state.followSet.has(g);
  return !g.hidden;
}
// Whether the folder entity (island/card) is visible on the map.
/** Visibility of a folder entity as an island or collapsed card. */
export function folderVisible(f) {
  if (!f || state.layoutMode !== "folder" || f.hidden) return false;
  if (!f.collapsed) return true; // island container; visible files determine the bbox
  // collapsed folder is its own unit and follows the mode rules
  if (state.lazyMode) return true;
  if (state.followMode) return !state.followFocus || state.followSet.has(f);
  return true;
}
/** Whether a function node should be drawn (not hidden; group visible). */
export function nodeVisible(n) {
  return n && !n.hidden && n.group && groupVisible(n.group);
}
/** Set follow-mode focus unit and rebuild visible neighborhood edges. */
export function setFollowFocus(u) {
  state.followFocus = u || null; // followSet is rebuilt in rebuildRenderEdges from unitAdj
  rebuildRenderEdges();
  markDirty();
}
/** Set lazy-mode focus unit so only its edges are shown. */
export function setLazyFocus(u) {
  state.lazyFocus = u || null;
  rebuildRenderEdges();
  markDirty();
}
// Map the hovered entity to a focus unit (file / collapsed folder).
/** Map a hover/click entity to a focusable unit (file or collapsed folder). */
export function focusUnitFromEntity(ent) {
  if (!ent) return null;
  if (isFolder(ent)) return ent.collapsed ? ent : null;
  if (isGroup(ent)) return ent;
  if (ent.group) return ent.group;
  return null;
}
