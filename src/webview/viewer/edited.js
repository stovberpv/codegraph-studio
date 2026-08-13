/*
 * Tracks which files differ from their original so they get the edited dot and
 * stay colored in Zen mode. This is CONTENT-based, not event-based: a file is
 * "edited" only while its content actually differs from the pristine baseline
 * captured the first time it was opened this session — so undoing a change (and
 * saving) clears the mark instead of leaving a stale flag.
 *
 *   - `edited` (persisted per root): the on-disk content differs from baseline —
 *     set/cleared on a canvas save or an external on-disk change.
 *   - `editedDirty` (session only): the editor buffer differs from baseline —
 *     i.e. unsaved edits are pending on the canvas.
 *
 * A card shows the dot when either holds. Baselines are session-only; persisted
 * marks from a previous session stay until an open/save/external event lets us
 * compare their content again.
 */
import { state, markDirty } from "./state.js";

/** Restore the persisted edited set for the current root; reset session state. */
export function loadEdited() {
  state.editedDirty = new Set();
  state.baselines = new Map();
  try {
    const arr = JSON.parse(localStorage.getItem(state.editedKey) || "[]");
    state.edited = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    state.edited = new Set();
  }
}

/** Persist the edited set for the current root. */
function saveEdited() {
  try {
    localStorage.setItem(state.editedKey, JSON.stringify([...state.edited]));
  } catch {
    /* private mode / quota exceeded */
  }
}

/** Record a file's pristine content the first time it is seen (never overwrite). */
export function noteBaseline(path, text) {
  if (!path) return;
  if (!state.baselines.has(path)) state.baselines.set(path, text ?? "");
}

/**
 * Whether `text` counts as modified from the file's baseline. With no baseline
 * recorded (e.g. a mark persisted from a previous session) we can't compare, so
 * we treat it as modified to avoid silently dropping a remembered edit.
 */
function isModified(path, text) {
  if (!state.baselines.has(path)) return true;
  return state.baselines.get(path) !== (text ?? "");
}

/**
 * The on-disk content changed (a canvas save or an external write). Persist the
 * edited mark iff the content actually differs from baseline; clear it if the
 * file was reverted back to its original.
 */
export function markDiskContent(path, text) {
  if (!path) return;
  let changed = false;
  if (isModified(path, text)) {
    if (!state.edited.has(path)) {
      state.edited.add(path);
      changed = true;
    }
  } else if (state.edited.delete(path)) {
    changed = true;
  }
  if (changed) saveEdited();
  markDirty();
}

/** The editor buffer changed: session dot iff it differs from baseline. */
export function setBufferEdited(path, text) {
  if (!path) return;
  if (isModified(path, text)) state.editedDirty.add(path);
  else state.editedDirty.delete(path);
  markDirty();
}

/** Drop the session dirty mark (editor closed with no pending unsaved edits). */
export function clearBufferEdited(path) {
  if (!path) return;
  if (state.editedDirty.delete(path)) markDirty();
}

/** Whether a file card differs from its original (on disk or unsaved-in-session). */
export function isEdited(path) {
  return state.edited.has(path) || state.editedDirty.has(path);
}
