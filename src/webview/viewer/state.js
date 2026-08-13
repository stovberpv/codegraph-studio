/*
 * Shared, mutable scene state for the canvas viewer.
 *
 * The viewer is split into ES modules bundled into one IIFE. ES modules cannot
 * reassign an imported binding across files, so every value that gets reassigned
 * at runtime (arrays/maps rebuilt on each layout, mode flags, hover/selection,
 * the in-flight drag, etc.) lives here as a property of a single `state` object
 * and is mutated as `state.x = …`. Values only ever mutated in place (`cam`,
 * `nodes`) are plain exported constants.
 */

/** Mutable scene state; reassigned fields must be routed through this object. */
export const state = {
  dirty: true,

  edges: [], // {from,to} at function level
  renderEdges: [], // aggregated for drawing {a,b} (a/b — node or group)
  groups: [], // file cards
  unitAdj: new Map(), // unit -> Set<unit> (in+out neighbors; unit = file or folder card)
  folders: [], // folder entities (folder mode only)
  folderByKey: new Map(), // key -> folder

  hoverEntity: null, // node or group under the cursor
  hoverNeighbors: new Set(), // neighboring entities for highlight
  highlight: new Set(), // node ids from search
  highlightGroups: new Set(), // groups from search

  storeKey: "codegraph:positions",
  filterKey: "codegraph:filter",
  graphRoot: "",

  layoutMode: "files", // 'files' | 'folder'
  followMode: false,
  followFocus: null, // group | null
  followSet: new Set(), // visible groups in follow mode with a focus
  lazyMode: false, // "lazy watch": all files visible, edges hidden
  lazyFocus: null, // group | null — file whose edges are shown on click
  hideIsolated: false,

  hoverButton: null, // {g, action} — control under the cursor
  selection: new Set(), // selected cards (for group dragging)

  drag: null, // in-flight pointer drag descriptor
  rebuilding: false, // a rebuild request is in flight

  dpr: window.devicePixelRatio || 1, // device pixel ratio, refreshed on resize
};

/** Camera transform (mutated in place). */
export const cam = { x: 0, y: 0, scale: 1 };

/** id -> function node (mutated in place; rebuilt entries via clear/set). */
export const nodes = new Map();

/** Flag the scene for redraw on the next animation frame. */
export function markDirty() {
  state.dirty = true;
}
