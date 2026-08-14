# Invariants

Contracts that must stay true. Break one and the app misbehaves silently, so
uphold them in every change and update this file when a contract legitimately
changes.

## Runtime parity

- **One markup source.** Both runtimes render from a single Pug template,
  `src/extension/templates/webview.pug`. The build precompiles it to
  `src/extension/generated/webview-template.cjs`; the extension renders it at
  runtime (with `nonce`/`csp`/webview URIs), and the build renders it with
  `standalone: true` into `dist/webview/index.html`. Types for that import live
  in the committed `webview-template.d.cts` so `tsc` works before a build.
  Change the UI in the Pug template, never in a hand-written HTML copy.
- **Data parity.** The webview (`src/webview/viewer/`) receives its graph two ways:
  `fetch('graph.json')` in standalone, and a `graph` message via `postMessage`
  inside the extension. Every data change must work through both paths.

## Webview ↔ host message protocol

Canonical message set. Extend deliberately and reflect changes here.

- host → webview: `graph`, `busy`, `progress`, `start`, `fileContent`, `saved`, `error`, `externalChange`
- webview → host: `ready`, `openFile`, `editFile`, `saveFile`, `rebuild`, `pickFolder`

The webview sends `ready` on load. Until the host answers, the extension
webview shows the full-canvas loading overlay (`Loading…`), not the start
buttons. The host does **not** auto-parse on `ready` unless a command already
set `pendingRoot` (Parse Folder… / Reparse Workspace before the panel existed).
Failing that, if a graph was already parsed earlier in the session the host
replays the cached `lastGraph` (so closing and reopening the panel does not
force a re-parse); the cache survives panel disposal and is cleared only on
deactivate. Only a first-ever open with no cache gets `{ type: "start" }`, which
hides the spinner and shows the start screen. The host then answers with
`graph` after the user clicks **Analyze current project**
(`rebuild` with no root → workspace folder) or **Choose folder** (`pickFolder` →
`showOpenDialog` → `sendGraph`). The Project menu mirrors these two actions
(**Reparse project** / **Open folder…**), so the same messages drive reparsing
from inside the canvas after the first parse. Around every parse the host brackets the work
with `busy` (`{ busy: true }` before, `{ busy: false }` after success, error, or
cancel); the webview hides the start screen and shows its loading overlay while
busy. While a parse runs the host may stream `progress`
(`{ type: "progress"; text }`) with a concise, already-localized status (e.g.
"parsing 800/1240 files…"); the webview writes `text` into the overlay's
`.loading-label` so a slow parse reads as alive, not hung. `progress` is
advisory (zero or more, never guaranteed) and is reset to the idle `analyzing`
label whenever `busy: true` re-shows the overlay. Standalone has no worker and
sends no `progress`; its overlay keeps the plain `analyzing`/`rebuilding` label.
In standalone (no host) there is no start screen — the webview toggles the same
loading overlay itself around `fetch('graph.json')`. The on-canvas editor is
backed by the **real** VS Code document. Opening sends `openFile` → the host
opens the file via `openTextDocument` (so any unsaved in-model edits are
included) and replies `fileContent`. Each keystroke is debounced (~250ms) into an
`editFile` → the host applies a `WorkspaceEdit` **without saving**, so the file
becomes dirty in VS Code and reflects everywhere; `saveFile` applies then
`doc.save()` → host replies `saved` (or `error`). Edits made in a native VS Code
editor of the same file flow back as `externalChange` (both on change and on
save). The host tracks the last text the canvas and document agree on per path
(`syncedText`) and only forwards a change whose text differs from it, so the
host's own writes — and a canvas that is briefly ahead of the debounced sync —
are never mislabeled as external changes. All paths resolve against the parsed
graph root (`lastRoot`), not the workspace folder, so parsing an arbitrary folder
still edits its real files.

Internally the parse worker streams its own messages to the host, distinct from
the final `{ ok, graph }` reply and told apart by `type`:

- `{ type: "progress"; phase; files; parsed }` — coarse counts; the host formats
  them into the `progress` text above and into the cancellable Notification's
  `progress.report`.
- `{ type: "debug"; paths: string[] }` — batched per-path trace (each directory
  before it is read, each file before it is read), emitted only when the
  `codegraph.debugParsePaths` setting is on and capped at 2000 paths per parse.
  The host appends them to the "Codegraph Studio" output channel so the last
  path before a hang or a macOS permission prompt is visible.

This worker→host channel is not part of the webview protocol.

## Webview security

- Scripts run only with the per-open `nonce`; no inline scripts, no external
  origins.
- Local resources (`viewer.js`, `styles.css`, `editor.js`) load through
  `webview.asWebviewUri`.
- `connect-src` is limited to `webview.cspSource` (our own resource origin) so
  DevTools can fetch the bundles' source maps in dev; no other origins are
  allowed. Maps are excluded from the packaged VSIX by `.vscodeignore`.
- The CSP in `getHtml()` is the source of truth for what may load.

## Build & sources

- Edit source files under `src/`. `dist/**` and `src/**/generated/**` are
  generated by `npm run build` (`scripts/esbuild.mjs`) and are never hand-edited.
  `npm run build:prod` (used by `npm run package`) emits the same bundles
  minified and without sourcemaps; dev/watch stay readable with maps.
