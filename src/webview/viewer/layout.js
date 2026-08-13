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
import { detectCommunities } from "./community.js";
import { applyCollisionShift, forceLayout, resolveCollisions } from "./force.js";

// Resolution for files-mode community detection: higher → more, smaller islands.
// 1.5 gave the most balanced archipelago on codebase-like graphs (see benchmark).
const COMMUNITY_RESOLUTION = 1.5;

export { applyCollisionShift, forceLayout, resolveCollisions };

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

    // Islands, not one globe: cluster files by call-graph community, then run the
    // two-level island layout on those communities. A flat force layout always
    // collapses to a single blob (one gravity center); clustering first is what
    // makes folder mode read as separate islands — here the clusters come from
    // actual connectivity instead of directory paths.
    if (connected.length) {
      const comm = detectCommunities(connected, links, COMMUNITY_RESOLUTION);
      clusterIslands(connected, links, (g) => "c" + comm.get(g));
    }

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

// Folder mode: two-level island layout keyed by directory.
/** Two-level force layout: pack files inside folders, then place folder boxes. */
function folderLayout(gs, links) {
  clusterIslands(gs, links, (g) => g.folder);
}

// Generic two-level "island" layout: pack each cluster with a tight local force
// layout, freeze it into a rigid box, then lay out the sparse box-to-box graph
// with strong repulsion + long springs + weak gravity so clusters spread into
// separate islands instead of a single blob. `keyOf(group)` decides the cluster
// each file belongs to — the directory in folder mode, a call-graph community in
// files mode. Only positions (cx/cy); rendering of folder islands is derived
// later and gated to folder mode (see folders.js).
/** Cluster files by `keyOf`, lay each out locally, then separate the clusters. */
function clusterIslands(gs, links, keyOf) {
  const byKey = new Map();
  for (const g of gs) {
    const key = keyOf(g);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }

  // 1) inside each cluster — compact local forceLayout
  // (tight params: weak repulsion, short springs, strong centering)
  const INNER = { chargeScale: 20, springRestExtra: 16, centerK: 0.09, springK: 0.16, iterations: 320, spreadK: 0.7 };
  for (const [key, list] of byKey) {
    if (list.length === 1) {
      list[0].cx = 0;
      list[0].cy = 0;
      list[0].vx = 0;
      list[0].vy = 0;
      continue;
    }
    const localLinks = links.filter((l) => keyOf(l.a) === key && keyOf(l.b) === key);
    forceLayout(list, localLinks, INNER);
  }

  // 2) each cluster's bbox (local coords) → rigid island box.
  // ISLAND_MARGIN gives breathing room so clusters do not merge.
  const ISLAND_MARGIN = 64;
  const LABEL_H = 22;
  const islands = [];
  const islandByKey = new Map();
  for (const [key, list] of byKey) {
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
      w: maxX - minX + ISLAND_MARGIN * 2,
      h: maxY - minY + ISLAND_MARGIN * 2 + LABEL_H,
      localMidX: (minX + maxX) / 2,
      localMidY: (minY + maxY) / 2,
      cx: 0,
      cy: 0,
      vx: 0,
      vy: 0,
      linked: false,
    };
    islands.push(f);
    islandByKey.set(key, f);
  }

  // 3) cross-cluster links (weight = sum of cross-file links between clusters)
  const islandLinks = [];
  const ilMap = new Map();
  for (const l of links) {
    const ka = keyOf(l.a);
    const kb = keyOf(l.b);
    if (ka === kb) continue;
    const key = ka < kb ? ka + "\u0000" + kb : kb + "\u0000" + ka;
    ilMap.set(key, (ilMap.get(key) || 0) + l.w);
  }
  for (const [key, w] of ilMap) {
    const [a, b] = key.split("\u0000");
    const fa = islandByKey.get(a);
    const fb = islandByKey.get(b);
    if (fa && fb) {
      islandLinks.push({ a: fa, b: fb, w });
      fa.linked = true;
      fb.linked = true;
    }
  }

  // 4) layout island boxes: attraction between linked ones + hard separation
  //    (boxes do not overlap; COLLIDE_GAP between them). The cluster graph is
  //    sparse, so it lays out as genuine islands — strong repulsion + long
  //    springs + weak gravity spread clusters apart into readable islands
  //    instead of a central clump. hubMaxExp keeps hub clusters off dead-center.
  if (islands.length === 1) {
    islands[0].cx = 0;
    islands[0].cy = 0;
  } else {
    forceLayout(islands, islandLinks, { chargeScale: 130, springRestExtra: 180, centerK: 0.006, springK: 0.05 });
    resolveCollisions(islands, 300); // guarantee islands are separated
  }

  // 5) shift each cluster's cards as a rigid body to its box center
  for (const f of islands) {
    const dx = f.cx - f.localMidX;
    const dy = f.cy - f.localMidY;
    for (const g of f.list) {
      g.cx += dx;
      g.cy += dy;
      g.vx = 0;
      g.vy = 0;
    }
  }
  // intentionally do NOT call global resolveCollisions on cards — it would
  // scramble clusters; overlaps are already gone inside (step 1) and between
  // (step 4) islands.
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

