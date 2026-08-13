/*
 * Controls legend, collapsed into the "i" toggle by default. Persists its
 * open/closed state. Registers its listener on import.
 */

const legendEl = document.getElementById("hint");
const legendToggleEl = document.getElementById("legendToggle");
const LEGEND_KEY = "codegraph:legendOpen";
/** Show/hide the legend and mirror the state on the toggle. */
function setLegendOpen(open) {
  if (legendEl) legendEl.hidden = !open;
  if (legendToggleEl) {
    legendToggleEl.classList.toggle("active", open);
    legendToggleEl.setAttribute("aria-expanded", open ? "true" : "false");
  }
}
if (legendToggleEl && legendEl) {
  let open = false;
  try {
    open = localStorage.getItem(LEGEND_KEY) === "1";
  } catch {
    open = false;
  }
  setLegendOpen(open);
  legendToggleEl.addEventListener("click", () => {
    open = !open;
    setLegendOpen(open);
    try {
      localStorage.setItem(LEGEND_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable — keep the in-memory state */
    }
  });
}
