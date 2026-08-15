# Codegraph Studio

> Explore your TypeScript codebase as an interactive call graph — and edit files
> right on the canvas, without leaving the map.

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=stovberpv.codegraph-studio"><img alt="VS Marketplace Version" src="https://img.shields.io/visual-studio-marketplace/v/stovberpv.codegraph-studio?label=VS%20Marketplace&logo=visualstudiocode&color=2ea043"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=stovberpv.codegraph-studio"><img alt="Installs" src="https://img.shields.io/visual-studio-marketplace/i/stovberpv.codegraph-studio?label=installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=stovberpv.codegraph-studio&ssr=false#review-details"><img alt="Rating" src="https://img.shields.io/visual-studio-marketplace/r/stovberpv.codegraph-studio?label=rating"></a>
  <a href="https://open-vsx.org/extension/stovberpv/codegraph-studio"><img alt="Open VSX Version" src="https://img.shields.io/open-vsx/v/stovberpv/codegraph-studio?label=Open%20VSX&color=a60ee5"></a>
  <a href="https://github.com/stovberpv/codegraph-studio/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stovberpv/codegraph-studio/ci.yml?branch=main&label=CI&logo=github"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/stovberpv/codegraph-studio?color=blue"></a>
</p>

Codegraph Studio parses a TypeScript/TSX project with the TypeScript AST, builds
a call graph between functions, and renders it on a fast, zoomable canvas. Cards
are files, curved arrows are calls. Inside VS Code you can open a file **on the
canvas** in an embedded editor (syntax highlighting, save via the workspace),
while the graph, links, zoom, and pan stay live around it.

<p align="center">
  <a href="https://github.com/stovberpv/codegraph-studio/blob/main/media/preview.mp4">
    <img alt="Codegraph Studio — interactive call graph demo" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/preview.gif" width="900">
  </a>
</p>

<p align="center">
  <a href="https://github.com/stovberpv/codegraph-studio/blob/main/media/preview.mp4">▶ Watch the full-quality MP4</a>
</p>

## Screenshots

Cards are files, curved arrows are calls. Hover a card to light its neighbors;
open several editors on the canvas and keep the map around them.

<p align="center">
  <img alt="Call graph — files as cards, calls as curved arrows" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/screenshots/call-graph.png" width="900">
</p>
<p align="center"><em>Call graph — 196 files, ~1000 functions, ~1800 links</em></p>

<p align="center">
  <img alt="Hover highlight — neighbors and links light up, the rest dim" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/screenshots/hover-links.png" width="900">
</p>
<p align="center"><em>Hover — the focused card and its links stay bright</em></p>

<p align="center">
  <img alt="Folder islands — files clustered by directory with island backdrops" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/screenshots/folder-islands.png" width="900">
</p>
<p align="center"><em>Folder islands — directory clusters with their own chrome</em></p>

<p align="center">
  <img alt="Expanded card — function list inside a file" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/screenshots/expanded-card.png" width="900">
</p>
<p align="center"><em>Expanded card — functions in the file, still on the map</em></p>

<p align="center">
  <img alt="On-canvas editor — CodeMirror overlay with the graph behind it" src="https://raw.githubusercontent.com/stovberpv/codegraph-studio/main/media/screenshots/on-canvas-editor.png" width="900">
</p>
<p align="center"><em>On-canvas editor — syntax highlighting, save via the workspace; open more than one card at a time</em></p>

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
Node `#` subpaths via `package.json` `"imports"` (including targets under
`build`/`dist`/`out` remapped to source), tsconfig-path and workspace-package
aliases, top-level module calls, instance methods, and dependency injection
through constructors and fields.

## Features

- **Call graph on canvas** — files as cards, calls as curved arrows; smooth zoom,
  pan, and drag with viewport culling for large graphs.
- **On-canvas editing (VS Code)** — a per-file CodeMirror 6 editor scaled with the
  camera; save with ⌘/Ctrl+S through the workspace.
- **Two layouts** — gravity between files, or gravity within a folder then between
  folders (folder “islands”).
- **Focus modes** — *Follow* (show a file and its direct links) and *Lazy
  observation* (all files visible, links revealed on click). Open editors hide
  with their card.
- **Per-card controls** — edit, pin, hide file, hide incoming/outgoing links,
  collapse/expand. Folders get their own header controls.
- **Glob filter, search, isolated-node hiding.**
- **Persistent layout** — positions and states saved per project in
  `localStorage`.
- **Live rebuild** — re-parse a folder and refresh the graph in place.
- **Responsive parsing** — parsing runs in a background worker with a
  cancellable progress spinner, so the editor never blocks on large projects.

## Requirements

- VS Code `^1.85.0`
- A workspace folder open (the first workspace folder is parsed)

## Install

**From the Marketplace (recommended):**

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=stovberpv.codegraph-studio"><img alt="Install from VS Marketplace" src="https://img.shields.io/badge/VS%20Marketplace-Install-2ea043?logo=visualstudiocode"></a>
  <a href="https://open-vsx.org/extension/stovberpv/codegraph-studio"><img alt="Install from Open VSX" src="https://img.shields.io/badge/Open%20VSX-Install-a60ee5"></a>
</p>

In VS Code, open the Extensions view (`⇧⌘X` / `Ctrl+Shift+X`), search for
**Codegraph Studio**, and click **Install** — or run
`ext install stovberpv.codegraph-studio` from the Command Palette.

**From VSIX (offline / pre-release):**

```bash
npm install
npm run package        # produces codegraph-studio-<version>.vsix
```

Then in VS Code: **Extensions: Install from VSIX…** and pick the file.

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

## License

[MIT](LICENSE) © 2026 Paul Stovber
