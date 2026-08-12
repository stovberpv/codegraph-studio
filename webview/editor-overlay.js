/**
 * CodeMirror 6 оверлеи поверх карточек файлов на холсте.
 * Общается с viewer через window.__cgEditor / window.__cgHost.
 * Бандлится esbuild в dist/webview/editor.js (IIFE).
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
/** очередь ожидающих fileContent */
const pending = new Set();

function post(msg) {
  if (window.__cgHost && typeof window.__cgHost.postMessage === "function") {
    window.__cgHost.postMessage(msg);
  }
}

function layer() {
  return document.getElementById("editors");
}

function findGroup(path) {
  const cg = window.__cg;
  if (!cg || !cg.groups) return null;
  return cg.groups.find((g) => g.path === path) || null;
}

function markViewerDirty() {
  if (window.__cg && typeof window.__cg.markDirty === "function") window.__cg.markDirty();
}

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

function makeShell(path) {
  const el = document.createElement("div");
  el.className = "cg-editor";
  el.dataset.path = path;
  el.innerHTML = `
    <div class="cg-editor-bar">
      <span class="cg-editor-title"></span>
      <span class="cg-editor-status"></span>
      <button type="button" class="cg-editor-save" title="Сохранить (⌘/Ctrl+S)">сохранить</button>
      <button type="button" class="cg-editor-close" title="Свернуть редактор">✕</button>
    </div>
    <div class="cg-editor-body"></div>
  `;
  el.querySelector(".cg-editor-title").textContent = path.split("/").pop() || path;

  // не прокидывать зум/пан холста
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

  return el;
}

function setStatus(ed, text, kind) {
  const st = ed.el.querySelector(".cg-editor-status");
  if (!st) return;
  st.textContent = text || "";
  st.dataset.kind = kind || "";
}

function open(g) {
  if (!g || !g.path) return;
  const path = g.path;
  if (editors.has(path)) {
    // уже открыт — фокус
    const ed = editors.get(path);
    ed.openedAt = Date.now();
    if (ed.view) ed.view.focus();
    setEditing(g, true);
    sync();
    return;
  }

  // лимит: закрыть самый старый
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
  setStatus(editors.get(path), "загрузка…", "muted");
  pending.add(path);
  post({ type: "openFile", path });
  sync();
}

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
          setStatus(ed, "• изменено", "dirty");
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

function save(path) {
  const ed = editors.get(path);
  if (!ed || !ed.view) return;
  const text = ed.view.state.doc.toString();
  setStatus(ed, "сохранение…", "muted");
  post({ type: "saveFile", path, text });
}

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

function closeAll() {
  for (const p of [...editors.keys()]) close(p);
}

function onFileContent(msg) {
  if (!msg || !msg.path) return;
  if (!editors.has(msg.path)) return;
  mountView(msg.path, msg.text);
}

function onSaved(msg) {
  const ed = editors.get(msg.path);
  if (!ed) return;
  ed.dirty = false;
  setStatus(ed, "сохранено", "ok");
  setTimeout(() => {
    if (editors.get(msg.path) === ed && !ed.dirty) setStatus(ed, "", "");
  }, 1200);
}

function onExternalChange(msg) {
  const ed = editors.get(msg.path);
  if (!ed || !ed.view) return;
  if (ed.dirty) {
    setStatus(ed, "файл изменён снаружи", "warn");
    return;
  }
  const cur = ed.view.state.doc.toString();
  if (cur === msg.text) return;
  ed.view.dispatch({
    changes: { from: 0, to: ed.view.state.doc.length, insert: msg.text ?? "" },
  });
  ed.dirty = false;
  setStatus(ed, "обновлено", "muted");
}

/**
 * Позиционирует оверлеи по камере холста (scale с origin top-left).
 * Редактор занимает тело карточки под шапкой (HEADER_H = 24).
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

function toggle(g) {
  if (!g) return;
  if (g.editing && editors.has(g.path)) close(g.path);
  else open(g);
}

// публичный API для viewer.js
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
