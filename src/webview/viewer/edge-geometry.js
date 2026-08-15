/*
 * Edge curve geometry and small canvas path helpers (bezier attachment sides,
 * arrowheads, rounded rectangles).
 */
import { COLLIDE_GAP } from "./constants.js";
import { ctx } from "./dom.js";
import { cam } from "./state.js";

// Side midpoints + outward normals (world space). Order: right, left, bottom, top.
const SIDES = [
  { nx: 1, ny: 0, ang: 0 },
  { nx: -1, ny: 0, ang: Math.PI },
  { nx: 0, ny: 1, ang: Math.PI / 2 },
  { nx: 0, ny: -1, ang: -Math.PI / 2 },
];

const lastPair = new WeakMap();

/** Midpoint of side `i` on box `box`. */
function port(box, i) {
  const s = SIDES[i];
  if (s.nx === 1) return { x: box.x + box.w, y: box.y + box.h / 2 };
  if (s.nx === -1) return { x: box.x, y: box.y + box.h / 2 };
  if (s.ny === 1) return { x: box.x + box.w / 2, y: box.y + box.h };
  return { x: box.x + box.w / 2, y: box.y };
}

/** True if (x,y) is strictly inside the box inset by `pad` (border ports stay outside). */
function insideInset(box, x, y, pad) {
  return x > box.x + pad && x < box.x + box.w - pad && y > box.y + pad && y < box.y + box.h - pad;
}

/** Point on cubic Bezier at parameter t. */
function cubicAt(sx, sy, c1x, c1y, c2x, c2y, tx, ty, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * sx + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * tx,
    y: uu * u * sy + 3 * uu * t * c1y + 3 * u * tt * c2y + tt * t * ty,
  };
}

/**
 * Cubic between two side ports. Stubs go along the outward normals. When the
 * chord is nearly collinear with those normals the cubic is a straight line —
 * shift both handles the same way perpendicular to the chord so long links bow.
 */
function cubicPair(a, b, ia, ib, pull) {
  const sa = SIDES[ia];
  const sb = SIDES[ib];
  const pa = port(a, ia);
  const pb = port(b, ib);
  let c1x = pa.x + sa.nx * pull;
  let c1y = pa.y + sa.ny * pull;
  let c2x = pb.x + sb.nx * pull;
  let c2y = pb.y + sb.ny * pull;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 220) {
    const inv = 1 / dist;
    const cx = dx * inv;
    const cy = dy * inv;
    const align = Math.min(Math.abs(cx * sa.nx + cy * sa.ny), Math.abs(cx * sb.nx + cy * sb.ny));
    if (align > 0.72) {
      const bow = dist * 0.12;
      c1x += -cy * bow;
      c1y += cx * bow;
      c2x += -cy * bow;
      c2y += cx * bow;
    }
  }
  return {
    sx: pa.x,
    sy: pa.y,
    tx: pb.x,
    ty: pb.y,
    c1x,
    c1y,
    c2x,
    c2y,
    ang: sb.ang + Math.PI,
    ia,
    ib,
  };
}

/** How many interior cubic samples sit inside either box (skip near-port hits). */
function cubicClipHits(a, b, g, steps) {
  let n = 0;
  for (let i = 2; i < steps - 1; i++) {
    const p = cubicAt(g.sx, g.sy, g.c1x, g.c1y, g.c2x, g.c2y, g.tx, g.ty, i / steps);
    if (insideInset(a, p.x, p.y, 2) || insideInset(b, p.x, p.y, 2)) n++;
  }
  return n;
}

/** Angle (rad) between outward normal and the chord to a later point on the curve. */
function headingAway(px, py, nx, ny, qx, qy) {
  const vx = qx - px;
  const vy = qy - py;
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return Math.PI;
  const c = Math.max(-1, Math.min(1, (vx * nx + vy * ny) / mag));
  return Math.acos(c);
}

function exitKink(g, sa, sb) {
  const p = cubicAt(g.sx, g.sy, g.c1x, g.c1y, g.c2x, g.c2y, g.tx, g.ty, 0.2);
  const q = cubicAt(g.sx, g.sy, g.c1x, g.c1y, g.c2x, g.c2y, g.tx, g.ty, 0.8);
  return (
    headingAway(g.sx, g.sy, sa.nx, sa.ny, p.x, p.y) + headingAway(g.tx, g.ty, sb.nx, sb.ny, q.x, q.y)
  );
}

