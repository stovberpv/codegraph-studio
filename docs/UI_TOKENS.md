# UI tokens

The dark, monospace design language for Codegraph Studio. Reuse these values in
`src/webview/styles.css`, the `src/extension/templates/webview.pug` markup, and
the canvas painter in `src/webview/viewer/` (metrics live in `viewer/constants.js`,
drawing in `viewer/render.js`). When you need a new value, extend
this file rather than inventing a one-off.

## Color — surfaces

| Token | Value | Use |
|-------|-------|-----|
| bg | `#0e1116` | app background, canvas clear, input background |
| surface-2 | `rgba(17,21,28,0.72)` | control menu icon-buttons |
| surface-pop | `rgba(17,21,28,0.94)` | control menu dropdown popups |
| surface-3 | `rgba(17,21,28,0.66)` | info-bar, legend |
| surface-solid | `#1b222b` | buttons, editor bar |
| surface-group | `#12171e` | segmented button group |
| editor-bg | `#161b22` | on-canvas editor body |
| tooltip-bg | `rgba(20,24,31,0.97)` | tooltip |

## Color — borders

| Token | Value |
|-------|-------|
| border | `#232a33` |
| border-strong | `#2b333d` |
| border-sep | `#262e39` |
| border-hover | `#3a4552` |

## Color — text

| Token | Value | Use |
|-------|-------|-----|
| text | `#e6edf3` | primary |
| text-2 | `#cdd7e1` | button label |
| text-muted | `#9aa7b4` | secondary |
| text-dim | `#8b97a4` | stats, status |
| text-dimmer | `#7d8b9a` | tertiary |
| text-faint | `#6b7684` | legend |
| placeholder | `#4d5763` | input placeholder |
| icon | `#5b6672` | field icons |

## Color — accent & status

| Token | Value | Use |
|-------|-------|-----|
| accent | `#3d7de6` | focus ring, active toggle border |
| accent-strong | `#2f6fe0` | primary button |
| accent-hover | `#5aa0ff` | hovered card/edge highlight |
| accent-soft | `#9ec0ff` | active toggle text |
| brand-purple | `#8b5cf6` | logo gradient end |
| status-dirty | `#e0a83d` | unsaved edits |
| status-ok | `#3fb950` | saved |
| status-error | `#f85149` | error / external change |
| edited-dot | `#5ac47d` | edited-file marker dot in a card's title row |

## Radius

`6px` small · `8px` control · `9px` group/info · `12px` float panel

## Spacing & type

- Base font: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, `12px`,
  line-height `1.35`. Small labels `11px`.
- Standard gap `8px`; control height `32px` (compact `26px`, editor-bar `22px`);
  menu icon-button `34px` square.
- There is no fixed top bar: controls live in corner icon-button menus over a
  full-height canvas. `--toolbar-h` is pinned to `0px`; `#canvas` and `#editors`
  still offset from the top by it (so the editor-geometry contract stays intact).

## Z-index layers

`canvas` base · `#editors` 4 · info-bar / legend 5 · legend-toggle 6 ·
loading-overlay / start-overlay 8 · toast 9 · menu buttons 10 · menu popups 11 ·
tooltip 20. Overlays sit above the canvas but below chrome. The loading overlay is
`pointer-events: none` (never traps input) and its spinner uses the `accent`
color on a `border` track. The start overlay accepts clicks on its CTAs.
The controls legend is collapsed by default into the `legend-toggle` "i" button
(bottom-left, lucide info); it expands just above the button and its open/closed
state persists in `localStorage` (`codegraph:legendOpen`).

## Control menus

