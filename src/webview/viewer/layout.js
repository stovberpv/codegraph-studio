/*
 * Layout engine: build file cards from nodes, then run force-directed placement
 * (files mode) or a two-level folder layout, with AABB collision separation.
 */
import { ctx } from "./dom.js";
import { state, nodes, markDirty } from "./state.js";
import {
  ACTIONS,
  BTN,
  COLLIDE_GAP,
  CTRL_GAP,
  EDIT_H,
  EDIT_W,
  GAP,
  HEADER_H,
  NODE_H,
  PAD,
  TITLE_H,
} from "./constants.js";
import { dirname, hashHue, splitName, textWidth } from "./utils.js";
import { applySize } from "./sizing.js";
import { buildFolders } from "./folders.js";

/** Rebuild file cards from nodes and run force/folder layout. */
export function layout() {
  ctx.font = "13px ui-monospace, monospace";
  state.selection = new Set(); // groups are rebuilt — old references are invalid
  const hideIso = state.hideIsolated;

  const byFile = new Map();
  for (const n of nodes.values()) {
    n.hidden = hideIso && n.deg === 0;
    n.group = null;
    if (n.hidden) continue;
    if (!byFile.has(n.file)) byFile.set(n.file, []);
    byFile.get(n.file).push(n);
  }

  state.groups = [];
  const groupByPath = new Map();
  const controlsW = ACTIONS.length * BTN + (ACTIONS.length - 1) * CTRL_GAP;
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.line - b.line);
    const { name, ext } = splitName(file);
    let maxW = textWidth(name) + 20;
    for (const n of list) maxW = Math.max(maxW, textWidth(n.name) + 24);
    // header must fit the extension on the left and controls on the right
    const headerMinW = 10 + textWidth(ext) + 14 + controlsW + 6;
    const expandedW = Math.max(Math.min(380, Math.max(180, maxW)), headerMinW - PAD * 2) + PAD * 2;
    const expandedH = HEADER_H + TITLE_H + list.length * (NODE_H + GAP) + PAD;
    const wasEditing = !!(window.__cgEditor && window.__cgEditor.isOpen && window.__cgEditor.isOpen(file));
    const g = {
      path: file,
      folder: dirname(file),
      name,
      ext,
      ids: list,
      hue: hashHue(file),
      isGroup: true,
      expanded: false,
      editing: wasEditing,
      pinned: false,
      hidden: false,
      filteredOut: false,
      hideIncoming: false,
      hideOutgoing: false,
      expandedW,
      expandedH,
      editW: EDIT_W,
      editH: EDIT_H,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      vx: 0,
      vy: 0,
      linked: false,
    };
    applySize(g);
    for (const n of list) n.group = g;
    state.groups.push(g);
    groupByPath.set(file, g);
  }

  // cross-file links (weight = call count)
  const linkMap = new Map();
  for (const e of state.edges) {
    if (e.from.hidden || e.to.hidden) continue;
    const a = e.from.file;
    const b = e.to.file;
    if (a === b) continue;
    const key = a < b ? a + "\u0000" + b : b + "\u0000" + a;
    linkMap.set(key, (linkMap.get(key) || 0) + 1);
  }
  const links = [];
  for (const [key, w] of linkMap) {
    const [a, b] = key.split("\u0000");
    const ga = groupByPath.get(a);
    const gb = groupByPath.get(b);
    if (ga && gb) {
      links.push({ a: ga, b: gb, w });
      ga.linked = true;
      gb.linked = true;
    }
  }

  if (state.layoutMode === "folder") {
    // folder is the only unit: lay out ALL files (including isolates)
    // into folder islands; skip a separate isolate grid — otherwise
    // a folder island would stretch from the core to a distant grid and overlap.
    folderLayout(state.groups, links);
  } else {
    const connected = state.groups.filter((g) => g.linked);
    const isolated = state.groups.filter((g) => !g.linked);

    if (connected.length) forceLayout(connected, links);

    // bbox of the connected core
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    if (connected.length) {
      minX = minY = Infinity;
      maxX = maxY = -Infinity;
      for (const g of connected) {
        minX = Math.min(minX, g.cx - g.w / 2);
        minY = Math.min(minY, g.cy - g.h / 2);
        maxX = Math.max(maxX, g.cx + g.w / 2);
        maxY = Math.max(maxY, g.cy + g.h / 2);
      }
    }

    // isolates — tidy grid below the core
    if (isolated.length) {
      isolated.sort((a, b) => b.h - a.h);
      const area = isolated.reduce((s, g) => s + g.w * g.h, 0);
      const coreW = maxX - minX;
      const targetW = Math.max(coreW, Math.sqrt(area) * 1.6, 1200);
      const gap = COLLIDE_GAP;
      const ox = connected.length ? minX : 0;
      const oy = connected.length ? maxY + 140 : 0;
      let x = ox, y = oy, rowH = 0;
      for (const g of isolated) {
        if (x > ox && x + g.w > ox + targetW) {
          x = ox;
          y += rowH + gap;
          rowH = 0;
        }
        g.cx = x + g.w / 2;
        g.cy = y + g.h / 2;
        x += g.w + gap;
        rowH = Math.max(rowH, g.h);
      }
    }
  }

  for (const g of state.groups) {
    g.x = g.cx - g.w / 2;
    g.y = g.cy - g.h / 2;
    if (g.expanded) layoutInner(g);
  }
  buildFolders();
  markDirty();
}

