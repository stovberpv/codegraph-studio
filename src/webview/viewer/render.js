/*
 * Full scene draw: folder islands/cards, file cards and their header controls,
 * aggregated edges (with hot-path highlight), expanded functions, the marquee,
 * and the CodeMirror overlay sync.
 */
import { canvas, ctx } from "./dom.js";
import { state, cam, nodes } from "./state.js";
import { BTN, CTRL_GAP, FOLDER_ACTIONS, FOLDER_HEAD, HEADER_H, ICON_ZOOM, TITLE_H } from "./constants.js";
import { isFolder, isHi } from "./utils.js";
import { t } from "./i18n.js";
import { folderVisible, groupVisible, nodeVisible } from "./visibility.js";
import { ensureFolderBoxes } from "./folders.js";
import { controlRects, drawIcon, folderControlRects, folderIconFor, iconFor } from "./icons.js";
import { addCurve, drawArrow, roundRect } from "./edge-geometry.js";

/** Draw folder header control icons (and hover chrome) at sufficient zoom. */
function drawFolderControls(f) {
  if (cam.scale <= ICON_ZOOM) return;
  for (const r of folderControlRects(f)) {
    const isBtnHover = state.hoverButton && state.hoverButton.g === f && state.hoverButton.action === r.action;
    const activeState =
      (r.action === "hideIncoming" && f.hideIncoming) || (r.action === "hideOutgoing" && f.hideOutgoing);
    if (isBtnHover) {
      roundRect(r.x - 2, r.y - 2, BTN + 4, BTN + 4, 4);
      ctx.fillStyle = "rgba(90,160,255,0.18)";
      ctx.fill();
    }
    const color = activeState ? "#5aa0ff" : isBtnHover ? "#e6edf3" : `hsl(${f.hue},40%,72%)`;
    drawIcon(folderIconFor(f, r.action), r.x, r.y, color, activeState || isBtnHover);
  }
}

/** Paint a folder as a collapsed card or expanded island backdrop. */
function drawFolder(f, isHover) {
  const hue = f.hue;
  const showText = cam.scale > 0.1;
  if (f.collapsed) {
    roundRect(f.x, f.y, f.w, f.h, 10);
    ctx.fillStyle = `hsla(${hue},34%,17%,0.92)`;
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover ? "#5aa0ff" : `hsla(${hue},45%,45%,0.85)`;
    ctx.stroke();
    if (!showText) return;
    ctx.lineWidth = 1 / cam.scale;
    ctx.strokeStyle = `hsla(${hue},40%,40%,0.45)`;
    ctx.beginPath();
    ctx.moveTo(f.x + 8, f.y + FOLDER_HEAD);
    ctx.lineTo(f.x + f.w - 8, f.y + FOLDER_HEAD);
    ctx.stroke();
    ctx.fillStyle = "#8b97a4";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText("dir", f.x + 10, f.y + FOLDER_HEAD / 2 + 4);
    drawFolderControls(f);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x + 8, f.y + FOLDER_HEAD, f.w - 16, f.h - FOLDER_HEAD);
    ctx.clip();
    ctx.fillStyle = `hsl(${hue},52%,80%)`;
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText(f.name, f.x + 10, f.y + FOLDER_HEAD + 16);
    ctx.fillStyle = "#8b97a4";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(t("folder_files_count", { n: f.files.length }), f.x + 10, f.y + FOLDER_HEAD + 32);
    ctx.restore();
    ctx.font = "13px ui-monospace, monospace";
    return;
  }
  // expanded island
  roundRect(f.x, f.y, f.w, f.h, 14);
  ctx.fillStyle = `hsla(${hue},28%,18%,0.22)`;
  ctx.fill();
  ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
  ctx.strokeStyle = isHover ? "#5aa0ff" : `hsla(${hue},40%,42%,0.4)`;
  ctx.stroke();
  if (!showText) return;
  ctx.lineWidth = 1 / cam.scale;
  ctx.strokeStyle = `hsla(${hue},40%,40%,0.35)`;
  ctx.beginPath();
  ctx.moveTo(f.x + 8, f.y + FOLDER_HEAD);
  ctx.lineTo(f.x + f.w - 8, f.y + FOLDER_HEAD);
  ctx.stroke();
  // path label on the left (clip to free space before controls)
  const ctrlW = FOLDER_ACTIONS.length * (BTN + CTRL_GAP) + 12;
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x + 8, f.y, f.w - 16 - ctrlW, FOLDER_HEAD);
  ctx.clip();
  ctx.fillStyle = `hsla(${hue},42%,72%,0.95)`;
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(f.key === "." ? "/" : f.key, f.x + 10, f.y + FOLDER_HEAD / 2 + 4);
  ctx.restore();
  ctx.font = "13px ui-monospace, monospace";
  drawFolderControls(f);
}

