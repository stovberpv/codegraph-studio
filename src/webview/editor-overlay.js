/**
 * CodeMirror 6 overlays layered over file cards on the canvas.
 * Talks to the viewer through window.__cgEditor / window.__cgHost.
 * Bundled by esbuild into dist/webview/editor.js (IIFE).
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

const MAX_OPEN = 4;
/** @type {Map<string, { el: HTMLElement, view: EditorView|null, dirty: boolean, path: string, openedAt: number }>} */
const editors = new Map();
/** queue of paths awaiting fileContent */
const pending = new Set();

/** Resolved UI messages injected by the Pug template (#cg-i18n JSON island). */
const CG_MSG = (() => {
  try {
    return JSON.parse(document.getElementById("cg-i18n")?.textContent || "{}") || {};
  } catch {
    return {};
  }
})();

/**
 * Looks up a localized string by key, filling `{name}` placeholders from `vars`.
 * Why: the overlay shares the same message dictionary as the canvas viewer, so
 * all UI text comes from one localized source.
 */
function t(key, vars) {
  let s = CG_MSG[key] != null ? CG_MSG[key] : key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
}

/**
 * Sends a message to the extension host if the bridge is available.
 * Why: overlays run in both standalone and extension modes; in standalone there
 * is no host, so posting is a no-op.
 */
function post(msg) {
  if (window.__cgHost && typeof window.__cgHost.postMessage === "function") {
    window.__cgHost.postMessage(msg);
  }
}

/**
 * Returns the DOM layer that holds all editor overlays.
 * Why: overlays are positioned absolutely inside this container.
 */
function layer() {
  return document.getElementById("editors");
}

/**
 * Finds the viewer group (file card) for a given path.
 * Why: overlays follow their card's geometry, which lives in the viewer state.
 */
function findGroup(path) {
  const cg = window.__cg;
  if (!cg || !cg.groups) return null;
  return cg.groups.find((g) => g.path === path) || null;
}

/**
 * Requests a viewer repaint.
 * Why: overlay changes (open/close/resize) alter card layout the canvas draws.
 */
function markViewerDirty() {
  if (window.__cg && typeof window.__cg.markDirty === "function") window.__cg.markDirty();
}

/**
 * Toggles a card's editing state and resizes it to the editor dimensions.
 * Why: the card must grow to host the editor and notify the viewer so layout
 * and edges are recomputed; falls back to fixed sizes if the viewer helpers
 * aren't present.
 */
function setEditing(g, on) {
  if (!g) return;
  g.editing = !!on;
  if (typeof window.__cg?.applySize === "function") window.__cg.applySize(g);
  else if (on) {
    g.w = g.editW || 520;
    g.h = g.editH || 380;
  }
  if (typeof window.__cg?.onEditingChange === "function") window.__cg.onEditingChange(g);
  markViewerDirty();
}

/**
 * Builds the overlay shell DOM (bar, title, status, buttons, body) for a path.
 * Why: input events are stopped from reaching the canvas so typing/scrolling in
 * the editor doesn't pan or zoom the graph; ⌘/Ctrl+S saves.
 */
function makeShell(path) {
  const el = document.createElement("div");
  el.className = "cg-editor";
  el.dataset.path = path;
  el.innerHTML = `
    <div class="cg-editor-bar">
      <span class="cg-editor-title"></span>
      <span class="cg-editor-status"></span>
      <button type="button" class="cg-editor-save" title="${t("ed_save_title")}">${t("ed_save")}</button>
      <button type="button" class="cg-editor-close" title="${t("ed_close_title")}">✕</button>
    </div>
    <div class="cg-editor-body"></div>
    <div class="cg-editor-resize" title="${t("ed_resize_title")}" aria-hidden="true"></div>
  `;
  el.querySelector(".cg-editor-title").textContent = path.split("/").pop() || path;

  // don't forward canvas zoom/pan events
  const stop = (e) => e.stopPropagation();
  for (const ev of ["wheel", "mousedown", "mouseup", "mousemove", "pointerdown", "pointerup", "click", "dblclick", "contextmenu", "touchstart", "touchmove"]) {
    el.addEventListener(ev, stop);
  }
  el.addEventListener(
    "keydown",
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        save(path);
      }
      e.stopPropagation();
    },
    true,
  );

  el.querySelector(".cg-editor-save").addEventListener("click", (e) => {
    e.preventDefault();
    save(path);
  });
  el.querySelector(".cg-editor-close").addEventListener("click", (e) => {
    e.preventDefault();
    close(path);
  });

  attachResize(el, path);

  return el;
}

