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
| surface-1 | `rgba(17,21,28,0.9)` | toolbar |
| surface-2 | `rgba(17,21,28,0.72)` | float panels |
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

## Radius

`6px` small · `8px` control · `9px` group/info · `12px` float panel

## Spacing & type

- Base font: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, `12px`,
  line-height `1.35`. Small labels `11px`.
- Standard gap `8px`; control height `32px` (compact `26px`, editor-bar `22px`).
- Toolbar height is dynamic via `--toolbar-h` (default `52px`); `#canvas` and
  `#editors` offset from the top by it.

## Z-index layers

`canvas` base · `#editors` 4 · info-bar / legend 5 · float-panel /
legend-toggle 6 · loading-overlay / start-overlay 8 · toolbar 10 · tooltip 20.
Overlays sit above the canvas but below chrome. The loading overlay is
`pointer-events: none` (never traps input) and its spinner uses the `accent`
color on a `border` track. The start overlay accepts clicks on its CTAs.
The controls legend is collapsed by default into the `legend-toggle` "i" button
(bottom-left, lucide info); it expands just above the button and its open/closed
state persists in `localStorage` (`codegraph:legendOpen`).

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
- Card fill uses a per-file hue: `hsla(hue, 34%, 17%, 0.72)` (dimmed
  `22%/13%/0.5`); border `hsla(hue, 45%, 45%, 0.75)`.
- Line widths are divided by `cam.scale` so strokes stay crisp at any zoom.
