/*
 * Full scene draw: folder islands/cards, file cards and their header controls,
 * aggregated edges (with hot-path highlight), expanded functions, the marquee,
 * and the CodeMirror overlay sync.
 */
import { canvas, ctx } from "./dom.js";
import { state, cam, nodes } from "./state.js";
import { BTN, CTRL_GAP, FOLDER_ACTIONS, FOLDER_HEAD, HEADER_H, ICON_ZOOM, TITLE_H } from "./constants.js";
import { isFolder } from "./utils.js";
import { isEdited } from "./edited.js";
import { t } from "./i18n.js";
import { folderVisible, groupVisible, nodeVisible } from "./visibility.js";
import { ensureFolderBoxes } from "./folders.js";
import { controlRects, drawIcon, folderControlRects, folderIconFor, iconFor } from "./icons.js";
import { roundRect } from "./edge-geometry.js";
import { drawEdges } from "./edge-draw.js";
import { mixHex, pal, rgba, edgeAlpha } from "./palette.js";

const lerp = (a, b, t) => a + (b - a) * t;

function hoverDimTarget() {
  const h = state.hoverEntity;
  const dimHover = h && !(isFolder(h) && !h.collapsed);
  return dimHover || state.highlight.size ? 1 : 0;
}

/** True while the rest-of-graph dim is still easing toward its target. */
export function hoverNeedsTick() {
  return Math.abs(state.hoverDim - hoverDimTarget()) > 0.002;
}

let hoverDimAt = 0;
function stepHoverDim(now) {
  const target = hoverDimTarget();
  let dt;
  if (!hoverDimAt) {
    hoverDimAt = now;
    dt = 0.016;
  } else {
    dt = Math.min(0.05, Math.max(0, (now - hoverDimAt) / 1000));
    hoverDimAt = now;
  }
  const tau = target > state.hoverDim ? 0.07 : 0.12;
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  const next = state.hoverDim + (target - state.hoverDim) * k;
  if (Math.abs(next - target) < 0.004) state.hoverDim = target;
  else state.hoverDim = next;
}

