# Changelog

All notable changes to **Codegraph Studio** are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/stovberpv/codegraph-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stovberpv/codegraph-studio/releases/tag/v0.1.0