Header controls live in corner icon-button menus (`menus.js`). Each `.menu` is a
`.menu-btn` trigger that opens a `.menu-pop` vertical dropdown of its controls;
only one is open at a time, and a click outside or `Esc` closes it. Controls are
grouped by concern, with `.menu-label` section headers and a muted `.menu-note`
for read-only lines (e.g. the current root):
- **top-left** — Project (`#menuProject`: brand title, current root note, then the
  standalone path input + **Reparse**, or the extension's **Reparse project** +
  **Open folder…**) and View (`#menuView`: Layout files/folders, Focus follow/lazy/
  **Zen mode**, Visibility hide-isolated/show-hidden). Zen mode is a combinable
  checkbox (not exclusive like follow/lazy): edited files keep their hue, the rest
  desaturate to gray.
- **top-right** — Arrange (`#menuArrange`: fit to screen, reset layout, expand/
  collapse all) and Search & filter (`#menuSearch`: search + filter fields — the
  only menu that auto-focuses its input on open).

"Reset layout" only re-runs the layout (discards saved positions); "Reparse"
re-parses the project from disk. Popups are transient (not persisted). Left menus
drop down flush-left, right menus (`.menu.right`) flush-right, `6px` below the
trigger.

## Processing toast (`viewer/heavy.js`)

CPU-heavy control actions (force layout, collision passes, bulk edge rebuilds)
run synchronously and block the main thread, so a spinner can only appear if the
`#toast` pill is revealed, the browser paints one frame, then the work runs.
`runHeavy(text, work)` gates this: it shows the top-center toast (spinner +
localized `busy_*` description) only when the action is predicted to block for
~1s+ — `state.groups.length ≥ 400`, `state.edges.length ≥ 4000`, or a previously
measured run of `≥ 600ms` (self-correcting). Fast actions run inline with no
toast. Wrapped controls: Reset layout, Files/Folders, Hide isolated, Expand/
Collapse all, Show hidden, Follow/Lazy. Reparse uses the full loading overlay
instead. The toast is `pointer-events: none` and never persisted.

## Canvas card metrics (`viewer/constants.js`)

| Const | Value | Meaning |
|-------|-------|---------|
| `HEADER_H` | 24 | card header (extension + controls) |
| `TITLE_H` | 22 | card title row (file name) |
| `COLLAPSED_W` × `COLLAPSED_H` | 252 × 66 | collapsed card |
| `EDIT_W` × `EDIT_H` | 520 × 380 | editing card (default; user-resizable) |
| `EDIT_MIN_W` × `EDIT_MIN_H` | 320 × 200 | smallest the edit card may be dragged to |
| `NODE_H` | 24 | function row height |
| `GAP` / `PAD` | 8 / 12 | inner spacing |
| `BTN` | 16 | control hit cell |
| `ICON_PX` | 12 | icon glyph size |
| `ICON_ZOOM` | 0.3 | below this zoom, header icons are hidden |
| `CTRL_GAP` | 4 | gap between controls |
| `COLLIDE_GAP` | 42 | air between cards |
| `FOLDER_HEAD` | 24 | folder header height |
| `FOLDER_PAD` | 28 | air around files inside an island |
| `FOLDER_CARD_W` × `FOLDER_CARD_H` | 260 × 60 | collapsed folder card |

## Canvas edges

- Idle edge stroke: `rgba(120,135,150,0.26)` (dimmed to `0.10` when something is
  focused). Highlighted edge/arrow: `rgba(90,160,255,0.9–0.95)`.
- Ports are chosen from the four side midpoints of each endpoint box so the cubic
  leaves and enters on **outward** sides and does not clip either box; control
  stubs pull along the side normals by `max(24, dist/2)` so long links keep a
  visible bow. Falls back to dominant-axis attachment only when every side pair
  is discarded (degenerate overlap).
- Card fill uses a per-file hue: `hsla(hue, 34%, 17%, 0.72)` (dimmed
  `22%/13%/0.5`); border `hsla(hue, 45%, 45%, 0.75)`.
- Zen mode multiplies each card's (and its functions') saturation by 0 for
  non-edited files, so only edited files keep their hue. Edited files also draw a
  `edited-dot` in the title row regardless of Zen.
- Line widths are divided by `cam.scale` so strokes stay crisp at any zoom.
