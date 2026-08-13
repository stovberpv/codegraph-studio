/*
 * Localized UI strings for the canvas, read from the `#cg-i18n` JSON island the
 * Pug template injects (shared dictionary; see src/i18n/webview.js).
 */

// Resolved UI messages injected by the Pug template (#cg-i18n JSON island).
const CG_MSG = (() => {
  try {
    return JSON.parse(document.getElementById("cg-i18n")?.textContent || "{}") || {};
  } catch {
    return {};
  }
})();

/**
 * Looks up a localized string by key, filling `{name}` placeholders from `vars`.
 * Why: all canvas UI text comes from one localized dictionary shared with the host.
 */
export function t(key, vars) {
  let s = CG_MSG[key] != null ? CG_MSG[key] : key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}