/**
 * Wires the bottom-right grip so the user can drag the edit card to any size.
 * Why: text often overflows the default size; screen-pixel deltas are converted
 * to world units by the camera scale so the card resizes correctly at any zoom,
 * and the new size is persisted (via the viewer) when the drag ends.
 */
function attachResize(el, path) {
  const grip = el.querySelector(".cg-editor-resize");
  if (!grip) return;
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const g = findGroup(path);
    if (!g) return;
    const scale = window.__cg?.cam?.scale || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = g.editW || 520;
    const startH = g.editH || 380;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture unsupported — dragging still works */
    }
    const onMove = (ev) => {
      const w = startW + (ev.clientX - startX) / scale;
      const h = startH + (ev.clientY - startY) / scale;
      window.__cg?.setEditorSize?.(g, w, h, false);
    };
    const onUp = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      window.__cg?.setEditorSize?.(g, g.editW, g.editH, true);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });
}

/**
 * Sets the status text (and kind) shown in an overlay's bar.
 * Why: communicates load/dirty/saved/error state to the user via a data-kind.
 */
function setStatus(ed, text, kind) {
  const st = ed.el.querySelector(".cg-editor-status");
  if (!st) return;
  st.textContent = text || "";
  st.dataset.kind = kind || "";
}

/**
 * Opens (or focuses) an editor overlay for a file card.
 * Why: enforces a max of MAX_OPEN overlays by evicting the oldest, then requests
 * the file content from the host and mounts the view once it arrives.
 */
function open(g) {
  if (!g || !g.path) return;
  const path = g.path;
  if (editors.has(path)) {
    // already open — focus it
    const ed = editors.get(path);
    ed.openedAt = Date.now();
    if (ed.view) ed.view.focus();
    setEditing(g, true);
    sync();
    return;
  }

  // limit: close the oldest
  while (editors.size >= MAX_OPEN) {
    let oldest = null;
    let oldestAt = Infinity;
    for (const [p, ed] of editors) {
      if (ed.openedAt < oldestAt) {
        oldestAt = ed.openedAt;
        oldest = p;
      }
    }
    if (oldest) close(oldest);
    else break;
  }

  const root = layer();
  if (!root) return;
  const el = makeShell(path);
  root.appendChild(el);
  editors.set(path, { el, view: null, dirty: false, path, openedAt: Date.now() });
  setEditing(g, true);
  setStatus(editors.get(path), t("ed_loading"), "muted");
  pending.add(path);
  post({ type: "openFile", path });
  sync();
}

/**
 * Creates the CodeMirror EditorView for a path with the given text.
 * Why: builds the editor with TS syntax highlighting, dark theme and a dirty
 * listener; recreates the view if one already exists for the path.
 */
function mountView(path, text) {
  const ed = editors.get(path);
  if (!ed) return;
  const body = ed.el.querySelector(".cg-editor-body");
  if (!body) return;
  if (ed.view) {
    ed.view.destroy();
    ed.view = null;
  }
  const state = EditorState.create({
    doc: text ?? "",
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      javascript({ typescript: true }),
      oneDark,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          ed.dirty = true;
          setStatus(ed, t("ed_changed"), "dirty");
        }
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "12px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
        ".cm-content": { caretColor: "#e6edf3" },
      }),
    ],
  });
  ed.view = new EditorView({ state, parent: body });
  ed.dirty = false;
  setStatus(ed, "", "");
  pending.delete(path);
}