function controlLen(g) {
  return (
    Math.hypot(g.c1x - g.sx, g.c1y - g.sy) +
    Math.hypot(g.c2x - g.c1x, g.c2y - g.c1y) +
    Math.hypot(g.tx - g.c2x, g.ty - g.c2y)
  );
}

/**
 * Stub length along the outward normals. Facing ports: don't overshoot the gap.
 * Otherwise a same-side / inbound bow that grows with span (a fixed 80px stub
 * on a long chord reads as a straight line).
 */
function stubPull(dist, alongA, alongB) {
  if (alongA > 0 && alongB > 0) return Math.max(4, Math.min(dist / 2, alongA, alongB));
  return Math.max(24, dist * 0.25);
}

function getSticky(a, b) {
  const m = lastPair.get(a);
  return m ? m.get(b) : null;
}

function setSticky(a, b, ia, ib) {
  let m = lastPair.get(a);
  if (!m) {
    m = new WeakMap();
    lastPair.set(a, m);
  }
  m.set(b, { ia, ib });
}

/**
 * Bezier between two boxes: try every pair of side midpoints, one stub length
 * each, pick the lowest cost.
 *
 *   clips × 10000     through a card
 *   + control length  shorter route
 *   + exit kink       sharp fold right after the port
 *   + facing shortfall  knot in an alley tighter than COLLIDE_GAP
 *   + detour tax      same-side C only if it saves about a card-width of path
 *   − stick           keep the last pair while dragging unless another is clearly better
 */
export function edgeGeom(a, b) {
  const stick = getSticky(a, b);
  const shortH = Math.min(a.h, b.h);
  const detourTax = Math.min(a.w, b.w);

  let best = null;
  let bestScore = Infinity;

  for (let ia = 0; ia < 4; ia++) {
    const sa = SIDES[ia];
    const pa = port(a, ia);
    if (insideInset(b, pa.x, pa.y, 0)) continue;
    for (let ib = 0; ib < 4; ib++) {
      const sb = SIDES[ib];
      const pb = port(b, ib);
      if (insideInset(a, pb.x, pb.y, 0)) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) continue;

      const alongA = dx * sa.nx + dy * sa.ny;
      const alongB = -dx * sb.nx - dy * sb.ny;
      const facing = alongA > 0 && alongB > 0;
      const pull = stubPull(dist, alongA, alongB);
      const g = cubicPair(a, b, ia, ib, pull);

      const clips = cubicClipHits(a, b, g, 16);
      const shortfall = facing ? Math.max(0, COLLIDE_GAP - Math.min(alongA, alongB)) * shortH * 0.5 : 0;
      const detour = facing ? 0 : detourTax;
      const stickPen = stick && stick.ia === ia && stick.ib === ib ? -80 : 0;
      const score = clips * 10000 + controlLen(g) + exitKink(g, sa, sb) * 80 + shortfall + detour + stickPen;

      if (score < bestScore) {
        bestScore = score;
        best = g;
      }
    }
  }

  if (!best) return cubicPair(a, b, 0, 1, Math.max(4, 0.5 * Math.min(a.w, b.w)));
  setSticky(a, b, best.ia, best.ib);
  return best;
}

/** Append a cubic edge curve from a to b onto a Path2D. */
export function addCurve(path, a, b) {
  const p = edgeGeom(a, b);
  path.moveTo(p.sx, p.sy);
  path.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
}

/**
 * Cheap facing-side cubic (no clip scoring). Used for island-centroid bundles.
 */
export function edgeGeomFast(a, b) {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  let ia;
  let ib;
  if (Math.abs(dx) >= Math.abs(dy)) {
    ia = dx >= 0 ? 0 : 1; // right / left
    ib = dx >= 0 ? 1 : 0;
  } else {
    ia = dy >= 0 ? 2 : 3; // bottom / top
    ib = dy >= 0 ? 3 : 2;
  }
  const dist = Math.hypot(dx, dy);
  const pull = Math.max(16, Math.min(80, dist * 0.2));
  return cubicPair(a, b, ia, ib, pull);
}

/** Append {@link edgeGeomFast} onto a Path2D. */
export function addCurveFast(path, a, b) {
  const p = edgeGeomFast(a, b);
  path.moveTo(p.sx, p.sy);
  path.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
}

/** Draw an arrowhead at the end of the edge from a to b. */
export function drawArrow(a, b, color) {
  const p = edgeGeom(a, b);
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
