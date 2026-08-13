/*
 * Simple comma-separated include/exclude glob filter over relative file paths.
 */
import { filterEl } from "./dom.js";
import { state, markDirty } from "./state.js";
import { isFolder } from "./utils.js";
import { setFollowFocus, setLazyFocus } from "./visibility.js";
import { rebuildRenderEdges } from "./edges.js";

/** Compile a simple glob (*, **, ?) into a RegExp for path filtering. */
export function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** — any path, including /
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("+.^$()[]{}|\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}
/** Parse a comma-separated include/exclude glob string into regex lists. */
export function parseFilter(str) {
  const include = [];
  const exclude = [];
  const parts = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (let p of parts) {
    // allow a "glob:" prefix from the UI placeholder
    if (p.toLowerCase().startsWith("glob:")) p = p.slice(5).trim();
    if (!p) continue;
    if (p.startsWith("!")) exclude.push(globToRegExp(p.slice(1)));
    else include.push(globToRegExp(p));
  }
  return { include, exclude };
}
/** Test a file path against include/exclude filter regexes. */
export function pathMatchesFilter(path, flt) {
  if (flt.exclude.some((re) => re.test(path))) return false;
  if (!flt.include.length) return true;
  return flt.include.some((re) => re.test(path));
}
/** Apply the UI filter to groups, persist it, and refresh edges. */
export function applyFilter() {
  const raw = filterEl ? filterEl.value.trim() : "";
  const flt = parseFilter(raw);
  for (const g of state.groups) {
    g.filteredOut = !pathMatchesFilter(g.path, flt);
  }
  if (state.followFocus && !isFolder(state.followFocus) && state.followFocus.filteredOut) setFollowFocus(null);
  else if (state.lazyFocus && !isFolder(state.lazyFocus) && state.lazyFocus.filteredOut) setLazyFocus(null);
  else {
    rebuildRenderEdges();
    markDirty();
  }
  try {
    if (state.filterKey) localStorage.setItem(state.filterKey, raw);
  } catch {
    /* nop */
  }
}
