/*
 * Pointer interaction: mouse down/move/up drag state machine (controls, cards,
 * folders, nodes, marquee, pan), zoom, hover highlight, and tooltips.
 * Registers its canvas/window listeners on import.
 */
import { canvas, tooltip } from "./dom.js";
import { state, cam, markDirty } from "./state.js";
import { basename, cardOf, edgeEndTouches, escapeHtml, isFolder, isGroup, screenToWorld } from "./utils.js";
import { t } from "./i18n.js";
import { CTRL_LABEL, FOLDER_CTRL_LABEL } from "./icons.js";
import {
  controlAt,
  entityAt,
  folderControlAt,
  folderHeaderAt,
  groupDragAt,
  nodeAt,
} from "./hit-test.js";
import { runControl, runFolderControl, toggleExpand } from "./collapse.js";
import { focusUnitFromEntity, groupVisible, setFollowFocus, setLazyFocus } from "./visibility.js";
import { saveLayout } from "./persistence.js";

canvas.addEventListener("mousedown", (e) => {
  const local = localPos(e);
  const w = screenToWorld(local.x, local.y);
  const shift = e.shiftKey || e.metaKey;

  const ctrl = controlAt(w.x, w.y);
  if (ctrl && !shift) {
    state.drag = { type: "control", group: ctrl.g, action: ctrl.action, sx: e.clientX, sy: e.clientY };
    return;
  }
  const fctrl = folderControlAt(w.x, w.y);
  if (fctrl && !shift) {
    state.drag = { type: "folderControl", folder: fctrl.g, action: fctrl.action, sx: e.clientX, sy: e.clientY };
    return;
  }

  // Shift/Cmd: selection (click card to toggle, background for marquee)
  if (shift) {
    const ent = entityAt(w.x, w.y);
    const g = ent && (isGroup(ent) ? ent : ent.group);
    if (g) {
      state.drag = { type: "toggleSelect", group: g, sx: e.clientX, sy: e.clientY };
      return;
    }
    state.drag = { type: "marquee", x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    return;
  }

  const n = nodeAt(w.x, w.y);
  if (n) {
    state.drag = { type: "node", node: n, ox: w.x - n.x, oy: w.y - n.y };
    canvas.classList.add("dragging");
    return;
  }
  const g = groupDragAt(w.x, w.y);
  if (g && !g.pinned) {
    // drag the whole selection if grabbing a selected card; otherwise just this one
    let set;
    if (state.selection.has(g) && state.selection.size > 0) {
      set = [...state.selection];
    } else {
      if (state.selection.size) markDirty();
      state.selection.clear();
      set = [g];
    }
    state.drag = { type: "group", groups: set, lastX: w.x, lastY: w.y, startSX: e.clientX, startSY: e.clientY };
    canvas.classList.add("dragging");
    return;
  }
  const fh = folderHeaderAt(w.x, w.y);
  if (fh) {
    state.drag = { type: "folder", folder: fh, lastX: w.x, lastY: w.y, startSX: e.clientX, startSY: e.clientY };
    canvas.classList.add("dragging");
    return;
  }
  // empty background without a modifier — clear selection and pan
  if (state.selection.size) {
    state.selection.clear();
    markDirty();
  }
  state.drag = { type: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
  canvas.classList.add("grabbing");
});

window.addEventListener("mousemove", (e) => {
  const local = localPos(e);
  if (state.drag) {
    const w = screenToWorld(local.x, local.y);
    if (state.drag.type === "control") {
      // cursor move turns a press into card drag (unless pinned)
      if (Math.hypot(e.clientX - state.drag.sx, e.clientY - state.drag.sy) > 4) {
        if (state.drag.group.pinned) {
          state.drag = null; // do not move a pinned card
        } else {
          state.drag = { type: "group", groups: [state.drag.group], lastX: w.x, lastY: w.y };
          canvas.classList.add("dragging");
        }
      }
      return;
    }
    if (state.drag.type === "folderControl") {
      // cursor move turns a control press into folder drag
      if (Math.hypot(e.clientX - state.drag.sx, e.clientY - state.drag.sy) > 4) {
        state.drag = { type: "folder", folder: state.drag.folder, lastX: w.x, lastY: w.y };
        canvas.classList.add("dragging");
      }
      return;
    }
    if (state.drag.type === "toggleSelect") {
      // move turns a shift-press into dragging the selection
      if (Math.hypot(e.clientX - state.drag.sx, e.clientY - state.drag.sy) > 4) {
        state.selection.add(state.drag.group);
        state.drag = { type: "group", groups: [...state.selection], lastX: w.x, lastY: w.y };
        canvas.classList.add("dragging");
        markDirty();
      }
      return;
    }
    if (state.drag.type === "marquee") {
      state.drag.x1 = w.x;
      state.drag.y1 = w.y;
    } else if (state.drag.type === "pan") {
      cam.x = state.drag.cx + (e.clientX - state.drag.sx);
      cam.y = state.drag.cy + (e.clientY - state.drag.sy);
    } else if (state.drag.type === "node") {
      state.drag.node.x = w.x - state.drag.ox;
      state.drag.node.y = w.y - state.drag.oy;
    } else if (state.drag.type === "group") {
      const dx = w.x - state.drag.lastX, dy = w.y - state.drag.lastY;
      for (const g of state.drag.groups) {
        if (g.pinned) continue; // pinned cards stay put
        g.x += dx;
        g.y += dy;
        for (const n of g.ids) {
          n.x += dx;
          n.y += dy;
        }
      }
      state.drag.lastX = w.x;
      state.drag.lastY = w.y;
    } else if (state.drag.type === "folder") {
      const dx = w.x - state.drag.lastX, dy = w.y - state.drag.lastY;
      const f = state.drag.folder;
      if (f.collapsed) {
        f.cardX += dx;
        f.cardY += dy;
      } else {
        for (const g of f.files) {
          if (g.filteredOut || g.hidden) continue;
          g.x += dx;
          g.y += dy;
          for (const n of g.ids) {
            n.x += dx;
            n.y += dy;
          }
        }
      }
      state.drag.lastX = w.x;
      state.drag.lastY = w.y;
    }
    markDirty();
    return;
  }
  const w = screenToWorld(local.x, local.y);
  const ctrl = controlAt(w.x, w.y) || folderControlAt(w.x, w.y);
  if (ctrl) {
    if (!state.hoverButton || state.hoverButton.g !== ctrl.g || state.hoverButton.action !== ctrl.action) {
      state.hoverButton = ctrl;
      markDirty();
    }
    if (ctrl.g !== state.hoverEntity || hoverClearTimer) setHover(ctrl.g);
    showButtonTooltip(e, ctrl);
    return;
  }
  if (state.hoverButton) {
    state.hoverButton = null;
    markDirty();
  }
  const ent = entityAt(w.x, w.y);
  if (ent) setHover(ent);
  else if (state.hoverEntity) setHover(null);
  if (ent) showTooltip(e, ent);
  else hideTooltip();
});

window.addEventListener("mouseup", (e) => endDrag(e));

canvas.addEventListener("mouseleave", () => {
  hideTooltip();
  if (state.hoverButton) {
    state.hoverButton = null;
    markDirty();
  }
  setHover(null, true);
});

canvas.addEventListener("dblclick", (e) => {
  const local = localPos(e);
  const w = screenToWorld(local.x, local.y);
  if (controlAt(w.x, w.y) || folderControlAt(w.x, w.y)) return; // on a control — do not expand
  const ent = entityAt(w.x, w.y);
  if (ent && isGroup(ent)) toggleExpand(ent);
  else if (ent && isFolder(ent)) runFolderControl(ent, "toggle");
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const local = localPos(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(0.02, Math.min(cam.scale * factor, 4));
    const wx = (local.x - cam.x) / cam.scale;
    const wy = (local.y - cam.y) / cam.scale;
    cam.scale = newScale;
    cam.x = local.x - wx * newScale;
    cam.y = local.y - wy * newScale;
    markDirty();
  },
  { passive: false },
);

/** Pointer position relative to the canvas element. */
function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Start dragging a file card (used by on-canvas editor chrome). */
export function beginGroupDrag(g, e) {
  if (!g || g.pinned) return;
  const w = screenToWorld(localPos(e).x, localPos(e).y);
  let set;
  if (state.selection.has(g) && state.selection.size > 0) {
    set = [...state.selection];
  } else {
    if (state.selection.size) markDirty();
    state.selection.clear();
    set = [g];
  }
  state.drag = { type: "group", groups: set, lastX: w.x, lastY: w.y, startSX: e.clientX, startSY: e.clientY };
  canvas.classList.add("dragging");
}

/**
 * Continue a card drag from overlay pointer events. Overlay chrome stops
 * mouse bubbling, so the window mousemove listener never sees the gesture.
 */
export function continueGroupDrag(e) {
  if (!state.drag || state.drag.type !== "group") return;
  const w = screenToWorld(localPos(e).x, localPos(e).y);
  const dx = w.x - state.drag.lastX,
    dy = w.y - state.drag.lastY;
  for (const g of state.drag.groups) {
    if (g.pinned) continue;
    g.x += dx;
    g.y += dy;
    for (const n of g.ids) {
      n.x += dx;
      n.y += dy;
    }
  }
  state.drag.lastX = w.x;
  state.drag.lastY = w.y;
  markDirty();
}

/** Finish a card drag started from overlay chrome (idempotent if already ended). */
export function endGroupDrag(e) {
  endDrag(e);
}

/** Commit the in-flight pointer drag and clear `state.drag`. */
function endDrag(e) {
  if (state.drag) {
    if (state.drag.type === "control") {
      runControl(state.drag.group, state.drag.action);
    } else if (state.drag.type === "folderControl") {
      runFolderControl(state.drag.folder, state.drag.action);
    } else if (state.drag.type === "folder") {
      // click on a folder (collapsed card or expanded island) in follow/lazy mode — focus it
      const moved = Math.hypot(e.clientX - (state.drag.startSX || e.clientX), e.clientY - (state.drag.startSY || e.clientY));
      if ((state.followMode || state.lazyMode) && moved < 4) {
        (state.followMode ? setFollowFocus : setLazyFocus)(state.drag.folder);
      } else {
        saveLayout();
      }
    } else if (state.drag.type === "toggleSelect") {
      if (state.selection.has(state.drag.group)) state.selection.delete(state.drag.group);
      else state.selection.add(state.drag.group);
      markDirty();
    } else if (state.drag.type === "marquee") {
      const x0 = Math.min(state.drag.x0, state.drag.x1), x1 = Math.max(state.drag.x0, state.drag.x1);
      const y0 = Math.min(state.drag.y0, state.drag.y1), y1 = Math.max(state.drag.y0, state.drag.y1);
      if (x1 - x0 > 2 || y1 - y0 > 2) {
        for (const g of state.groups) {
          if (!groupVisible(g)) continue;
          if (g.x < x1 && g.x + g.w > x0 && g.y < y1 && g.y + g.h > y0) state.selection.add(g);
        }
      }
      markDirty();
    } else if (state.drag.type === "node" || state.drag.type === "group") {
      const focusMode = state.followMode || state.lazyMode;
      if (focusMode && state.drag.type === "group" && state.drag.groups && state.drag.groups.length === 1) {
        // if barely moved — treat as a focus click for the mode
        const moved = Math.hypot(e.clientX - (state.drag.startSX || e.clientX), e.clientY - (state.drag.startSY || e.clientY));
        if (moved < 4) (state.followMode ? setFollowFocus : setLazyFocus)(state.drag.groups[0]);
        else saveLayout();
      } else {
        saveLayout();
      }
    } else if (state.drag.type === "pan" && (state.followMode || state.lazyMode)) {
      // click without meaningful move: focus a unit (file/collapsed folder) or clear on background
      if (Math.hypot(e.clientX - state.drag.sx, e.clientY - state.drag.sy) < 4) {
        const local = localPos(e);
        const w = screenToWorld(local.x, local.y);
        const u = focusUnitFromEntity(entityAt(w.x, w.y));
        (state.followMode ? setFollowFocus : setLazyFocus)(u || null);
      }
    }
  }
  state.drag = null;
  canvas.classList.remove("grabbing", "dragging");
}

/** Update hover entity and its neighbor set for edge/card highlighting. */
let hoverClearTimer = 0;
function applyHover(entity) {
  state.hoverEntity = entity;
  state.hoverNeighbors = new Set();
  if (entity) {
    for (const e of state.renderEdges) {
      const other = edgeEndTouches(e.a, entity) ? e.b : edgeEndTouches(e.b, entity) ? e.a : null;
      if (!other) continue;
      state.hoverNeighbors.add(other);
      const card = cardOf(other);
      if (card) state.hoverNeighbors.add(card);
    }
  }
  markDirty();
}

export function setHover(entity, immediate) {
  if (entity) {
    if (hoverClearTimer) {
      clearTimeout(hoverClearTimer);
      hoverClearTimer = 0;
    }
    if (entity === state.hoverEntity) return;
    applyHover(entity);
    return;
  }
  if (hoverClearTimer) {
    clearTimeout(hoverClearTimer);
    hoverClearTimer = 0;
  }
  if (!immediate) {
    if (!hoverClearTimer) {
      hoverClearTimer = setTimeout(() => {
        hoverClearTimer = 0;
        applyHover(null);
      }, 100);
    }
    return;
  }
  applyHover(null);
}

/** Show the HTML tooltip for a hovered folder, file, or function. */
function showTooltip(e, ent) {
  tooltip.hidden = false;
  if (isFolder(ent)) {
    tooltip.innerHTML = `<b>${escapeHtml(ent.name)}</b> <span class="muted">${t("tt_folder")}${ent.collapsed ? t("tt_folder_collapsed") : ""}</span><br><span class="muted">${escapeHtml(ent.key)}</span><br><span class="muted">${t("tt_folder_meta", { files: ent.files.length, links: state.hoverNeighbors.size })}</span>`;
    tooltip.style.left = e.clientX + 14 + "px";
    tooltip.style.top = e.clientY + 14 + "px";
    return;
  }
  if (isGroup(ent)) {
    tooltip.innerHTML = `<b>${escapeHtml(basename(ent.path))}</b> <span class="muted">${t("tt_file")}</span><br><span class="muted">${escapeHtml(ent.path)}</span><br><span class="muted">${t("tt_file_meta", { fns: ent.ids.length, links: state.hoverNeighbors.size })}</span>`;
  } else {
    tooltip.innerHTML = `<b>${escapeHtml(ent.name)}</b> <span class="muted">${ent.kind}</span><br><span class="muted">${escapeHtml(ent.file)}:${ent.line}</span><br><span class="muted">${t("tt_node_links", { n: ent.deg })}</span>`;
  }
  tooltip.style.left = e.clientX + 14 + "px";
  tooltip.style.top = e.clientY + 14 + "px";
}
/** Show a tooltip for the control button under the cursor. */
function showButtonTooltip(e, ctrl) {
  tooltip.hidden = false;
  const label = isFolder(ctrl.g) ? FOLDER_CTRL_LABEL[ctrl.action](ctrl.g) : CTRL_LABEL[ctrl.action](ctrl.g);
  tooltip.innerHTML = `<b>${escapeHtml(label)}</b>`;
  tooltip.style.left = e.clientX + 14 + "px";
  tooltip.style.top = e.clientY + 14 + "px";
}
/** Hide the floating tooltip. */
function hideTooltip() {
  tooltip.hidden = true;
}
