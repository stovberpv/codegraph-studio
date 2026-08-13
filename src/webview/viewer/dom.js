/*
 * Canvas element and shared DOM references, plus the VS Code webview API.
 * Section modules that own a single widget (rebuild input, legend, etc.) query
 * their own elements; only the widely-shared references live here.
 */

export const canvas = document.getElementById("canvas");
export const ctx = canvas.getContext("2d", { alpha: false });
export const tooltip = document.getElementById("tooltip");
export const statsEl = document.getElementById("stats");
export const searchEl = document.getElementById("search");
export const filterEl = document.getElementById("filter");
export const hideIsolatedEl = document.getElementById("hideIsolated");
export const modeFilesEl = document.getElementById("modeFiles");
export const modeFoldersEl = document.getElementById("modeFolders");
export const followModeEl = document.getElementById("followMode");
export const lazyModeEl = document.getElementById("lazyMode");
export const zenModeEl = document.getElementById("zenMode");

// VS Code webview API (null in standalone)
export const vscodeApi =
  typeof acquireVsCodeApi === "function"
    ? (() => {
        try {
          return acquireVsCodeApi();
        } catch {
          return null;
        }
      })()
    : null;
if (vscodeApi) window.__cgHost = vscodeApi;
