/*
 * Feedback for CPU-heavy, main-thread-blocking control actions (force layout,
 * collision passes, bulk edge rebuilds). Because the work is synchronous, a
 * spinner can only appear if we reveal a toast, let the browser paint one frame,
 * then run the blocking work. We don't want that toast to flash on snappy graphs,
 * so `runHeavy` only shows it when the action is predicted to take ~1s+ — from
 * the graph size, or from having measured a slow run before (self-correcting).
 */
import { state } from "./state.js";

const toastEl = document.getElementById("toast");
const labelEl = toastEl ? toastEl.querySelector(".toast-label") : null;

// Prediction thresholds. Force layout is O(cards² · iterations), so card count
// dominates; bulk edge rebuilds scale with edge count. These are deliberately
// generous — a false negative just means one un-toasted slow run that arms the
// measured-duration path for next time.
const HEAVY_CARDS = 400;
const HEAVY_EDGES = 4000;
const SLOW_MS = 600;

let lastHeavyMs = 0;
let pending = false;

/** Show the toast with a description (idempotent). */
function show(text) {
  if (!toastEl) return;
  if (labelEl) labelEl.textContent = text;
  toastEl.hidden = false;
}
/** Hide the toast. */
function hide() {
  if (toastEl) toastEl.hidden = true;
}

/** Whether the next heavy action is likely to block for ~1s+. */
function predictHeavy() {
  const cards = state.groups ? state.groups.length : 0;
  const edges = state.edges ? state.edges.length : 0;
  return cards >= HEAVY_CARDS || edges >= HEAVY_EDGES || lastHeavyMs >= SLOW_MS;
}

// Resolve after the browser has painted at least one frame, so a revealed toast
// is actually on screen before the blocking work starts.
function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Run a synchronous, potentially expensive `work` with a processing toast when
 * it's predicted to block for ~1s+. Fast actions run inline with no toast; if
 * one turns out slow, its duration arms the toast for subsequent runs.
 * @param {string} text localized processing description
 * @param {() => void} work the blocking operation
 */
export function runHeavy(text, work) {
  if (pending) return; // ignore re-entrant clicks while a heavy run is queued
  if (!predictHeavy()) {
    const t0 = performance.now();
    work();
    const ms = performance.now() - t0;
    if (ms >= SLOW_MS) lastHeavyMs = ms;
    return;
  }
  pending = true;
  show(text);
  afterPaint().then(() => {
    const t0 = performance.now();
    try {
      work();
    } finally {
      lastHeavyMs = performance.now() - t0;
      hide();
      pending = false;
    }
  });
}
