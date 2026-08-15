# Changelog

All notable changes to **Codegraph Studio** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-08-15

### Added

- Value-import dependency edges (`kind: "import"`) between file `«module»`
  nodes, including through `import X; export { X }` barrels and Node `#`
  subpaths. They participate in layout; `import type` is ignored. Import links
  draw in a teal tint (solid; call edges stay gray).

### Changed

- Chrome and canvas share one palette (`viewer/palette.js` + `--cg-*` in
  `styles.css`): named tokens instead of one-off hex/rgba. Call edges use
  `text-dim`; hover uses `accent-hover`.
- Marketplace icon: glass file-cards and brand-colored call arcs instead of a
  flat four-node cycle.
- README opens on the studio cover art, then the demo GIF.

### Performance

- Large graphs (e.g. ~17k links): readable cards always draw real file-file
  strokes (including intra-island) with the same curve geometry at every zoom.
  Only cold edges whose both ends are tiny on screen collapse to one
  centroid-to-centroid curve per island pair. Hover/highlight draws incident
  file-file edges on top and does not restyle bundles. View → Performance →
  **Edge LOD** toggles speck bundling.

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

[Unreleased]: https://github.com/stovberpv/codegraph-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/stovberpv/codegraph-studio/releases/tag/v0.1.0