// Two-level layout: gravity inside a folder → gravity between folders.
/** Two-level force layout: pack files inside folders, then place folder boxes. */
function folderLayout(gs, links) {
  const byFolder = new Map();
  for (const g of gs) {
    if (!byFolder.has(g.folder)) byFolder.set(g.folder, []);
    byFolder.get(g.folder).push(g);
  }

  // 1) inside each folder — compact local forceLayout
  // (tight params: weak repulsion, short springs, strong centering)
  const INNER = { chargeScale: 20, springRestExtra: 16, centerK: 0.09, springK: 0.16, iterations: 320, spreadK: 0.7 };
  for (const [, list] of byFolder) {
    if (list.length === 1) {
      list[0].cx = 0;
      list[0].cy = 0;
      list[0].vx = 0;
      list[0].vy = 0;
      continue;
    }
    const localLinks = links.filter((l) => l.a.folder === list[0].folder && l.b.folder === list[0].folder);
    forceLayout(list, localLinks, INNER);
  }

  // 2) each folder's bbox (local coords) → rigid island box.
  // FOLDER_MARGIN gives breathing room so folders do not merge.
  const FOLDER_MARGIN = 64;
  const LABEL_H = 22;
  const folders = [];
  const folderByKey = new Map();
  for (const [key, list] of byFolder) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const g of list) {
      minX = Math.min(minX, g.cx - g.w / 2);
      minY = Math.min(minY, g.cy - g.h / 2);
      maxX = Math.max(maxX, g.cx + g.w / 2);
      maxY = Math.max(maxY, g.cy + g.h / 2);
    }
    if (!Number.isFinite(minX)) {
      minX = minY = 0;
      maxX = maxY = 1;
    }
    const f = {
      key,
      list,
      hue: hashHue(key),
      // box size = cluster bounds + padding on all sides (+ room for a label)
      w: maxX - minX + FOLDER_MARGIN * 2,
      h: maxY - minY + FOLDER_MARGIN * 2 + LABEL_H,
      localMidX: (minX + maxX) / 2,
      localMidY: (minY + maxY) / 2,
      cx: 0,
      cy: 0,
      vx: 0,
      vy: 0,
      linked: false,
    };
    folders.push(f);
    folderByKey.set(key, f);
  }

  // 3) cross-folder links (weight = sum of cross-file links between folders)
  const folderLinks = [];
  const flMap = new Map();
  for (const l of links) {
    if (l.a.folder === l.b.folder) continue;
    const ka = l.a.folder;
    const kb = l.b.folder;
    const key = ka < kb ? ka + "\u0000" + kb : kb + "\u0000" + ka;
    flMap.set(key, (flMap.get(key) || 0) + l.w);
  }
  for (const [key, w] of flMap) {
    const [a, b] = key.split("\u0000");
    const fa = folderByKey.get(a);
    const fb = folderByKey.get(b);
    if (fa && fb) {
      folderLinks.push({ a: fa, b: fb, w });
      fa.linked = true;
      fb.linked = true;
    }
  }

  // 4) layout folder boxes: attraction between linked ones + hard
  //    separation (boxes do not overlap; COLLIDE_GAP between them)
  if (folders.length === 1) {
    folders[0].cx = 0;
    folders[0].cy = 0;
  } else {
    forceLayout(folders, folderLinks, { chargeScale: 42, springRestExtra: 60, centerK: 0.01, springK: 0.06 });
    resolveCollisions(folders, 300); // guarantee islands are separated
  }

  // 5) shift each folder's cards as a rigid body to its box center
  for (const f of folders) {
    const dx = f.cx - f.localMidX;
    const dy = f.cy - f.localMidY;
    for (const g of f.list) {
      g.cx += dx;
      g.cy += dy;
      g.vx = 0;
      g.vy = 0;
    }
  }
  // intentionally do NOT call global resolveCollisions on cards —
  // it would scramble folders; inside a folder overlaps are gone (step 1),
  // and between folders too (step 4).
}

