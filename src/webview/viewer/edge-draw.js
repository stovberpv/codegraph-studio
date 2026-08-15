/*
 * Paint aggregated renderEdges: file-file curves, optional cold island bundles
 * for speck pairs, and hover/highlight strokes. Hover never restyles bundles.
 */
import { ctx } from "./dom.js";
import { state, cam } from "./state.js";
import { ISLAND_ANCHOR_R, MIN_EDGE_CARD_PX } from "./constants.js";
import { cardOf, edgeEndTouches, isFolder, isGroup, isHi } from "./utils.js";
import { groupVisible } from "./visibility.js";
import { addCurve, addCurveFast, drawArrow } from "./edge-geometry.js";
import { edgeAlpha, pal, rgba } from "./palette.js";

const lerp = (a, b, t) => a + (b - a) * t;

/** Layout island id for a drawable endpoint (file, function, or folder card). */
function islandKeyOf(ent) {
  if (!ent) return null;
  if (isFolder(ent)) return ent.key;
  if (isGroup(ent)) return ent.island || null;
  return (ent.group && ent.group.island) || null;
}

/** True when the file/folder card is too small on screen for a file-file curve. */
function isSpeck(ent) {
  const card = cardOf(ent);
  return !!card && (card.h || 0) * cam.scale < MIN_EDGE_CARD_PX;
}

function isHotEdge(a, b, hover) {
  if (hover && (edgeEndTouches(a, hover) || edgeEndTouches(b, hover))) return true;
  return !!(state.highlight.size && (isHi(a) || isHi(b)));
}

/**
 * Compact centroid proxy per island (not the full hull). Hull-to-hull curves
 * attach to the AABB edge and look like fake links to whatever card sits there.
 */
function islandAnchors() {
  const acc = new Map();
  for (const g of state.groups) {
    if (!groupVisible(g) || !g.island) continue;
    let s = acc.get(g.island);
    if (!s) {
      s = { sx: 0, sy: 0, n: 0 };
      acc.set(g.island, s);
    }
    s.sx += g.x + g.w / 2;
    s.sy += g.y + g.h / 2;
    s.n++;
  }
  const out = new Map();
  const r = ISLAND_ANCHOR_R;
  for (const [k, s] of acc) {
    if (!s.n) continue;
    out.set(k, { x: s.sx / s.n - r, y: s.sy / s.n - r, w: r * 2, h: r * 2 });
  }
  return out;
}

/**
 * Draw call/import strokes. Cold cross-island speck pairs may collapse to one
 * centroid curve per island pair; hover/highlight always uses real file-file
 * geometry for incident edges and leaves bundles dim.
 */
export function drawEdges(inView, dimAmt) {
  const bundleCold = !!state.edgeLod;
  const hover = state.hoverEntity;
  const drawList = [];
  const pairs = new Map();

  for (const e of state.renderEdges) {
    const a = e.a;
    const b = e.b;
    const isImport = e.kind === "import";
    const isHot = isHotEdge(a, b, hover);

    const ia = islandKeyOf(a);
    const ib = islandKeyOf(b);
    if (bundleCold && !isHot && isSpeck(a) && isSpeck(b) && ia && ib && ia !== ib) {
      const key = ia < ib ? ia + "\u0000" + ib : ib + "\u0000" + ia;
      let p = pairs.get(key);
      if (!p) {
        p = { ia, ib, kind: isImport ? "import" : "call" };
        pairs.set(key, p);
      }
      if (!isImport) p.kind = "call";
      continue;
    }

    const aIn = inView(a.x, a.y, a.w, a.h);
    const bIn = inView(b.x, b.y, b.w, b.h);
    if (!isHot && !aIn && !bIn) continue;
    drawList.push({ a, b, isHot, isImport });
  }

  const callPath = new Path2D();
  const importPath = new Path2D();
  const hot = [];
  for (const c of drawList) {
    if (c.isHot) {
      hot.push(c);
      continue;
    }
    if (c.isImport) addCurve(importPath, c.a, c.b);
    else addCurve(callPath, c.a, c.b);
  }

  ctx.lineWidth = 1.15 / cam.scale;
  ctx.strokeStyle = rgba(pal.textDim, lerp(edgeAlpha.call[0], edgeAlpha.call[1], dimAmt));
  ctx.stroke(callPath);
  ctx.strokeStyle = rgba(pal.edgeImport, lerp(edgeAlpha.import[0], edgeAlpha.import[1], dimAmt));
  ctx.stroke(importPath);

  if (hot.length) {
    ctx.lineWidth = 1.6 / cam.scale;
    for (const c of hot) {
      const p = new Path2D();
      addCurve(p, c.a, c.b);
      if (c.isImport) {
        ctx.strokeStyle = rgba(pal.edgeImportHot, edgeAlpha.hotImport);
        ctx.stroke(p);
      } else {
        ctx.strokeStyle = rgba(pal.accentHover, edgeAlpha.hotCall);
        ctx.stroke(p);
        drawArrow(c.a, c.b, rgba(pal.accentHover, edgeAlpha.arrow));
      }
    }
  }

  if (!pairs.size) return;
  const anchors = islandAnchors();
  const bCall = new Path2D();
  const bImport = new Path2D();
  for (const p of pairs.values()) {
    const a = anchors.get(p.ia);
    const b = anchors.get(p.ib);
    if (!a || !b) continue;
    if (!inView(a.x, a.y, a.w, a.h) && !inView(b.x, b.y, b.w, b.h)) continue;
    if (p.kind === "import") addCurveFast(bImport, a, b);
    else addCurveFast(bCall, a, b);
  }
  ctx.lineWidth = 1.2 / cam.scale;
  ctx.strokeStyle = rgba(pal.textDim, lerp(edgeAlpha.bundleCall[0], edgeAlpha.bundleCall[1], dimAmt));
  ctx.stroke(bCall);
  ctx.strokeStyle = rgba(pal.edgeImport, lerp(edgeAlpha.bundleImport[0], edgeAlpha.bundleImport[1], dimAmt));
  ctx.stroke(bImport);
}
