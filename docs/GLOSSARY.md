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
  alias, namespace, dynamic, and path/package-alias resolution.

## Canvas entities

- **Group / card** — the on-canvas box for one file; holds its nodes. Collapsed
  by default, expandable to the function list.
- **Folder / island** — in folder layout, a soft backdrop grouping the cards of
  one directory. Has its own header and controls; collapses to a compact card.
- **Unit** — a focusable entity for follow/lazy modes: either a file group or a
  collapsed folder card. Adjacency between units is `unitAdj`.
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
  its direct neighbors; clicking the background restores the map.
- **Lazy observation** — all files stay visible but edges are hidden; clicking a
  unit reveals just its incoming/outgoing edges.
- **Glob filter** — show only paths matching a glob (`!` excludes); non-matches
  are hidden without relayout.

## Extension terms

- **Host** — the extension side (Node): command `codegraph.open`, file read,
  save via `WorkspaceEdit`; delegates parsing to the parse worker.
- **Launch view** — empty Activity Bar webview (`codegraph.launch`). When it
  becomes visible it opens the canvas panel and closes the sidebar — a required
  compromise so the icon can launch the graph without a welcome side menu.
- **Start screen** — centered canvas overlay (extension only) with **Analyze
  current project** and **Choose folder**; shown until a root is chosen. Not
  rendered in standalone mode.
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
  `#editors` layer.
- **root** — the workspace/project folder being parsed; also the `localStorage`
  key namespace.
- **rebuild** — re-parse a folder and replace the graph without reloading.
- **pickFolder** — webview→host message that opens a folder dialog and parses
  the chosen root (start-screen **Choose folder**).
