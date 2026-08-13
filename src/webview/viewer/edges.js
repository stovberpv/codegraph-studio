/*
 * Aggregate function-level edges into the drawable set: build unit adjacency for
 * follow mode, rebuild the follow set, and collapse edges onto folder cards.
 */
import { state, markDirty } from "./state.js";
import { endpoint, entKey, isFolder } from "./utils.js";
import { focusValid, unitOf, unitVisible } from "./visibility.js";

/** Rebuild unit adjacency, followSet, and aggregated edges for drawing. */
export function rebuildRenderEdges() {
  state.unitAdj = new Map();
  const bumpAdj = (a, b) => {
    if (!state.unitAdj.has(a)) state.unitAdj.set(a, new Set());
    if (!state.unitAdj.has(b)) state.unitAdj.set(b, new Set());
    state.unitAdj.get(a).add(b);
    state.unitAdj.get(b).add(a);
  };
  // 1) unit adjacency (for follow) — ignoring manual hides.
  //    Unit = file (folder expanded) or folder card (folder collapsed).
  for (const e of state.edges) {
    const from = e.from;
    const to = e.to;
    if (!from.group || !to.group) continue;
    if (from.hidden || to.hidden) continue;
    if (from.group.filteredOut || to.group.filteredOut) continue;
    const ua = unitOf(from.group);
    const ub = unitOf(to.group);
    if (!ua || !ub || ua === ub) continue;
    bumpAdj(ua, ub);
  }
  // 2) drop stale focus and rebuild followSet from fresh adjacency
  if (state.followFocus && !focusValid(state.followFocus)) state.followFocus = null;
  if (state.lazyFocus && !focusValid(state.lazyFocus)) state.lazyFocus = null;
  state.followSet = new Set();
  if (state.followFocus) {
    state.followSet.add(state.followFocus);
    const adj = state.unitAdj.get(state.followFocus);
    if (adj) for (const n of adj) state.followSet.add(n);
  }
  // 3) edges for drawing (aggregated onto a collapsed folder card)
  state.renderEdges = [];
  const seen = new Set();
  const manual = !state.followMode && !state.lazyMode; // manual toggles only in normal mode
  for (const e of state.edges) {
    const from = e.from;
    const to = e.to;
    if (!from.group || !to.group) continue;
    if (from.hidden || to.hidden) continue;
    const ua = unitOf(from.group);
    const ub = unitOf(to.group);
    if (!ua || !ub || ua === ub) continue;
    if (!unitVisible(ua) || !unitVisible(ub)) continue;
    if (state.lazyMode) {
      // edges hidden until a unit is selected; then only its in+out
      if (!state.lazyFocus) continue;
      if (ua !== state.lazyFocus && ub !== state.lazyFocus) continue;
    }
    if (manual) {
      // toggles at the folder boundary (cross-folder edges only)
      const ff = state.folderByKey.get(from.group.folder);
      const tf = state.folderByKey.get(to.group.folder);
      if (ff !== tf) {
        if (tf && tf.hideIncoming) continue;
        if (ff && ff.hideOutgoing) continue;
      }
      // file toggles — only for "live" endpoints (unit = the file itself)
      if (ub === to.group && to.group.hideIncoming) continue;
      if (ua === from.group && from.group.hideOutgoing) continue;
    }
    const a = isFolder(ua) ? ua : endpoint(from);
    const b = isFolder(ub) ? ub : endpoint(to);
    if (!a || !b || a === b) continue;
    const k = entKey(a) + ">" + entKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    state.renderEdges.push({ a, b });
  }
  markDirty();
}
