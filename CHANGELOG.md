# Changelog

All notable changes to **Codegraph Studio** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Call edges through Node `#` subpath imports (`package.json` `"imports"`) now
  resolve, including aliases that point at `build`/`dist`/`out` and barrel
  `export *` chains (e.g. `import { fn } from '#methods'`).

## [0.1.3] - 2026-08-14

### Changed

- Hover dim of the rest of the graph eases in and out instead of snapping, and
  survives the gap between cards so sweeping the cursor does not flicker.

### Fixed

- `tsc` and the IDE resolve the webview Pug import without a prior build: types
  for `webview-template.cjs` are committed as `webview-template.d.cts`.

## [0.1.2] - 2026-08-14

### Fixed

- On-canvas editors now follow the same Focus/Visibility rules as their cards
  (follow neighborhood, glob filter, collapsed folder): they hide with the card
  instead of leaving a headerless overlay behind.
- Horizontal scrollbar in the on-canvas editor: long lines wrap inside the card
  instead of overflowing a camera-scaled native scroller.
- Overlapping on-canvas editors stack as a whole card (header stays above the
  other file's body); clicking an editor brings it to front.
- Dragging an open editor by its header actually moves and releases: pointer
  capture on the chrome/title bar, so the overlay no longer swallows `mouseup`
  and the card does not stick to the cursor.
- Call-graph curves no longer cut through their endpoint cards. Side midpoints
  are scored with one cost (clip, length, exit kink, alley tighter than
  `COLLIDE_GAP`, same-side detour tax). The last pair sticks while dragging.
  Long links keep a visible bow: detour stubs scale with span, and collinear
  T–B / L–R handles offset perpendicular to the chord so the cubic is not a
  straight line.
- Opening or resizing an on-canvas editor pushes neighboring cards apart
  (`COLLIDE_GAP`) so the grown card does not sit on top of another file.
  Relayout and restoring a saved layout run the same AABB pass, so stacked
  collapsed cards (tight inner springs, or an older save) unstick on load.
- Reopening the panel with a session-cached graph shows the full-canvas
  loading overlay (`Loading…`) instead of the start-screen buttons, then
  restores the graph. The start CTAs appear only when nothing has been parsed
  yet this session (`start` message).

## [0.1.1] - 2026-08-14

### Changed

- Marketplace-safe demo GIF (under 800 KB) that links to the GitHub MP4 player,
  plus README screenshots for the call graph, hover highlighting, folder
  islands, expanded cards, and the on-canvas editor.

## [0.1.0] - 2026-08-13

### Added

- Initial public release.
- TypeScript/TSX call-graph parsing via the TypeScript AST (ESM `.js`
  specifiers, `new Foo()`, barrel re-exports, namespace/aliased/dynamic imports,
  Node `#` subpaths via `package.json` `"imports"`, tsconfig-path and
  workspace-package aliases, instance methods, and constructor/field dependency
  injection).
- Fast, zoomable canvas viewer with viewport culling for large graphs.
- On-canvas per-file CodeMirror 6 editor that writes back to the real VS Code
  document (live dirty sync, save with ⌘/Ctrl+S).
- Two layouts: file-level force layout and folder "islands", both using a
  two-level (island) layout with Louvain community detection in files mode.
- Focus modes: *Follow* and *Lazy observation*.
- Per-card and per-folder controls, glob filter, search, and isolated-node
  hiding.
- Per-project persistence of positions and states in `localStorage`.
- Live rebuild and a cancellable background-worker parser with progress
  reporting.

[Unreleased]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/stovberpv/codegraph-studio/releases/tag/v0.1.0
