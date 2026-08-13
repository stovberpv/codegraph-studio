/*
 * Small shared helpers: text measuring, coordinate math, path splitting, and
 * the entity predicates (group / folder / node) used across modules.
 */
import { ctx } from "./dom.js";
import { state, cam } from "./state.js";

/** Stable hue from a string hash — colors cards/folders consistently by path. */
export function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

const measureCache = new Map();
/** Measure text width with a small cache to avoid repeated canvas measureText. */
export function textWidth(t) {
  let w = measureCache.get(t);
  if (w === undefined) {
    w = ctx.measureText(t).width;
    measureCache.set(t, w);
  }
  return w;
}

/** Convert screen (CSS pixel) coordinates into world space via the camera. */
export function screenToWorld(sx, sy) {
  return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
}

/** Last path segment of a file path. */
export function basename(f) {
  const p = f.split("/");
  return p[p.length - 1];
}
/** Parent directory of a file path ("." for roots). */
export function dirname(f) {
  const i = f.lastIndexOf("/");
  return i <= 0 ? "." : f.slice(0, i);
}
/** Split a basename into {name, ext} at the last dot (for header layout). */
export function splitName(f) {
  const b = basename(f);
  const i = b.lastIndexOf(".");
  if (i <= 0) return { name: b, ext: "" };
  return { name: b.slice(0, i), ext: b.slice(i) };
}

/** True if x is a file-card group entity. */
export const isGroup = (x) => x && x.ids !== undefined;
/** True if x is a folder entity. */
export const isFolder = (x) => x && x.files !== undefined;
/** Stable string key for an entity (folder/group/node) used in edge dedupe. */
export const entKey = (x) => (isFolder(x) ? "f:" + x.key : isGroup(x) ? "g:" + x.path : "n:" + x.id);

/** Edge endpoint for a function: the node if expanded, else its file card. */
export const endpoint = (fn) => (fn.group && fn.group.expanded ? fn : fn.group);

/** Whether an entity is in the current search highlight set. */
export const isHi = (ent) => (isGroup(ent) ? state.highlightGroups.has(ent) : state.highlight.has(ent.id));

/** Escape &, <, > for safe insertion into tooltip HTML. */
export function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
