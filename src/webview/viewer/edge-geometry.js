/*
 * Edge curve geometry and small canvas path helpers (bezier attachment sides,
 * arrowheads, rounded rectangles).
 */
import { ctx } from "./dom.js";
import { cam } from "./state.js";

// Side midpoints + outward normals (world space). Order: right, left, bottom, top.
const SIDES = [
  { nx: 1, ny: 0, ang: 0 },
  { nx: -1, ny: 0, ang: Math.PI },
  { nx: 0, ny: 1, ang: Math.PI / 2 },
  { nx: 0, ny: -1, ang: -Math.PI / 2 },
];

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

/** Dominant-axis fallback (old rule) when every side pair is discarded. */
function edgeGeomFallback(a, b) {
  const acx = a.x + a.w / 2,
    acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2,
    bcy = b.y + b.h / 2;
  const dx = bcx - acx,
    dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? a.x + a.w : a.x;
    const tx = dx >= 0 ? b.x : b.x + b.w;
    const mx = (sx + tx) / 2;
    return { sx, sy: acy, tx, ty: bcy, c1x: mx, c1y: acy, c2x: mx, c2y: bcy, ang: dx >= 0 ? 0 : Math.PI };
  }
  const sy = dy >= 0 ? a.y + a.h : a.y;
  const ty = dy >= 0 ? b.y : b.y + b.h;
  const my = (sy + ty) / 2;
  return { sx: acx, sy, tx: bcx, ty, c1x: acx, c1y: my, c2x: bcx, c2y: my, ang: dy >= 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/**
 * Bezier control points and end angle for an edge between two boxes.
 * Tries all 4×4 side midpoints; keeps pairs whose stubs leave outward and whose
 * cubic does not clip either endpoint box. Scores by port distance (+ mild
 * penalty for non-opposite sides). Falls back to dominant-axis geom if none survive.
 */
export function edgeGeom(a, b) {
  const INSET = 1;
  let best = null;
  let bestScore = Infinity;

  for (let ia = 0; ia < 4; ia++) {
    const sa = SIDES[ia];
    const pa = port(a, ia);
    for (let ib = 0; ib < 4; ib++) {
      const sb = SIDES[ib];
      const pb = port(b, ib);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) continue;

      // Other port must lie in the outward half-plane of each side — otherwise
      // the chord turns back into the card (classic lower-left → upper-right miss).
      if (dx * sa.nx + dy * sa.ny <= 0) continue;
      if (-dx * sb.nx + -dy * sb.ny <= 0) continue;

      // Stub length scales with port gap so long links keep a visible bow
      // (an 80px cap made far edges look like straight chords).
      const pull = Math.max(24, dist / 2);
      const c1x = pa.x + sa.nx * pull;
      const c1y = pa.y + sa.ny * pull;
      const c2x = pb.x + sb.nx * pull;
      const c2y = pb.y + sb.ny * pull;

      // Chord and mid-cubic samples must not sit inside either card.
      let clips = false;
      if (insideInset(a, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, INSET) || insideInset(b, (pa.x + pb.x) / 2, (pa.y + pb.y) / 2, INSET)) {
        clips = true;
      } else {
        for (const t of [0.25, 0.5, 0.75]) {
          const p = cubicAt(pa.x, pa.y, c1x, c1y, c2x, c2y, pb.x, pb.y, t);
          if (insideInset(a, p.x, p.y, INSET) || insideInset(b, p.x, p.y, INSET)) {
            clips = true;
            break;
          }
        }
      }
      if (clips) continue;

      // Prefer opposite sides (L–R or T–B); mild penalty otherwise.
      const opposite = sa.nx === -sb.nx && sa.ny === -sb.ny;
      const score = dist + (opposite ? 0 : 40);
      if (score < bestScore) {
        bestScore = score;
        // ang = inbound side normal of the target (arrow sits flush on that side)
        best = { sx: pa.x, sy: pa.y, tx: pb.x, ty: pb.y, c1x, c1y, c2x, c2y, ang: sb.ang + Math.PI };
      }
    }
  }

  return best || edgeGeomFallback(a, b);
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