- The build produces `dist/extension.cjs` (Node/CJS host), `dist/parse-worker.cjs`
  (Node/CJS parse worker) and `dist/webview/{viewer.js,styles.css,editor.js,
  index.html}` (browser), and precompiles the Pug template to
  `src/extension/generated/`.
- `dist/webview/viewer.js` and `dist/webview/editor.js` are **bundled** browser
  IIFEs (from `src/webview/viewer/index.js` and `src/webview/editor-overlay.js`);
  only `styles.css` is copied verbatim. The viewer's ES modules must stay bundled
  into that single nonce'd artifact — `webview.pug` (`viewerSrc`), the CSP, and
  `serve.ts` all reference the one `viewer.js` file.
- Only the worker bundles `buildGraph` (and thus the TypeScript compiler); the
  host stays lean and spawns the worker by path. `src/core/parse.ts` guards its
  CLI entry so importing `buildGraph` never runs `main()`. The guard requires the
  **main thread**: when bundled into the worker, esbuild rewrites `import.meta.url`
  to the bundle path and a worker thread's `process.argv[1]` resolves to that same
  file, so the direct-invocation check alone would misfire and run the CLI (walking
  `process.cwd()`) at worker load — blocking the worker before it can parse.

## Canvas ↔ editor overlay geometry

- The `#editors` layer is offset from the top by `--toolbar-h`, exactly like
  `#canvas`; it is `pointer-events: none` and only its children capture input.
- Each editor overlay follows the camera: `left = g.x*scale + cam.x`,
  `top = g.y*scale + cam.y`, with `transform: scale(cam.scale)` and
  `transform-origin: top left`. World-space size stays in `g.w/g.h`. The overlay
  covers the **whole card including the header**, so overlapping editors stack as
  one unit (header stays above another card's body). Clicking an overlay raises
  its z-index. Canvas skips drawing header chrome while `g.editing`.
- An overlay is shown only while its card is `groupVisible` (the same follow /
  lazy / glob / folder-collapse rules as the canvas card). Hidden overlays stay
  mounted (`g.editing` unchanged) so they return when the card is shown again.
  Horizontal overflow is clipped; the CodeMirror buffer wraps instead of growing
  a scaled native scrollbar.
- The edit card is user-resizable via a bottom-right grip. The grip's screen-pixel
  drag is divided by `cam.scale` into world units and stored as `g.editW/g.editH`
  (clamped to `EDIT_MIN_W/EDIT_MIN_H`); `applySize` uses them in edit mode. Live
  resize only changes geometry (edges reattach on paint). On commit, neighbors
  are pushed apart by `COLLIDE_GAP` (same AABB pass as expand) so the grown card
  does not cover another file.
- After force/island layout, and when a saved layout is applied, overlapping
  card AABBs are separated (`COLLIDE_GAP`). Only pairs closer than the gap move,
  so islands stay intact. Opening or closing the on-canvas editor uses the same
  pass, pinning the resized card's top-left.
- Function-row pills track the card width (`n.w = g.w - PAD*2`). Whenever a card's
  size changes while expanded, `layoutInner` must re-flow the rows so they never
  overflow the card — every `applySize` on an expanded card (including leaving edit
  mode in `onEditingChange`) is paired with `layoutInner`.
- Editor input (wheel, pointer, keys) does not propagate to canvas zoom/pan.
  Dragging the overlay header/title bar uses pointer capture on that handle
  (same as the resize grip) and the viewer's `beginGroupDrag` / `continueGroupDrag`
  / `endGroupDrag` APIs, because stopped mouse bubbling would otherwise freeze
  the card under the cursor and never see `mouseup`.

## Card & folder controls

- Card header actions, left → right: `edit`, `pin`, `hideFile`, `hideIncoming`,
  `hideOutgoing`, `toggle`.
- Folder actions: `hideFolder`, `hideIncoming`, `hideOutgoing`, `toggle`
  (no pin — a folder is dragged by its header/card).

## Persistence

- Layout state lives in `localStorage`, keyed by project root (`storeKey`,
  `filterKey`), so each project keeps its own arrangement.
- The positions schema is versioned (`v: 2`). Function positions are stored as
  offsets relative to their card, so moving a card carries its functions. Each
  group also persists its edit-card size (`ew/eh`); older saves without them fall
  back to the defaults.

## Rebuild

- Standalone rebuilds via `POST /api/rebuild` in `serve.ts`.
- The extension rebuilds via a `rebuild` message handled in the host.
- In the extension the parse runs in a worker thread (`dist/parse-worker.cjs`),
  off the host event loop, wrapped in a cancellable Notification progress. The
  worker streams coarse file-count progress that the host mirrors into both the
  Notification message and the canvas overlay label. A newer parse supersedes an
  older one by terminating its worker, so only the latest result reaches the
  webview; a cancelled parse leaves the current graph in place.

## Parser honesty

- `parse.ts` uses the AST only (no type-checker) for speed. The resolver follows
  aliased, namespace, and dynamic imports, plus tsconfig-path and workspace-package
  aliases when the target is inside the parsed root.
- Unresolved calls are dropped. Never fabricate an edge to make the graph look
  connected.
- Empty `«module»` pseudo-nodes without any edge are removed.

## Change discipline

- No unsolicited fallbacks, defaults, or silent recovery. Add them only when the
  user asks or a documented contract requires it.
