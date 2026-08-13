# Architecture & Development

Developer-facing reference for Codegraph Studio: how the project is laid out, how
the pieces fit together, how to build it, and how to run it without VS Code. The
[README](../README.md) covers the plugin itself; everything here is for people
working _on_ the project.

## Project structure

```
src/
  core/parse.ts                    # parser + buildGraph() (CLI, server, worker)
  server/serve.ts                  # standalone dev server + /api/rebuild
  extension/extension.ts           # VS Code host: command, webview, save
  extension/parse-worker.ts        # worker thread: runs buildGraph off the host
  extension/templates/webview.pug  # single markup source (both runtimes)
  webview/viewer/                  # canvas renderer (ES modules, bundled → viewer.js)
    index.js                       #   entry: render loop, resize, load(), __cg hook
    state.js constants.js dom.js i18n.js  # foundations (shared state + tokens + refs)
    utils.js visibility.js glob-filter.js icons.js folders.js  # helpers & geometry
    io.js persistence.js sizing.js layout.js edges.js fit.js edge-geometry.js
    render.js hit-test.js collapse.js interaction.js search-controls.js
    legend.js rebuild.js           #   feature modules (one per former section)
  webview/editor-overlay.js        # CodeMirror overlays
  webview/styles.css               # styles
scripts/esbuild.mjs                # build: bundle + precompile Pug + render html
media/                             # packaged assets (Activity Bar icon)
docs/                              # invariants, glossary, ui tokens, this file
dist/                              # generated build output
```

## How it works

- **`src/core/parse.ts`** — walks `.ts/.tsx` via the TypeScript AST (no
  type-checker, for speed) and resolves calls into edges; exports `buildGraph()`.
- **`src/webview/viewer/` + `styles.css` + `webview.pug`** — the canvas: cards,
  edges, layouts, modes, and `localStorage` persistence. The viewer is a set of
  ES modules (entry `viewer/index.js`) bundled by esbuild into a single
  `dist/webview/viewer.js` IIFE, mirroring `editor-overlay.js`. Reassignable
  scene state is centralized in `viewer/state.js`. Both runtimes render from the
  same Pug template.
- **`src/server/serve.ts`** — standalone static server plus `POST /api/rebuild`.
- **`src/extension/extension.ts` + `src/webview/editor-overlay.js`** — the VS Code
  host and the CodeMirror overlays; bundled by `scripts/esbuild.mjs`. The
  Activity Bar container contributes an empty **launch view**
  (`codegraph.launch`): its `WebviewViewProvider` opens the canvas panel and
  closes the sidebar, so the icon launches the graph without a side menu. The
  panel shows a **start screen** (Analyze current project / Choose folder) until
  the user picks a root; parsing does not start on webview `ready` alone.
- **`src/extension/parse-worker.ts`** — a worker thread that runs `buildGraph`
  off the host event loop so the editor stays responsive; the host shows a
  cancellable progress spinner, streams coarse file-count progress into both the
  Notification and the canvas overlay label (`busy` + `progress` messages), and
  can trace every path the parser touches when diagnosing (see below). Only this
  bundle carries the TypeScript compiler.

## Diagnostics

The extension owns a **"Codegraph Studio" output channel** (`vscode.OutputChannel`).
Every parse logs the resolved `root`, `selfDir`, and the final file/node/edge
counts. Turning on the `codegraph.debugParsePaths` setting (default off) makes
the worker additionally stream each directory and file it touches — each
directory is logged immediately before its `readdir`, so if a parse hangs or
macOS raises a permission prompt, the **last path in the channel identifies the
culprit**. The trace is batched and capped at 2000 paths per parse. This is
extension-only; standalone mode has no worker and no channel.

## Development

```bash
npm install
npm run build     # bundle host + webview into dist/
npm run watch     # rebuild on change
npm run package   # build a .vsix
npm run graph     # standalone: parse + serve
```

Edit the source files, not `dist/**` (generated). See the docs below for the
contracts that keep the two runtimes in sync.

## Standalone mode (no VS Code)

The same canvas runs in a browser for quick exploration:

```bash
npm run build              # bundle + render dist/webview
npx tsx src/core/parse.ts  # build graph.json for the current folder
npx tsx src/server/serve.ts # serve http://localhost:5173
```

`parse.ts` flags: `--root DIR`, `--out FILE`, `--include-tests`.
Ignored directories (`SKIP_DIRS`): `node_modules`, `.git`, `dist`, `build`,
`out`, `.next`, `.nuxt`, `.output`, `coverage`, `.cache`, `.turbo`, `.vite`,
`tmp`; plus `.d.ts` files. The walk uses `readdir({ withFileTypes: true })` and
descends only real sub-directories — `dirent.isDirectory()` is false for
symlinks, so it never follows a symlink out of `root`, and entries of unknown
type (`DT_UNKNOWN`) are skipped rather than `stat`-ed.

## Related docs

- [INVARIANTS.md](INVARIANTS.md) — contracts that must hold (runtime parity,
  message protocol, security, geometry, persistence).
- [GLOSSARY.md](GLOSSARY.md) — shared vocabulary.
- [UI_TOKENS.md](UI_TOKENS.md) — colors, spacing, and canvas metrics.
