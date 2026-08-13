/*
 * Rebuild the call graph for a new root folder — via the VS Code host in the
 * extension, or the /api/rebuild endpoint in standalone. Registers its
 * listeners on import.
 */
import { statsEl, vscodeApi } from "./dom.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { build, showLoading } from "./io.js";

const rootPathEl = document.getElementById("rootPath");
const rebuildEl = document.getElementById("rebuild");
/** Ask the host/server to rebuild the call graph for a new root folder. */
async function rebuildFrom(root) {
  root = (root || "").trim();
  if (!root || state.rebuilding) return;
  state.rebuilding = true;
  statsEl.textContent = t("rebuilding");
  if (vscodeApi) {
    vscodeApi.postMessage({ type: "rebuild", root, includeTests: false });
    // rebuilding clears on the graph/error reply
    setTimeout(() => {
      state.rebuilding = false;
    }, 50);
    return;
  }
  showLoading(true);
  try {
    const res = await fetch("/api/rebuild", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root }),
    });
    const data = await res.json();
    if (!res.ok) {
      statsEl.textContent = t("error_prefix") + (data && data.error ? data.error : res.status);
      showLoading(false);
      return;
    }
    build(data);
  } catch (e) {
    statsEl.textContent = t("rebuild_net_error");
    showLoading(false);
  } finally {
    state.rebuilding = false;
  }
}
if (rebuildEl && rootPathEl) {
  rebuildEl.addEventListener("click", () => rebuildFrom(rootPathEl.value));
  rootPathEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") rebuildFrom(rootPathEl.value);
  });
}
