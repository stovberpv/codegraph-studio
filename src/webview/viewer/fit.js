/*
 * Fit the camera so all visible cards (and folder islands) fill the viewport.
 */
import { canvas } from "./dom.js";
import { state, cam, markDirty } from "./state.js";
import { folderVisible, groupVisible } from "./visibility.js";
import { ensureFolderBoxes } from "./folders.js";

/** Fit the camera so all visible cards/folders fill the viewport. */
export function fit() {
  if (!state.groups.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of state.groups) {
    if (!groupVisible(g)) continue;
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w);
    maxY = Math.max(maxY, g.y + g.h);
  }
  if (state.layoutMode === "folder") {
    ensureFolderBoxes();
    for (const f of state.folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      minX = Math.min(minX, f.x);
      minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.w);
      maxY = Math.max(maxY, f.y + f.h);
    }
  }
  const w = maxX - minX, h = maxY - minY;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) {
    cam.scale = 1;
    cam.x = cw / 2 - (Number.isFinite(minX) ? minX : 0);
    cam.y = ch / 2 - (Number.isFinite(minY) ? minY : 0);
    markDirty();
    return;
  }
  const scale = Math.min(cw / w, ch / h) * 0.9;
  cam.scale = Math.max(0.02, Math.min(scale, 1.5));
  cam.x = cw / 2 - (minX + w / 2) * cam.scale;
  cam.y = ch / 2 - (minY + h / 2) * cam.scale;
  markDirty();
}
