/*
 * Barnes-Hut quadtree for the force layout's repulsion step. Naive all-pairs
 * repulsion is O(n²) per iteration, which becomes a multi-minute freeze on large
 * graphs (thousands of cards). This approximates the repulsion in O(n log n):
 * distant clusters are treated as a single point mass at their center of mass
 * when the cell is far enough away (`node.size / distance < theta`).
 *
 * A card's mass is its `charge` (set by the caller — size-weighted, and in files
 * mode also scaled by degree so hubs clear space), falling back to `w + h` when
 * unset; force magnitude is `mass_i · mass_cluster · chargeScale / d²`, directed
 * to push the card away from the mass.
 */

/** A card's repulsion mass: its explicit `charge`, else its size (`w + h`). */
function chargeOf(g) {
  return g.charge != null ? g.charge : g.w + g.h;
}

/** Allocate a fresh quadtree cell covering the square at (x, y) of side `size`. */
function makeNode(x, y, size) {
  return { x, y, size, mass: 0, comX: 0, comY: 0, body: null, quads: null };
}

// Below this cell size we stop subdividing and just merge near-coincident cards
// into the aggregate — avoids unbounded recursion when cards share a position.
const MIN_CELL = 0.5;

/** Place card `g` into the correct child quadrant of an internal `node`. */
function insertChild(node, g) {
  const half = node.size / 2;
  const mx = node.x + half;
  const my = node.y + half;
  const qi = (g.cx >= mx ? 1 : 0) + (g.cy >= my ? 2 : 0);
  let child = node.quads[qi];
  if (!child) {
    const cx = node.x + (qi & 1 ? half : 0);
    const cy = node.y + (qi & 2 ? half : 0);
    child = makeNode(cx, cy, half);
    node.quads[qi] = child;
  }
  insert(child, g);
}

/** Insert card `g`, subdividing occupied leaves and updating aggregate mass/COM. */
function insert(node, g) {
  const m = chargeOf(g);
  if (node.mass === 0) {
    node.body = g;
    node.mass = m;
    node.comX = g.cx;
    node.comY = g.cy;
    return;
  }
  // Occupied leaf (or coincident-point bucket): push the existing body down a
  // level before descending — unless the cell is already too small to split.
  if (node.body !== null) {
    if (node.size <= MIN_CELL) {
      // near-coincident cards: merge into the aggregate, keep them as bodies is
      // impossible, so just accumulate mass/COM (their mutual force is ~0 anyway)
      const tot = node.mass + m;
      node.comX = (node.comX * node.mass + g.cx * m) / tot;
      node.comY = (node.comY * node.mass + g.cy * m) / tot;
      node.mass = tot;
      return;
    }
    const existing = node.body;
    node.body = null;
    node.quads = [null, null, null, null];
    insertChild(node, existing);
  }
  const tot = node.mass + m;
  node.comX = (node.comX * node.mass + g.cx * m) / tot;
  node.comY = (node.comY * node.mass + g.cy * m) / tot;
  node.mass = tot;
  insertChild(node, g);
}

/** Build a Barnes-Hut tree over the cards `gs`, returning its root (or null). */
function buildTree(gs) {
  const n = gs.length;
  if (n < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const g = gs[i];
    if (g.cx < minX) minX = g.cx;
    if (g.cx > maxX) maxX = g.cx;
    if (g.cy < minY) minY = g.cy;
    if (g.cy > maxY) maxY = g.cy;
  }
  let size = Math.max(maxX - minX, maxY - minY);
  if (!(size > 0)) size = 1;
  const root = makeNode(minX, minY, size * 1.0001); // pad so max-corner cards fit
  for (let i = 0; i < n; i++) insert(root, gs[i]);
  return root;
}

/** Accumulate the repulsive acceleration on `g` from a subtree into `out`. */
function accumulate(node, g, chargeScale, theta2, out) {
  if (node.mass === 0) return;
  if (node.body !== null) {
    if (node.body === g) return;
    push(g, node.comX, node.comY, node.mass, chargeScale, out);
    return;
  }
  const dx = g.cx - node.comX;
  const dy = g.cy - node.comY;
  const d2 = dx * dx + dy * dy || 1;
  // s/d < theta  ⇔  s² < theta²·d²  — treat the whole cell as one point mass
  if (node.size * node.size < theta2 * d2) {
    push(g, node.comX, node.comY, node.mass, chargeScale, out);
    return;
  }
  const q = node.quads;
  for (let i = 0; i < 4; i++) if (q[i]) accumulate(q[i], g, chargeScale, theta2, out);
}

/** Add the repulsion of a point mass at (cx, cy) acting on card `g` into `out`. */
function push(g, cx, cy, mass, chargeScale, out) {
  let dx = g.cx - cx;
  let dy = g.cy - cy;
  let d2 = dx * dx + dy * dy;
  if (d2 < 1) {
    // coincident-ish: nudge deterministically so the pair can separate
    dx = dx || 0.5;
    dy = dy || 0.5;
    d2 = dx * dx + dy * dy || 1;
  }
  const strength = (chargeOf(g) * mass * chargeScale) / d2;
  const dist = Math.sqrt(d2);
  out.fx += (dx / dist) * strength;
  out.fy += (dy / dist) * strength;
}

/**
 * Add Barnes-Hut repulsion (scaled by `alpha`) into each card's velocity.
 * Drop-in replacement for the old O(n²) repulsion double-loop in forceLayout.
 */
export function applyRepulsion(gs, chargeScale, alpha, theta = 0.9) {
  const root = buildTree(gs);
  if (!root) return;
  const theta2 = theta * theta;
  const out = { fx: 0, fy: 0 };
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    out.fx = 0;
    out.fy = 0;
    accumulate(root, g, chargeScale, theta2, out);
    g.vx += out.fx * alpha;
    g.vy += out.fy * alpha;
  }
}