/** Full scene draw: folders, cards, edges, functions, marquee, editor sync. */
export function render() {
  state.dirty = false;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0e1116";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(state.dpr * cam.scale, 0, 0, state.dpr * cam.scale, state.dpr * cam.x, state.dpr * cam.y);
  ctx.font = "13px ui-monospace, monospace";
  ctx.textBaseline = "alphabetic";

  const view = {
    x0: -cam.x / cam.scale,
    y0: -cam.y / cam.scale,
    x1: (cw - cam.x) / cam.scale,
    y1: (ch - cam.y) / cam.scale,
  };
  const inView = (x, y, w, h) => x + w >= view.x0 && x <= view.x1 && y + h >= view.y0 && y <= view.y1;

  const active = state.hoverEntity || state.highlight.size;
  // hovering an expanded folder does not dim files (it has no edge endpoints)
  const dimHover = state.hoverEntity && !(isFolder(state.hoverEntity) && !state.hoverEntity.collapsed);

  // folders: islands (expanded) and compact cards (collapsed)
  if (state.layoutMode === "folder") {
    ensureFolderBoxes();
    for (const f of state.folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      if (!inView(f.x, f.y, f.w, f.h)) continue;
      const isHover = f === state.hoverEntity;
      drawFolder(f, isHover, inView);
    }
  }

  // cards (background)
  for (const g of state.groups) {
    if (!groupVisible(g)) continue;
    if (!inView(g.x, g.y, g.w, g.h)) continue;
    const isHover = g === state.hoverEntity;
    const isNeighbor = state.hoverNeighbors.has(g);
    const isMatch = state.highlightGroups.has(g);
    const dim = (dimHover && !isHover && !isNeighbor) || (state.highlight.size && !isMatch);

    roundRect(g.x, g.y, g.w, g.h, 9);
    ctx.fillStyle = dim ? `hsla(${g.hue},22%,13%,0.5)` : `hsla(${g.hue},34%,17%,0.72)`;
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover
      ? "#5aa0ff"
      : isMatch
        ? "#e0a83d"
        : dim
          ? "rgba(70,80,92,0.5)"
          : `hsla(${g.hue},45%,45%,0.75)`;
    ctx.stroke();

    if (state.selection.has(g)) {
      ctx.lineWidth = 2.5 / cam.scale;
      ctx.strokeStyle = "#7aa2ff";
      roundRect(g.x - 2.5, g.y - 2.5, g.w + 5, g.h + 5, 11);
      ctx.stroke();
    }

    if (cam.scale > 0.1) {
      // divider under the header
      ctx.lineWidth = 1 / cam.scale;
      ctx.strokeStyle = dim ? "rgba(70,80,92,0.35)" : `hsla(${g.hue},40%,40%,0.4)`;
      ctx.beginPath();
      ctx.moveTo(g.x + 8, g.y + HEADER_H);
      ctx.lineTo(g.x + g.w - 8, g.y + HEADER_H);
      ctx.stroke();

      // header: extension on the left
      if (g.ext) {
        ctx.fillStyle = dim ? "#454e58" : "#8b97a4";
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(g.ext, g.x + 10, g.y + HEADER_H / 2 + 4);
      }

      // header: control icons on the right (only at sufficient zoom)
      if (cam.scale > ICON_ZOOM) {
        for (const r of controlRects(g)) {
          const isBtnHover = state.hoverButton && state.hoverButton.g === g && state.hoverButton.action === r.action;
          const activeState =
            (r.action === "edit" && g.editing) ||
            (r.action === "pin" && g.pinned) ||
            (r.action === "hideIncoming" && g.hideIncoming) ||
            (r.action === "hideOutgoing" && g.hideOutgoing);
          if (isBtnHover) {
            roundRect(r.x - 2, r.y - 2, BTN + 4, BTN + 4, 4);
            ctx.fillStyle = "rgba(90,160,255,0.18)";
            ctx.fill();
          }
          const color = dim
            ? "#556070"
            : activeState
              ? "#5aa0ff"
              : isBtnHover
                ? "#e6edf3"
                : `hsl(${g.hue},40%,70%)`;
          drawIcon(iconFor(g, r.action), r.x, r.y, color, activeState || isBtnHover);
        }
      }

      // body: file name without extension (skip when editor is open)
      if (!g.editing) {
        ctx.fillStyle = dim ? "#5b6672" : `hsl(${g.hue},52%,78%)`;
        ctx.font = "13px ui-monospace, monospace";
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x + 8, g.y + HEADER_H, g.w - 16, TITLE_H);
        ctx.clip();
        ctx.fillText(g.name, g.x + 10, g.y + HEADER_H + 16);
        ctx.restore();

        if (!g.expanded) {
          ctx.fillStyle = dim ? "#454e58" : "#8b97a4";
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillText(`${g.ids.length} fn`, g.x + 10, g.y + HEADER_H + TITLE_H + 12);
          ctx.font = "13px ui-monospace, monospace";
        }
      }
    }
  }

  // edges (aggregated) — normal ones as a single path
  ctx.lineWidth = 1 / cam.scale;
  ctx.strokeStyle = active ? "rgba(120,135,150,0.10)" : "rgba(120,135,150,0.26)";
  const normal = new Path2D();
  const hot = [];
  for (const e of state.renderEdges) {
    const a = e.a, b = e.b;
    const isHot =
      (state.hoverEntity && (a === state.hoverEntity || b === state.hoverEntity)) ||
      (state.highlight.size && (isHi(a) || isHi(b)));
    if (
      !isHot &&
      !inView(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x) + a.w, Math.abs(a.y - b.y) + a.h)
    )
      continue;
    if (isHot) {
      hot.push(e);
      continue;
    }
    addCurve(normal, a, b);
  }
  ctx.stroke(normal);

  if (hot.length) {
    ctx.strokeStyle = "rgba(90,160,255,0.9)";
    ctx.lineWidth = 1.6 / cam.scale;
    for (const e of hot) {
      const p = new Path2D();
      addCurve(p, e.a, e.b);
      ctx.stroke(p);
      drawArrow(e.a, e.b, "rgba(90,160,255,0.95)");
    }
  }

  // functions of expanded cards (do not draw under an open editor)
  const showText = cam.scale > 0.3;
  for (const n of nodes.values()) {
    if (!nodeVisible(n) || !n.group.expanded || n.group.editing) continue;
    if (!inView(n.x, n.y, n.w, n.h)) continue;
    const isHover = n === state.hoverEntity;
    const isNeighbor = state.hoverNeighbors.has(n);
    const isMatch = state.highlight.has(n.id);
    const dim = (dimHover && !isHover && !isNeighbor) || (state.highlight.size && !isMatch);
    roundRect(n.x, n.y, n.w, n.h, 6);
    const hue = n.group.hue;
    if (isHover) ctx.fillStyle = "#2a3546";
    else if (isMatch) ctx.fillStyle = "#3a2f12";
    else ctx.fillStyle = dim ? "#171b21" : "#1c232c";
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover
      ? "#5aa0ff"
      : isMatch
        ? "#e0a83d"
        : dim
          ? "rgba(70,80,92,0.5)"
          : `hsla(${hue},45%,55%,0.8)`;
    ctx.stroke();
    if (showText) {
      ctx.fillStyle = dim ? "#5b6672" : "#e6edf3";
      ctx.save();
      ctx.beginPath();
      ctx.rect(n.x + 6, n.y, n.w - 12, n.h);
      ctx.clip();
      ctx.fillText(n.name, n.x + 8, n.y + 16);
      ctx.restore();
    }
  }

  // selection marquee
  if (state.drag && state.drag.type === "marquee") {
    const mx = Math.min(state.drag.x0, state.drag.x1), my = Math.min(state.drag.y0, state.drag.y1);
    const mw = Math.abs(state.drag.x1 - state.drag.x0), mh = Math.abs(state.drag.y1 - state.drag.y0);
    ctx.fillStyle = "rgba(90,160,255,0.10)";
    ctx.strokeStyle = "rgba(122,162,255,0.85)";
    ctx.lineWidth = 1 / cam.scale;
    ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
    roundRect(mx, my, mw, mh, 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // CodeMirror overlays follow the camera
  if (window.__cgEditor && typeof window.__cgEditor.sync === "function") {
    window.__cgEditor.sync();
  }
}
