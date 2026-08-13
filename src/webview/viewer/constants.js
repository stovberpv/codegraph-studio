/*
 * Layout, card, and control metrics for the canvas viewer.
 * Read-only tokens shared across the render, layout, hit-test and icon modules.
 */

export const NODE_H = 24;
export const GAP = 8;
export const PAD = 12;
export const HEADER_H = 24; // header: extension on the left + control icons on the right
export const TITLE_H = 22; // file-name row (body)
export const COLLAPSED_W = 252;
export const COLLAPSED_H = 66;
export const EDIT_W = 520; // default card size in edit mode (user-resizable)
export const EDIT_H = 380;
export const EDIT_MIN_W = 320; // smallest the edit card may be dragged to
export const EDIT_MIN_H = 200;
export const BTN = 16; // clickable control hit cell
export const ICON_PX = 12; // visible icon size (≈ font size), centered in the cell
export const ICON_ZOOM = 0.3; // below this zoom, skip icons (tiny → visual noise)
export const CTRL_GAP = 4; // gap between controls
export const COLLIDE_GAP = 42; // breathing room between cards
// left-to-right in the header
export const ACTIONS = ["edit", "pin", "hideFile", "hideIncoming", "hideOutgoing", "toggle"];
// folder controls (no pin — folder drags via header/card)
export const FOLDER_ACTIONS = ["hideFolder", "hideIncoming", "hideOutgoing", "toggle"];
export const FOLDER_PAD = 28; // breathing room around files inside an island
export const FOLDER_HEAD = 24; // folder header height (same as HEADER_H)
export const FOLDER_CARD_W = 260; // collapsed folder card
export const FOLDER_CARD_H = 60;
