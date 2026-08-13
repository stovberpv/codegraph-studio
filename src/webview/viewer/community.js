/*
 * Louvain community detection for the "files" layout.
 *
 * A flat force layout of a whole codebase collapses into one blob: every file is
 * in the same force system pulled toward a single center, so there is nothing to
 * separate. Folder mode escapes this by clustering (by directory) and laying out
 * the sparse cluster graph as islands. This module finds clusters from the call
 * graph itself — groups of files more connected to each other than to the rest —
 * so files mode can use the same two-level island layout, grouped by actual
 * connectivity rather than folder path.
 *
 * Louvain greedily maximizes modularity: repeatedly move nodes to the neighboring
 * community that most improves modularity, then collapse each community into a
 * super-node and repeat. The `resolution` γ trades island count for size (higher
 * → more, smaller islands). Modularity naturally discounts hub edges (via the
 * degree term), so a barrel/util imported everywhere doesn't glue the whole graph
 * into one community. Near-linear in practice; DOM-free so it can be tested.
 */

/**
 * Partition `items` into communities from weighted undirected `links`.
 * @param {Array<object>} items - opaque node objects (identity by reference).
 * @param {Array<{a:object,b:object,w:number}>} links - undirected, weight ≥ 0.
 * @param {number} [resolution=1] - γ; higher yields more, smaller communities.
 * @returns {Map<object, number>} item → community id (contiguous from 0).
 */
export function detectCommunities(items, links, resolution = 1) {
  const n = items.length;
  const idOf = new Map();
  for (let i = 0; i < n; i++) idOf.set(items[i], i);
  if (n === 0) return new Map();

  // Level-0 weighted adjacency (indices), plus self-loop weights (all 0 here).
  let adj = Array.from({ length: n }, () => new Map());
  let selfLoop = new Float64Array(n);
  let m2 = 0; // 2m = total incident weight
  for (const l of links) {
    const a = idOf.get(l.a);
    const b = idOf.get(l.b);
    if (a == null || b == null || a === b) continue;
    const w = l.w > 0 ? l.w : 1;
    adj[a].set(b, (adj[a].get(b) || 0) + w);
    adj[b].set(a, (adj[b].get(a) || 0) + w);
    m2 += 2 * w;
  }
  if (m2 === 0) {
    // no edges — every node is its own community
    const out = new Map();
    for (let i = 0; i < n; i++) out.set(items[i], i);
    return out;
  }

  // `membership[i]` maps an original node to its current top-level community.
  let membership = new Int32Array(n);
  for (let i = 0; i < n; i++) membership[i] = i;

  let curN = n;
  for (let pass = 0; pass < 20; pass++) {
    const { comm, changed, k } = oneLevel(adj, selfLoop, m2, resolution);
    // relabel communities to a contiguous range
    const relabel = new Map();
    let next = 0;
    for (let i = 0; i < curN; i++) {
      const c = comm[i];
      if (!relabel.has(c)) relabel.set(c, next++);
    }
    // propagate this level's assignment down to the original nodes
    for (let i = 0; i < n; i++) membership[i] = relabel.get(comm[membership[i]]);
    if (!changed || next === curN) break; // converged / no coarsening
    // build the aggregated graph: one super-node per community
    const K = next;
    const nAdj = Array.from({ length: K }, () => new Map());
    const nSelf = new Float64Array(K);
    for (let i = 0; i < curN; i++) {
      const ci = relabel.get(comm[i]);
      nSelf[ci] += selfLoop[i];
      for (const [j, w] of adj[i]) {
        const cj = relabel.get(comm[j]);
        if (ci === cj) nSelf[ci] += w; // becomes a self-loop (counted once per dir → matches k)
        else nAdj[ci].set(cj, (nAdj[ci].get(cj) || 0) + w);
      }
    }
    adj = nAdj;
    selfLoop = nSelf;
    curN = K;
    void k;
  }

  const out = new Map();
  for (let i = 0; i < n; i++) out.set(items[i], membership[i]);
  return out;
}

/** One Louvain level: greedily move nodes to the best neighboring community. */
function oneLevel(adj, selfLoop, m2, resolution) {
  const n = adj.length;
  const k = new Float64Array(n); // weighted degree (self-loops count twice)
  for (let i = 0; i < n; i++) {
    let d = selfLoop[i] * 2;
    for (const [, w] of adj[i]) d += w;
    k[i] = d;
  }
  const comm = new Int32Array(n);
  const sigTot = new Float64Array(n); // total degree of each community
  for (let i = 0; i < n; i++) {
    comm[i] = i;
    sigTot[i] = k[i];
  }

  let changed = false;
  let moved = true;
  let guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (let i = 0; i < n; i++) {
      const ci = comm[i];
      const ki = k[i];
      // weight from i to each neighboring community
      const wTo = new Map();
      for (const [j, w] of adj[i]) {
        if (j === i) continue;
        const cj = comm[j];
        wTo.set(cj, (wTo.get(cj) || 0) + w);
      }
      // tentatively remove i from its community
      sigTot[ci] -= ki;
      const factor = (resolution * ki) / m2;
      // gain of landing in community c ≈ wTo(c) - γ·ΣtotC·ki/m2 ; staying is the ci case
      let bestC = ci;
      let bestGain = (wTo.get(ci) || 0) - sigTot[ci] * factor;
      for (const [c, w] of wTo) {
        if (c === ci) continue;
        const gain = w - sigTot[c] * factor;
        if (gain > bestGain + 1e-9) {
          bestGain = gain;
          bestC = c;
        }
      }
      sigTot[bestC] += ki;
      if (bestC !== ci) {
        comm[i] = bestC;
        moved = true;
        changed = true;
      }
    }
  }
  return { comm, changed, k };
}
