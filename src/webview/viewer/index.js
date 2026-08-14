/* codegraph viewer — canvas renderer for a call tree.
 * No dependencies. Fast: redraw only on changes (dirty flag),
 * cull off-viewport, batch-draw edges as a single path.
 *
 * File cards are collapsed by default (uniform cards showing the file name).
 * The [+]/[−] button expands them into a long function list. Edges aggregate
 * onto the collapsed card. State (positions + collapsed) is persisted.
 *
 * Entry point: wires the render loop, resize handling, and the debug hook, and
 * imports the feature modules so their canvas/toolbar listeners register.
 */
import { canvas } from "./dom.js";
import { state, cam, markDirty } from "./state.js";
import { render } from "./render.js";
import { load } from "./io.js";
import { applySize, onEditingChange, openEditor, setEditorSize } from "./sizing.js";
import { runControl, runFolderControl } from "./collapse.js";
import { beginGroupDrag, continueGroupDrag, endGroupDrag } from "./interaction.js";
import { groupVisible, setFollowFocus, setLazyFocus } from "./visibility.js";
import { setFollowMode, setLayoutMode, setLazyMode, setZenMode } from "./search-controls.js";
import { clearBufferEdited, markDiskContent, noteBaseline, setBufferEdited } from "./edited.js";
import { fit } from "./fit.js";
// side-effect imports: register canvas/toolbar listeners
import "./interaction.js";
import "./legend.js";
import "./rebuild.js";
import "./menus.js";

/** Sync canvas backing store to CSS size and devicePixelRatio. */
function resize() {
  state.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * state.dpr);
  canvas.height = Math.floor(canvas.clientHeight * state.dpr);
  markDirty();
}
window.addEventListener("resize", resize);

/** Animation-frame loop: render when dirty, then schedule the next frame. */
function frame() {
  if (state.dirty) render();
  requestAnimationFrame(frame);
}

resize();
load();
frame();

// debug hook (for headless checks and manual debugging)
window.__cg = {
  get groups() {
    return state.groups;
  },
  get folders() {
    return state.folders;
  },
  get layoutMode() {
    return state.layoutMode;
  },
  get renderEdges() {
    return state.renderEdges;
  },
  get cam() {
    return cam;
  },
  markDirty,
  applySize,
  onEditingChange,
  setEditorSize,
  openEditor,
  runFolderControl,
  runControl,
  beginGroupDrag,
  continueGroupDrag,
  endGroupDrag,
  setLayoutMode,
  setFollowMode,
  setLazyMode,
  setZenMode,
  groupVisible,
  setFollowFocus,
  setLazyFocus,
  noteBaseline,
  markDiskContent,
  setBufferEdited,
  clearBufferEdited,
  fit,
  centerOn(cx, cy, scale) {
    cam.scale = scale;
    cam.x = canvas.clientWidth / 2 - cx * scale;
    cam.y = canvas.clientHeight / 2 - cy * scale;
    markDirty();
  },
};