/** Draw folder header control icons (and hover chrome) at sufficient zoom. */
function drawFolderControls(f) {
  if (cam.scale <= ICON_ZOOM) return;
  for (const r of folderControlRects(f)) {
    const isBtnHover = state.hoverButton && state.hoverButton.g === f && state.hoverButton.action === r.action;
    const activeState =
      (r.action === "hideIncoming" && f.hideIncoming) || (r.action === "hideOutgoing" && f.hideOutgoing);
    if (isBtnHover) {
      roundRect(r.x - 2, r.y - 2, BTN + 4, BTN + 4, 4);
      ctx.fillStyle = pal.accentWash;
      ctx.fill();
    }
    const color = activeState ? pal.accentHover : isBtnHover ? pal.text : `hsl(${f.hue},40%,72%)`;
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
    ctx.strokeStyle = isHover ? pal.accentHover : `hsla(${hue},45%,45%,0.85)`;
    ctx.stroke();
    if (!showText) return;
    ctx.lineWidth = 1 / cam.scale;
    ctx.strokeStyle = `hsla(${hue},40%,40%,0.45)`;
    ctx.beginPath();
    ctx.moveTo(f.x + 8, f.y + FOLDER_HEAD);
    ctx.lineTo(f.x + f.w - 8, f.y + FOLDER_HEAD);
    ctx.stroke();
    ctx.fillStyle = pal.textDim;
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
    ctx.fillStyle = pal.textDim;
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
  ctx.strokeStyle = isHover ? pal.accentHover : `hsla(${hue},40%,42%,0.4)`;
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
export function render(now = performance.now()) {
  state.dirty = false;
  stepHoverDim(now);
  const dimAmt = state.hoverDim;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pal.bg;
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

  const dimHover = state.hoverEntity && !(isFolder(state.hoverEntity) && !state.hoverEntity.collapsed);

  // folders: islands (expanded) and compact cards (collapsed)
  if (state.layoutMode === "folder") {
    ensureFolderBoxes();
    for (const f of state.folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      if (!inView(f.x, f.y, f.w, f.h)) continue;
      const isHover = f === state.hoverEntity;
      drawFolder(f, isHover);
    }
  }

  // cards (background)
  for (const g of state.groups) {
    if (!groupVisible(g)) continue;
    if (!inView(g.x, g.y, g.w, g.h)) continue;
    const isHover = g === state.hoverEntity;
    const isNeighbor = state.hoverNeighbors.has(g);
    const isMatch = state.highlightGroups.has(g);
    const rest = (dimHover && !isHover && !isNeighbor) || (state.highlight.size && !isMatch);
    const dim = rest ? dimAmt : 0;
    const edited = isEdited(g.path);
    // Zen mode: only edited files keep their hue; everything else desaturates
    const sat = state.zenMode && !edited ? 0 : 1;

    roundRect(g.x, g.y, g.w, g.h, 9);
    ctx.fillStyle = `hsla(${g.hue},${lerp(34, 22, dim) * sat}%,${lerp(17, 13, dim)}%,${lerp(0.72, 0.5, dim)})`;
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover
      ? pal.accentHover
      : isMatch
        ? pal.statusDirty
        : `hsla(${g.hue},${lerp(45, 8, dim) * sat}%,${lerp(45, 32, dim)}%,${lerp(0.75, 0.5, dim)})`;
    ctx.stroke();

    if (state.selection.has(g)) {
      ctx.lineWidth = 2.5 / cam.scale;
      ctx.strokeStyle = pal.accentSoft;
      roundRect(g.x - 2.5, g.y - 2.5, g.w + 5, g.h + 5, 11);
      ctx.stroke();
    }

    if (cam.scale > 0.1 && !g.editing) {
      // divider under the header (the editor overlay owns the header when open)
      ctx.lineWidth = 1 / cam.scale;
      ctx.strokeStyle = `hsla(${g.hue},${lerp(40, 8, dim) * sat}%,${lerp(40, 32, dim)}%,${lerp(0.4, 0.35, dim)})`;
      ctx.beginPath();
      ctx.moveTo(g.x + 8, g.y + HEADER_H);
      ctx.lineTo(g.x + g.w - 8, g.y + HEADER_H);
      ctx.stroke();

      // header: extension on the left
      if (g.ext) {
        ctx.fillStyle = mixHex(pal.textDim, pal.textDimDeep, dim);
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
            ctx.fillStyle = pal.accentWash;
            ctx.fill();
          }
          const color =
            dim < 0.45 && activeState
              ? pal.accentHover
              : dim < 0.45 && isBtnHover
                ? pal.text
                : `hsl(${g.hue},${lerp(40, 8, dim) * sat}%,${lerp(70, 38, dim)}%)`;
          drawIcon(iconFor(g, r.action), r.x, r.y, color, (activeState || isBtnHover) && dim < 0.45);
        }
      }

      // body: file name without extension
      {
        ctx.fillStyle = `hsl(${g.hue},${lerp(52, 8, dim) * sat}%,${lerp(78, 42, dim)}%)`;
        ctx.font = "13px ui-monospace, monospace";
        ctx.save();
        ctx.beginPath();
        // leave room for the edited dot on the right when present
        ctx.rect(g.x + 8, g.y + HEADER_H, g.w - 16 - (edited ? 10 : 0), TITLE_H);
        ctx.clip();
        ctx.fillText(g.name, g.x + 10, g.y + HEADER_H + 16);
        ctx.restore();

        // edited marker: a small dot in the title row (kept even in Zen mode)
        if (edited) {
          ctx.beginPath();
          ctx.arc(g.x + g.w - 12, g.y + HEADER_H + 11, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = pal.editedDot;
          ctx.fill();
        }

        if (!g.expanded) {
          ctx.fillStyle = mixHex(pal.textDim, pal.textDimDeep, dim);
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillText(`${g.ids.length} fn`, g.x + 10, g.y + HEADER_H + TITLE_H + 12);
          ctx.font = "13px ui-monospace, monospace";
        }
      }
    }
  }

  drawEdges(inView, dimAmt);

  // functions of expanded cards (do not draw under an open editor)
  const showText = cam.scale > 0.3;
  for (const n of nodes.values()) {
    if (!nodeVisible(n) || !n.group.expanded || n.group.editing) continue;
    if (!inView(n.x, n.y, n.w, n.h)) continue;
    const isHover = n === state.hoverEntity;
    const isNeighbor = state.hoverNeighbors.has(n);
    const isMatch = state.highlight.has(n.id);
    const rest = (dimHover && !isHover && !isNeighbor) || (state.highlight.size && !isMatch);
    const dim = rest ? dimAmt : 0;
    roundRect(n.x, n.y, n.w, n.h, 6);
    const hue = n.group.hue;
    const nsat = state.zenMode && !isEdited(n.group.path) ? 0 : 1;
    if (isHover) ctx.fillStyle = pal.fnHover;
    else if (isMatch) ctx.fillStyle = pal.fnMatch;
    else ctx.fillStyle = mixHex(pal.fnBg, pal.fnBgDim, dim);
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover
      ? pal.accentHover
      : isMatch
        ? pal.statusDirty
        : `hsla(${hue},${lerp(45, 8, dim) * nsat}%,${lerp(55, 32, dim)}%,${lerp(0.8, 0.5, dim)})`;
    ctx.stroke();
    if (showText) {
      ctx.fillStyle = mixHex(pal.text, pal.icon, dim);
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
    ctx.fillStyle = rgba(pal.accentHover, edgeAlpha.marqueeFill);
    ctx.strokeStyle = rgba(pal.accentSoft, edgeAlpha.marqueeStroke);
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
