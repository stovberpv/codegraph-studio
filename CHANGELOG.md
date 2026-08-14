# Changelog

All notable changes to **Codegraph Studio** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Call-graph curves no longer cut through their endpoint cards: ports are picked
  from outward side midpoints so the cubic leaves and enters without clipping.
  Stub pull scales with port distance (`max(24, dist/2)`) so long links keep a
  visible bow instead of collapsing to a straight chord.
- Opening or resizing an on-canvas editor pushes neighboring cards apart
  (`COLLIDE_GAP`) so the grown card does not sit on top of another file.
  Relayout and restoring a saved layout run the same AABB pass, so stacked
  collapsed cards (tight inner springs, or an older save) unstick on load.

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
  tsconfig-path and workspace-package aliases, instance methods, and constructor/
  field dependency injection).
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

[Unreleased]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/stovberpv/codegraph-studio/releases/tag/v0.1.0
