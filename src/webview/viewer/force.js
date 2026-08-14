/*
 * DOM-free force layout: Barnes-Hut repulsion + springs + weak centering, with
 * spatial-grid AABB collision separation. Split out from layout.js so it stays
 * pure (only geometry) and can be benchmarked/tested without a document.
 *
 * Both the repulsion and the collision separation are near-linear (quadtree /
 * uniform grid); the previous all-pairs versions were O(n²) per pass and froze
 * the tab for minutes on large graphs.
 */
import { COLLIDE_GAP } from "./constants.js";
import { applyRepulsion } from "./quadtree.js";

// Force-directed on cards: repulsion + springs + weak centering, plus hard AABB
// collision separation. Tuned for "islands": strong repulsion and long springs
// give air; weak gravity avoids collapsing into a blob.
/** Force-directed layout with Barnes-Hut repulsion, springs, centering, and separation. */
export function forceLayout(gs, links, opts) {
  const n = gs.length;
  if (!n) return;
  opts = opts || {};

  // degree of each card (cross-file link count) —
  // used to weaken pull toward hubs and avoid collapsing everything into a core
  const deg = new Map();
  for (const l of links) {
    deg.set(l.a, (deg.get(l.a) || 0) + 1);
    deg.set(l.b, (deg.get(l.b) || 0) + 1);
  }

  const spreadK = opts.spreadK != null ? opts.spreadK : 1.4;
  const spread = Math.sqrt(gs.reduce((s, g) => s + g.w * g.h, 0)) * spreadK;
  for (let i = 0; i < n; i++) {
    const g = gs[i];
    const ang = i * 2.399963229728653;
    const r = Math.sqrt((i + 0.5) / n) * spread;
    g.cx = Math.cos(ang) * r;
    g.cy = Math.sin(ang) * r;
    g.vx = 0;
    g.vy = 0;
  }

  // Iterations: honor an explicit count; otherwise scale down for large graphs so
  // even huge inputs settle in bounded time (Barnes-Hut keeps each iter cheap).
  const iterations = opts.iterations != null
    ? opts.iterations
    : Math.max(140, Math.min(440, Math.round(440 * Math.sqrt(700 / n))));
  const velocityDecay = 0.62;
  // Size factor: dense graphs collapse into one "ball of mud", so as the card count
  // grows we push repulsion up (more "antigravity") and ease off the center gravity
  // that pulls everything into a core — the graph breathes out instead of balling up.
  // Caps at ~2.2× so it never explodes. Only affects the unspecified defaults below.
  const sizeK = Math.min(2.2, Math.max(1, Math.sqrt(n / 700)));
  const centerK = opts.centerK != null ? opts.centerK : 0.004 / sizeK; // gravity toward center
  const springK = opts.springK != null ? opts.springK : 0.08;
  const springRestExtra = opts.springRestExtra != null ? opts.springRestExtra : 120; // spring rest length
  const chargeScale = opts.chargeScale != null ? opts.chargeScale : 170 * sizeK; // repulsion strength
  // How strongly a link is weakened by its higher-degree ("hub") endpoint. 0 =
  // old behavior (weaken by the smaller degree only); higher = hubs pull weaker.
  const hubMaxExp = opts.hubMaxExp != null ? opts.hubMaxExp : 0.3;
  // Degree-scaled repulsion: a card's charge grows with its link count so hub
  // files (shared utils/types everything imports) clear personal space and shove
  // their crowd of importers outward — the single most effective lever against
  // the "ball of mud" (radial gravity only changes the blob's radius, not its
  // internal spacing). `gravityDegDamp` eases hubs off dead-center as a bonus.
  // Both default off (0 → charge == size, uniform gravity) so callers that pass
  // explicit params (folder mode) are unaffected; only files mode opts in.
  const chargeDegExp = opts.chargeDegExp != null ? opts.chargeDegExp : 0;
  const gravityDegDamp = opts.gravityDegDamp != null ? opts.gravityDegDamp : 0;
  const gravK = new Array(n);
  for (let i = 0; i < n; i++) {
    const g = gs[i];
    const d = deg.get(g) || 1;
    g.charge = (g.w + g.h) * (chargeDegExp ? Math.pow(1 + d, chargeDegExp) : 1);
    gravK[i] = gravityDegDamp ? centerK / Math.pow(1 + d, gravityDegDamp) : centerK;
  }
  // Barnes-Hut opening angle: larger = coarser/faster but clumpier. Keep it sharp so
  // far clusters actually push apart; open it only slightly on huge graphs for speed.
  const theta = opts.theta != null ? opts.theta : n > 4000 ? 1.0 : 0.8;
  const maxStep = Math.max(80, spread * 0.035);

  let alpha = 1;
  const alphaDecay = 1 - Math.pow(0.001, 1 / iterations);

  for (let it = 0; it < iterations; it++) {
    alpha *= 1 - alphaDecay;

    // repulsion (Barnes-Hut, O(n log n))
    applyRepulsion(gs, chargeScale, alpha, theta);

    for (const l of links) {
      const a = l.a;
      const b = l.b;
      let dx = b.cx - a.cx;
      let dy = b.cy - a.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const rest = (a.w + a.h) / 2 + (b.w + b.h) / 2 + springRestExtra;
      // Weaken a link by the smaller degree (as before) AND, more mildly, by the
      // larger degree. The extra max-degree term de-emphasizes hub files (barrels,
      // shared utils that everything imports): a leaf→hub link no longer slams the
      // leaf onto the hub, so the whole graph stops collapsing into one dense core.
      const da = deg.get(a) || 1;
      const db = deg.get(b) || 1;
      const hub = Math.sqrt(Math.min(da, db)) * Math.pow(Math.max(da, db), hubMaxExp);
      const k = (springK * Math.min(l.w, 24) * alpha) / hub;
      const disp = (dist - rest) * k;
      const fx = (dx / dist) * disp;
      const fy = (dy / dist) * disp;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (let i = 0; i < n; i++) {
      const g = gs[i];
      g.vx -= g.cx * gravK[i] * alpha;
      g.vy -= g.cy * gravK[i] * alpha;
    }

    for (let i = 0; i < n; i++) {
      const g = gs[i];
      g.vx *= velocityDecay;
      g.vy *= velocityDecay;
      const sp = Math.hypot(g.vx, g.vy);
      if (sp > maxStep) {
        g.vx = (g.vx / sp) * maxStep;
        g.vy = (g.vy / sp) * maxStep;
      }
      g.cx += g.vx;
      g.cy += g.vy;
      if (!Number.isFinite(g.cx) || !Number.isFinite(g.cy)) {
        g.cx = 0;
        g.cy = 0;
        g.vx = 0;
        g.vy = 0;
      }
    }

    resolveCollisions(gs, 2);
  }

  resolveCollisions(gs, 24);
}

// Separate overlapping AABB boxes along the axis of least penetration, using a
// uniform spatial grid so each box only tests nearby boxes (near-linear) instead
// of every other box. pinned (Set) — do not move these cards (only neighbors).
/** Push overlapping AABB boxes apart along the shallowest penetration axis. */
export function resolveCollisions(gs, passes, pinned) {
  const n = gs.length;
  if (n < 2) return;
  const gap = COLLIDE_GAP;
  // cell = largest card extent + gap, so any overlapping pair falls within
  // adjacent cells (their center distance is ≤ (wi+wj)/2 + gap ≤ cell per axis).
  let maxDim = 1;
  for (let i = 0; i < n; i++) {
    const g = gs[i];
    if (g.w > maxDim) maxDim = g.w;
    if (g.h > maxDim) maxDim = g.h;
  }
  const cell = maxDim + gap;

  for (let p = 0; p < passes; p++) {
    let moved = false;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const g = gs[i];
      g._i = i;
      g._cx = Math.floor(g.cx / cell);
      g._cy = Math.floor(g.cy / cell);
      const key = g._cx + "," + g._cy;
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, (bucket = []));
      bucket.push(g);
    }
    for (let i = 0; i < n; i++) {
      const gi = gs[i];
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get((gi._cx + ox) + "," + (gi._cy + oy));
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const gj = bucket[b];
            if (gj === gi || gj._i <= gi._i) continue; // test each pair once
            const dx = gj.cx - gi.cx;
            const dy = gj.cy - gi.cy;
            const px = (gi.w + gj.w) / 2 + gap - Math.abs(dx);
            const py = (gi.h + gj.h) / 2 + gap - Math.abs(dy);
            if (px > 0 && py > 0) {
              moved = true;
              const pi = pinned && pinned.has(gi);
              const pj = pinned && pinned.has(gj);
              if (pi && pj) continue;
              if (px < py) {
                const s = px * (dx < 0 ? -1 : 1);
                if (pi) gj.cx += s;
                else if (pj) gi.cx -= s;
                else {
                  gi.cx -= s / 2;
                  gj.cx += s / 2;
                }
              } else {
                const s = py * (dy < 0 ? -1 : 1);
                if (pi) gj.cy += s;
                else if (pj) gi.cy -= s;
                else {
                  gi.cy -= s / 2;
                  gj.cy += s / 2;
                }
              }
            }
          }
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Treat current top-left (`x`/`y`) as truth, push overlapping AABBs apart, and
 * write top-left back. Use after expand / editor resize / restoring a save —
 * not during `layout()`, where centers (`cx`/`cy`) are the source of truth
 * and `x`/`y` may still be unset.
 */
export function separateOverlapping(gs, passes, pinned) {
  if (!gs || gs.length < 2) return;
  for (const g of gs) {
    g.cx = g.x + g.w / 2;
    g.cy = g.y + g.h / 2;
  }
  resolveCollisions(gs, passes, pinned);
  applyCollisionShift(gs);
}

// Convert new centers (cx/cy) to top-left (x/y) and shift the card's functions
// by the same delta — to keep their offsets relative to the file.
/** Sync top-left from centers and move child functions by the same delta. */
export function applyCollisionShift(gs) {
  for (const g of gs) {
    const nx = g.cx - g.w / 2;
    const ny = g.cy - g.h / 2;
    const dx = nx - g.x;
    const dy = ny - g.y;
    if (dx || dy) {
      g.x = nx;
      g.y = ny;
      for (const n of g.ids) {
        n.x += dx;
        n.y += dy;
      }
    }
  }
}