/**
 * Sends the current editor contents to the host to be saved.
 * Why: persistence happens host-side (WorkspaceEdit); this posts the text.
 */
function save(path) {
  const ed = editors.get(path);
  if (!ed || !ed.view) return;
  const text = ed.view.state.doc.toString();
  setStatus(ed, "сохранение…", "muted");
  post({ type: "saveFile", path, text });
}

/**
 * Closes an overlay, destroys its view and clears the card's editing state.
 * Why: releases the CodeMirror instance and restores the card to normal size.
 */
function close(path) {
  const ed = editors.get(path);
  if (!ed) return;
  if (ed.view) {
    ed.view.destroy();
    ed.view = null;
  }
  ed.el.remove();
  editors.delete(path);
  pending.delete(path);
  const g = findGroup(path);
  if (g) setEditing(g, false);
  sync();
}

/**
 * Closes every open overlay.
 * Why: used when the graph reloads so stale editors don't linger.
 */
function closeAll() {
  for (const p of [...editors.keys()]) close(p);
}

/**
 * Handles a fileContent message by mounting the editor view.
 * Why: content arrives asynchronously after an openFile request.
 */
function onFileContent(msg) {
  if (!msg || !msg.path) return;
  if (!editors.has(msg.path)) return;
  mountView(msg.path, msg.text);
}

/**
 * Handles a saved acknowledgement: clears dirty state and shows a brief note.
 * Why: gives the user feedback and auto-hides the status after a moment.
 */
function onSaved(msg) {
  const ed = editors.get(msg.path);
  if (!ed) return;
  ed.dirty = false;
  setStatus(ed, t("ed_saved"), "ok");
  setTimeout(() => {
    if (editors.get(msg.path) === ed && !ed.dirty) setStatus(ed, "", "");
  }, 1200);
}

/**
 * Handles an externalChange message (the file was saved on disk elsewhere).
 * Why: refreshes the editor with the new text unless it has unsaved edits, in
 * which case it warns instead of clobbering the user's work.
 */
function onExternalChange(msg) {
  const ed = editors.get(msg.path);
  if (!ed || !ed.view) return;
  if (ed.dirty) {
    setStatus(ed, t("ed_external"), "warn");
    return;
  }
  const cur = ed.view.state.doc.toString();
  if (cur === msg.text) return;
  ed.view.dispatch({
    changes: { from: 0, to: ed.view.state.doc.length, insert: msg.text ?? "" },
  });
  ed.dirty = false;
  setStatus(ed, t("ed_updated"), "muted");
}

/**
 * Positions overlays according to the canvas camera (scale with top-left origin).
 * The editor occupies the card body under the header (HEADER_H = 24).
 * Why: keeps each overlay glued to its card as the user pans/zooms the graph.
 */
function sync() {
  const HEADER_H = 24;
  const cam = window.__cg?.cam;
  if (!cam) return;
  for (const [path, ed] of editors) {
    const g = findGroup(path);
    if (!g || !g.editing) {
      ed.el.style.display = "none";
      continue;
    }
    ed.el.style.display = "flex";
    const left = g.x * cam.scale + cam.x;
    const top = (g.y + HEADER_H) * cam.scale + cam.y;
    ed.el.style.left = left + "px";
    ed.el.style.top = top + "px";
    ed.el.style.width = g.w + "px";
    ed.el.style.height = Math.max(40, g.h - HEADER_H) + "px";
    ed.el.style.transform = `scale(${cam.scale})`;
    ed.el.style.transformOrigin = "top left";
  }
}

/**
 * Toggles the overlay for a card: closes it if open, opens it otherwise.
 * Why: the card's edit control flips editing on and off through this.
 */
function toggle(g) {
  if (!g) return;
  if (g.editing && editors.has(g.path)) close(g.path);
  else open(g);
}

// public API for viewer.js
window.__cgEditor = {
  open,
  close,
  closeAll,
  toggle,
  save,
  sync,
  onFileContent,
  onSaved,
  onExternalChange,
  isOpen: (path) => editors.has(path),
};
