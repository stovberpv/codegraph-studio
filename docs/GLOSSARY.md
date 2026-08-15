# Glossary

Shared vocabulary for Codegraph Studio. Use these terms consistently in code,
comments, UI, and docs.

## Graph model

- **Graph** — the parsed result: files, nodes, edges (`graph.json`).
- **Node** — a function, method, or class member. The smallest callable unit.
- **Edge** — a resolved call `from → to` between two nodes.
- **`«module»` pseudo-node** — a per-file node collecting top-level (non-function)
  calls, so module-level work is visible.
- **File facts** — per-file parse results (declarations, imports, methods,
  re-exports, class fields) used to resolve calls. Imports are bindings that
  carry the original exported name and kind (named/default/namespace), used for
  alias, namespace, dynamic, Node `#` (`package.json` `"imports"`), and
  path/package-alias resolution.

## Canvas entities

- **Group / card** — the on-canvas box for one file; holds its nodes. Collapsed
  by default, expandable to the function list.
- **Folder / island** — in folder layout, a soft backdrop grouping the cards of
  one directory. Has its own header and controls; collapses to a compact card.
- **Two-level (island) layout** — both layout modes avoid the "ball of mud" the
  same way: cluster files, then spread the clusters apart as islands (pack each
  cluster with a tight local layout, freeze it into a rigid box, then lay out the
  sparse box-to-box graph with strong repulsion / long springs / weak gravity).
  **Folder mode** clusters by directory (and draws the island backdrops);
  **files mode** clusters by **call-graph community** (Louvain, `community.js`),
  so files that call each other land on the same island regardless of directory,
  and a repo-wide util no longer anchors the center of one globe. A final AABB
  pass (`COLLIDE_GAP`) unsticks any cards that still overlap after packing.
- **Unit** — a focusable entity for follow/lazy modes: a file group, a collapsed
  folder card, or an expanded folder island (which focuses the whole folder).
  Adjacency between file/collapsed-folder units is `unitAdj`.
- **renderEdges** — edges aggregated for drawing; endpoints are nodes or cards.

## Controls & state

- **pin** — lock a card's position (not draggable).
- **hideFile** — remove a card and all its edges.
- **hideIncoming / hideOutgoing** — toggle only the edges entering / leaving an
  entity (the entity stays visible).
- **toggle** — collapse / expand a card or folder.
- **edit** — open the on-canvas CodeMirror editor for a file (extension only).

## Modes

- **Layout mode** — `files` (force between cards) or `folder` (force within a
  directory, then between directories).
- **Follow mode** — the whole map is visible; clicking a unit shows only it and
  its direct neighbors; clicking the background restores the map. Clicking a
  folder (collapsed card or expanded island) follows the whole folder — its files
  and their neighbors. Open editors and expanded cards use the same visibility
  as their file: out of the neighborhood they hide, they do not stay floating.
- **Lazy observation** — all files stay visible but edges are hidden; clicking a
  unit reveals just its incoming/outgoing edges. Clicking a folder (collapsed card
  or expanded island) reveals the folder's cross-folder edges.
- **Zen mode** — a recolor-only toggle in the Focus group: edited files keep their
  hue, every other card (and its functions) desaturates to gray. Orthogonal to
  Follow/Lazy (combinable) and transient (not persisted).
- **Glob filter** — show only paths matching a glob (`!` excludes); non-matches
  are hidden without relayout.

## Edited files

- **Edited file** — a file whose content actually **differs from its pristine
  baseline** (the content captured the first time it was opened this session).
  Tracking is content-based, not event-based: the mark is set when the on-disk
  content (canvas save or external write → persisted per root in `localStorage`)
  or the editor buffer (unsaved edits → session-only) diverges from the baseline,
  and it is **cleared when the file is reverted** back to the original — so an
  undo-then-save leaves no stale flag. Marked with a green **edited dot** in the
  card's title row and kept colored in Zen mode.

## Extension terms

- **Host** — the extension side (Node): command `codegraph.open`; opens files via
  `openTextDocument`, mirrors unsaved canvas edits into the real document with a
  `WorkspaceEdit` (dirty, unsaved) and persists on save; delegates parsing to the
  parse worker.
- **Launch view** — empty Activity Bar webview (`codegraph.launch`). When it
  becomes visible it opens the canvas panel and closes the sidebar — a required
  compromise so the icon can launch the graph without a welcome side menu.
- **Start screen** — centered canvas overlay (extension only) with **Analyze
  current project** and **Choose folder**. The host sends `{ type: "start" }`
  only when there is no session-cached graph; until that message (or a `graph`
  replay) the webview shows the loading overlay. Not rendered in standalone mode.
- **Parse worker** — a worker thread (`dist/parse-worker.cjs`) that runs
  `buildGraph` off the host event loop; the host can cancel it and only the
  latest run's result is used.
- **busy** — a host→webview message bracketing a parse; the webview shows its
  loading overlay while busy.
- **progress** — coarse parse status. The worker streams file counts to the
  host, which mirrors a concise line (e.g. "parsing 800/1240 files…") into both
  the Notification and the canvas overlay label so a slow parse never reads as
  hung. Indeterminate spinner, not a percentage; standalone has none.
- **debug trace / output channel** — with `codegraph.debugParsePaths` on, the
  worker streams every directory/file it touches (batched, capped) to the
  "Codegraph Studio" output channel; the last path pinpoints a hang or a macOS
  permission prompt.
- **Webview** — the tab rendering the canvas (`viewer/`, bundled to `viewer.js`)
  plus editor overlays.
- **Overlay / editor** — a CodeMirror instance positioned over a card in the
  `#editors` layer, backed by the real VS Code document: keystrokes are debounced
  into a live `editFile` (unsaved/dirty), and it two-way syncs with a native
  editor of the same file. Unsaved text also survives collapse as a session draft.
- **root** — the workspace/project folder being parsed; also the `localStorage`
  key namespace.
- **rebuild** — re-parse a folder and replace the graph without reloading. The
  `rebuild` message name is kept internally; the Project menu labels it **Reparse**
  (distinct from **Reset layout**, which only re-runs the layout).
- **pickFolder** — webview→host message that opens a folder dialog and parses
  the chosen root (start-screen **Choose folder**).
