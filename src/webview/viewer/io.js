/*
 * Graph input and the loading / start overlays. In the extension the graph
 * arrives via postMessage; in standalone it is fetched from graph.json. `build`
 * ingests the graph into nodes/edges and drives layout + saved-state restore.
 *
 * Extension launch shows `#loading` until the host answers `ready`: `start` if
 * there is no session cache, `graph` to replay, or `busy` while a parse runs.
 */
import { filterEl, statsEl, vscodeApi } from "./dom.js";
import { state, nodes } from "./state.js";
import { NODE_H } from "./constants.js";
import { t } from "./i18n.js";
import { applySaved, loadSaved } from "./persistence.js";
import { loadEdited } from "./edited.js";
import { syncModeButtons } from "./search-controls.js";
import { layout } from "./layout.js";
import { applyFilter } from "./glob-filter.js";
import { fit } from "./fit.js";

const loadingEl = document.getElementById("loading");
const loadingLabelEl = loadingEl ? loadingEl.querySelector(".loading-label") : null;
const startEl = document.getElementById("start");
/** True while a `graph` message is waiting on a paint before `build`. */
let applyingGraph = false;

/** Show/hide the indeterminate spinner overlay while a parse is in flight. */
export function showLoading(on, label) {
  if (loadingEl) loadingEl.hidden = !on;
  // Reset the label when the overlay is (re)shown; live parse progress from the
  // host then enriches it (see the `progress` message).
  if (on && loadingLabelEl) loadingLabelEl.textContent = label || t("analyzing");
}

/** Show/hide the start-screen CTAs (extension only; absent in standalone HTML). */
function showStart(on) {
  if (startEl) startEl.hidden = !on;
}

/** Enrich the overlay label with live parse status (extension only). */
function setLoadingLabel(text) {
  if (loadingLabelEl && text) loadingLabelEl.textContent = text;
}

/** Two rAFs so a revealed overlay actually paints before blocking `build`. */
function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Wire start-screen buttons once (extension only). */
function wireStartButtons() {
  if (!vscodeApi || !startEl) return;
  document.getElementById("startAnalyze")?.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "rebuild" });
  });
  document.getElementById("startPick")?.addEventListener("click", () => {
    vscodeApi.postMessage({ type: "pickFolder" });
  });
}

/** Load graph.json (standalone) or wait for the VS Code host message. */
export async function load() {
  if (vscodeApi) {
    window.addEventListener("message", onHostMessage);
    statsEl.textContent = t("waiting_graph");
    // Overlay is visible in the extension HTML; keep it until the host says
    // `start` (no session cache) or `graph` (replay / fresh parse).
    showLoading(true, t("loading"));
    showStart(false);
    wireStartButtons();
    vscodeApi.postMessage({ type: "ready" });
    return;
  }
  let data;
  showLoading(true);
  try {
    const res = await fetch("graph.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    statsEl.textContent = t("load_failed");
    showLoading(false);
    return;
  }
  build(data);
}

/** Handle extension→webview messages (graph, editor, errors). */
function onHostMessage(ev) {
  const msg = ev && ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "start") {
    showLoading(false);
    showStart(true);
    return;
  }
  if (msg.type === "busy") {
    if (msg.busy) {
      showStart(false);
      showLoading(true);
    } else if (!applyingGraph) {
      showLoading(false);
    }
    return;
  }
  if (msg.type === "progress") {
    // Host-formatted, already-localized status (e.g. "parsing 800/1240 files…").
    setLoadingLabel(msg.text);
    return;
  }
  if (msg.type === "graph") {
    showStart(false);
    showLoading(true, t("loading"));
    if (window.__cgEditor && typeof window.__cgEditor.closeAll === "function") {
      window.__cgEditor.closeAll();
    }
    applyingGraph = true;
    afterPaint().then(() => {
      try {
        build(msg.graph);
      } finally {
        applyingGraph = false;
      }
    });
    return;
  }
  if (msg.type === "fileContent") {
    window.__cgEditor?.onFileContent?.(msg);
    return;
  }
  if (msg.type === "saved") {
    window.__cgEditor?.onSaved?.(msg);
    return;
  }
  if (msg.type === "externalChange") {
    window.__cgEditor?.onExternalChange?.(msg);
    return;
  }
  if (msg.type === "error") {
    statsEl.textContent = t("error_prefix") + (msg.message || "?");
    showLoading(false);
    state.rebuilding = false;
  }
}

/** Ingest graph JSON into nodes/edges and run layout + restore. */
export function build(data) {
  nodes.clear();
  for (const n of data.nodes) {
    nodes.set(n.id, { ...n, x: 0, y: 0, w: 0, h: NODE_H, deg: 0, group: null });
  }
  state.edges = [];
  for (const e of data.edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) continue;
    from.deg++;
    to.deg++;
    state.edges.push({ from, to });
  }
  for (const n of nodes.values()) n.adj = new Set();
  for (const e of state.edges) {
    e.from.adj.add(e.to.id);
    e.to.adj.add(e.from.id);
  }
  statsEl.textContent = t("stats_summary", { files: data.stats.files, nodes: data.stats.nodes, edges: data.stats.edges });
  state.graphRoot = data.root || "";
  state.storeKey = "codegraph:positions:" + state.graphRoot;
  state.filterKey = "codegraph:filter:" + state.graphRoot;
  state.editedKey = "codegraph:edited:" + state.graphRoot;
  loadEdited();
  // reflect the parsed root in the Project menu; the standalone path input stays
  // empty (it's for entering a *new* target — empty Reparse re-parses this root)
  const rootNote = document.getElementById("projectRoot");
  if (rootNote) {
    rootNote.textContent = state.graphRoot || t("project_root_none");
    rootNote.title = state.graphRoot || "";
  }
  // restore the filter string for this root
  if (filterEl) {
    try {
      filterEl.value = localStorage.getItem(state.filterKey) || "";
    } catch {
      filterEl.value = "";
    }
  }
  // grouping mode from the saved layout (if any)
  const saved = loadSaved();
  if (saved && (saved.mode === "files" || saved.mode === "folder")) {
    state.layoutMode = saved.mode;
    syncModeButtons();
  }
  layout();
  applySaved();
  applyFilter();
  fit();
  showLoading(false);
  showStart(false);
}