// Lay out functions inside an expanded card (vertical list).
/** Stack function nodes as a vertical list inside an expanded card. */
export function layoutInner(g) {
  const nodeW = g.w - PAD * 2;
  let ny = g.y + HEADER_H + TITLE_H + PAD / 2;
  for (const n of g.ids) {
    n.x = g.x + PAD;
    n.y = ny;
    n.w = nodeW;
    n.h = NODE_H;
    ny += NODE_H + GAP;
  }
}

// Force-directed on cards: repulsion + springs + weak centering,
// plus hard AABB collision separation. Tuned for "islands": strong
// repulsion and long springs give air; weak gravity avoids collapsing into a blob.
/** Force-directed layout with repulsion, springs, centering, and AABB separation. */
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

  const iterations = opts.iterations != null ? opts.iterations : 440;
  const velocityDecay = 0.62;
  const centerK = opts.centerK != null ? opts.centerK : 0.004; // gravity toward center
  const springK = opts.springK != null ? opts.springK : 0.08;
  const springRestExtra = opts.springRestExtra != null ? opts.springRestExtra : 120; // spring rest length
  const chargeScale = opts.chargeScale != null ? opts.chargeScale : 170; // repulsion strength
  const maxStep = Math.max(80, spread * 0.035);

  let alpha = 1;
  const alphaDecay = 1 - Math.pow(0.001, 1 / iterations);

  for (let it = 0; it < iterations; it++) {
    alpha *= 1 - alphaDecay;

    for (let i = 0; i < n; i++) {
      const gi = gs[i];
      for (let j = i + 1; j < n; j++) {
        const gj = gs[j];
        let dx = gj.cx - gi.cx;
        let dy = gj.cy - gi.cy;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (i - j) || 1;
          dy = (j - i) || 1;
          d2 = dx * dx + dy * dy;
        }
        const strength = ((gi.w + gi.h) * (gj.w + gj.h) * chargeScale) / d2;
        const dist = Math.sqrt(d2);
        const fx = (dx / dist) * strength * alpha;
        const fy = (dy / dist) * strength * alpha;
        gi.vx -= fx;
        gi.vy -= fy;
        gj.vx += fx;
        gj.vy += fy;
      }
    }

    for (const l of links) {
      const a = l.a;
      const b = l.b;
      let dx = b.cx - a.cx;
      let dy = b.cy - a.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const rest = (a.w + a.h) / 2 + (b.w + b.h) / 2 + springRestExtra;
      // divide attraction by sqrt(min-degree): hub links pull weakly,
      // links inside a small group pull strongly → islands form
      const hub = Math.sqrt(Math.min(deg.get(a) || 1, deg.get(b) || 1));
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
      g.vx -= g.cx * centerK * alpha;
      g.vy -= g.cy * centerK * alpha;
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

// Separate overlapping AABB boxes along the axis of least penetration.
// pinned (Set) — do not move these cards (only their neighbors).
/** Push overlapping AABB boxes apart along the shallowest penetration axis. */
export function resolveCollisions(gs, passes, pinned) {
  const n = gs.length;
  const gap = COLLIDE_GAP;
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const gi = gs[i];
      for (let j = i + 1; j < n; j++) {
        const gj = gs[j];
        const dx = gj.cx - gi.cx;
        const dy = gj.cy - gi.cy;
        const ox = (gi.w + gj.w) / 2 + gap - Math.abs(dx);
        const oy = (gi.h + gj.h) / 2 + gap - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          const pi = pinned && pinned.has(gi);
          const pj = pinned && pinned.has(gj);
          if (pi && pj) continue;
          if (ox < oy) {
            const s = ox * (dx < 0 ? -1 : 1);
            if (pi) gj.cx += s;
            else if (pj) gi.cx -= s;
            else {
              gi.cx -= s / 2;
              gj.cx += s / 2;
            }
          } else {
            const s = oy * (dy < 0 ? -1 : 1);
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
    if (!moved) break;
  }
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
