/*
 * Graph input and the loading / start overlays. In the extension the graph
 * arrives via postMessage; in standalone it is fetched from graph.json. `build`
 * ingests the graph into nodes/edges and drives layout + saved-state restore.
 *
 * Extension launch shows `#start` until the user picks a root; `#loading` covers
 * in-flight parses after that.
 */
import { filterEl, statsEl, vscodeApi } from "./dom.js";
import { state, nodes } from "./state.js";
import { NODE_H } from "./constants.js";
import { t } from "./i18n.js";
import { applySaved, loadSaved } from "./persistence.js";
import { syncModeButtons } from "./search-controls.js";
import { layout } from "./layout.js";
import { applyFilter } from "./glob-filter.js";
import { fit } from "./fit.js";

const loadingEl = document.getElementById("loading");
const loadingLabelEl = loadingEl ? loadingEl.querySelector(".loading-label") : null;
const startEl = document.getElementById("start");

/** Show/hide the indeterminate spinner overlay while a parse is in flight. */
export function showLoading(on) {
  if (loadingEl) loadingEl.hidden = !on;
  // Reset the label to the idle text when the overlay is (re)shown; live parse
  // progress from the host then enriches it (see the `progress` message).
  if (on && loadingLabelEl) loadingLabelEl.textContent = t("analyzing");
}

/** Show/hide the start-screen CTAs (extension only; absent in standalone HTML). */
function showStart(on) {
  if (startEl) startEl.hidden = !on;
}

/** Enrich the overlay label with live parse status (extension only). */
function setLoadingLabel(text) {
  if (loadingLabelEl && text) loadingLabelEl.textContent = text;
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
    showLoading(false);
    showStart(true);
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
  if (msg.type === "busy") {
    if (msg.busy) showStart(false);
    showLoading(!!msg.busy);
    return;
  }
  if (msg.type === "progress") {
    // Host-formatted, already-localized status (e.g. "parsing 800/1240 files…").
    setLoadingLabel(msg.text);
    return;
  }
  if (msg.type === "graph") {
    showStart(false);
    if (window.__cgEditor && typeof window.__cgEditor.closeAll === "function") {
      window.__cgEditor.closeAll();
    }
    build(msg.graph);
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
  const rp = document.getElementById("rootPath");
  if (rp && data.root) rp.value = data.root;
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
