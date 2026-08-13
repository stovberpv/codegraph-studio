/*
 * Edge curve geometry and small canvas path helpers (bezier attachment sides,
 * arrowheads, rounded rectangles).
 */
import { ctx } from "./dom.js";
import { cam } from "./state.js";

// Attachment side is chosen by the dominant axis between card centers:
// horizontal → left/right edge, vertical → top/bottom. Control points
// pull the curve perpendicular to that side, so for nearby
// vertically stacked blocks the link does not "dive" back inside.
/** Bezier control points and end angle for an edge between two boxes. */
export function edgeGeom(a, b) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // horizontal attachment (left/right edge)
    const sx = dx >= 0 ? a.x + a.w : a.x;
    const tx = dx >= 0 ? b.x : b.x + b.w;
    const mx = (sx + tx) / 2;
    return { sx, sy: acy, tx, ty: bcy, c1x: mx, c1y: acy, c2x: mx, c2y: bcy, ang: dx >= 0 ? 0 : Math.PI };
  }
  // vertical attachment (top/bottom)
  const sy = dy >= 0 ? a.y + a.h : a.y;
  const ty = dy >= 0 ? b.y : b.y + b.h;
  const my = (sy + ty) / 2;
  return { sx: acx, sy, tx: bcx, ty, c1x: acx, c1y: my, c2x: bcx, c2y: my, ang: dy >= 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/** Append a cubic edge curve from a to b onto a Path2D. */
export function addCurve(path, a, b) {
  const p = edgeGeom(a, b);
  path.moveTo(p.sx, p.sy);
  path.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
}

/** Draw an arrowhead at the end of the edge from a to b. */
export function drawArrow(a, b, color) {
  const p = edgeGeom(a, b);
  // approach the side perpendicularly (curve tangent at end matches ang)
  const ang = p.ang;
  const size = 8 / cam.scale;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p.tx, p.ty);
  ctx.lineTo(p.tx - size * Math.cos(ang - 0.4), p.ty - size * Math.sin(ang - 0.4));
  ctx.lineTo(p.tx - size * Math.cos(ang + 0.4), p.ty - size * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

/** Begin a rounded-rectangle path on the canvas context. */
export function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
