# Codegraph Studio

> Explore your TypeScript codebase as an interactive call graph — and edit files
> right on the canvas, without leaving the map.

Codegraph Studio parses a TypeScript/TSX project with the TypeScript AST, builds
a call graph between functions, and renders it on a fast, zoomable canvas. Cards
are files, curved arrows are calls. Inside VS Code you can open a file **on the
canvas** in an embedded editor (syntax highlighting, save via the workspace),
while the graph, links, zoom, and pan stay live around it.

<!-- ┌─────────────────────────────────────────────────────────────────────┐ -->
<!-- │ HERO / DEMO VIDEO                                                    │ -->
<!-- │ Replace with a short screen recording (GIF or MP4/loop).            │ -->
<!-- └─────────────────────────────────────────────────────────────────────┘ -->

<!-- TODO(preview): demo video -->
<!--
https://github.com/stovberpv/codegraph-studio/assets/<id>/<demo.mp4>
-->

![Codegraph Studio — call graph on the canvas](docs/media/hero.png)
<!-- TODO(preview): add docs/media/hero.png -->

---

## Why

Reading a large TypeScript codebase file-by-file hides the shape of the system.
Codegraph Studio shows that shape:

- **See the architecture at a glance** — clusters, hubs, and islands of related
  code emerge from an automatic force layout.
- **Follow a dependency, not a hunch** — focus a file to see exactly what it
  calls and what calls it.
- **Fix in place** — spot something on the map and edit the file on the same
  canvas, keeping your spatial context.

It works on real-world code: ESM `.js`-specifier imports, `new Foo()`, barrel
re-exports, namespace (`import * as`), aliased, and dynamic `import()` imports,
tsconfig-path and workspace-package aliases, top-level module calls, instance
methods, and dependency injection through constructors and fields.

## Features

- **Call graph on canvas** — files as cards, calls as curved arrows; smooth zoom,
  pan, and drag with viewport culling for large graphs.
- **On-canvas editing (VS Code)** — a per-file CodeMirror 6 editor scaled with the
  camera; save with ⌘/Ctrl+S through the workspace.
- **Two layouts** — gravity between files, or gravity within a folder then between
  folders (folder “islands”).
- **Focus modes** — *Follow* (show a file and its direct links) and *Lazy
  observation* (all files visible, links revealed on click).
- **Per-card controls** — edit, pin, hide file, hide incoming/outgoing links,
  collapse/expand. Folders get their own header controls.
- **Glob filter, search, isolated-node hiding.**
- **Persistent layout** — positions and states saved per project in
  `localStorage`.
- **Live rebuild** — re-parse a folder and refresh the graph in place.
- **Responsive parsing** — parsing runs in a background worker with a
  cancellable progress spinner, so the editor never blocks on large projects.

<!-- TODO(preview): feature screenshots -->
<!--
| Files layout | Folder islands | On-canvas editor |
| --- | --- | --- |
| ![](docs/media/layout-files.png) | ![](docs/media/layout-folders.png) | ![](docs/media/editor.png) |
-->

## Requirements

- VS Code `^1.85.0`
- A workspace folder open (the first workspace folder is parsed)

## Install

**From VSIX (current):**

```bash
npm install
npm run package        # produces codegraph-studio-<version>.vsix
```

Then in VS Code: **Extensions: Install from VSIX…** and pick the file. Or press
**Run and Debug → Run Codegraph Studio Extension** to launch a dev host.

<!-- TODO(marketplace): add Marketplace install once published -->

## Usage

1. Open your project folder in VS Code.
2. Open the graph from the **Codegraph Studio** icon in the Activity Bar (opens
   the canvas directly; no side menu) or by running **Codegraph Studio: Open Call
   Graph** from the Command Palette.
3. On the canvas start screen, click **Analyze current project** (workspace
   folder) or **Choose folder** (folder picker). Parsing starts only after that.
4. Explore: scroll to zoom, drag the background to pan, drag a card to move it.
5. Click the ✎ control on a card to edit that file on the canvas; save with
   ⌘/Ctrl+S.

## Troubleshooting

- **A parse is slow or seems stuck.** Parsing runs in a background worker with a
  cancellable Notification and a live "parsing K/N files…" label on both the
  Notification and the canvas overlay — if the counts keep moving, it is working,
  not frozen. You can cancel from the Notification.
- **A parse hangs or macOS asks for permission to other apps' data.** Turn on
  **Settings → Codegraph Studio → `codegraph.debugParsePaths`**, reparse, and
  open the **"Codegraph Studio"** output channel (View → Output → "Codegraph
  Studio"). Each parse logs its `root`/`selfDir` and traces every directory and
  file it reads; the **last path logged before the prompt/hang is the culprit**.

## Limitations

- No type-checker: calls on values of arbitrary type, untyped injections, and
  external npm packages are intentionally not resolved. tsconfig-path and
  workspace-package aliases within the project are.
- At strong zoom-out, editor text is scaled (a deliberate trade-off).
- No IntelliSense in the on-canvas editor — syntax highlighting only.

## Contributing & development

Building the extension, the project layout, standalone (browser) mode, and the
internals live in the developer docs:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, how it works, build,
  and standalone mode.
- [docs/INVARIANTS.md](docs/INVARIANTS.md) — contracts that must hold.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — shared vocabulary.
- [docs/UI_TOKENS.md](docs/UI_TOKENS.md) — colors, spacing, and canvas metrics.

## License

See [LICENSE](LICENSE).
