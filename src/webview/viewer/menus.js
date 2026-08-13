/*
 * Corner control menus. Each menu is an icon-button that opens a vertical
 * dropdown popup listing its controls. Only one menu is open at a time; a click
 * outside any menu or the Escape key closes it. Registers listeners on import.
 */

const MENU_IDS = ["menuProject", "menuView", "menuArrange", "menuSearch"];

/** Open/close a single menu and mirror the state on its trigger. */
function setOpen(menu, open) {
  menu.classList.toggle("open", open);
  const btn = menu.querySelector(".menu-btn");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  // only the Search menu grabs focus on open (so it's ready to type into);
  // other menus must not steal focus / pop the keyboard caret unexpectedly
  if (open && menu.id === "menuSearch") {
    const input = menu.querySelector(".menu-pop input");
    if (input) input.focus();
  }
}
/** Close every menu except `keep` (pass null to close all). */
function closeAll(keep) {
  for (const id of MENU_IDS) {
    const m = document.getElementById(id);
    if (m && m !== keep) setOpen(m, false);
  }
}

for (const id of MENU_IDS) {
  const menu = document.getElementById(id);
  const btn = menu && menu.querySelector(".menu-btn");
  if (!btn) continue;
  // toggle on mousedown so it interplays cleanly with the outside-close below
  btn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const willOpen = !menu.classList.contains("open");
    closeAll(menu);
    setOpen(menu, willOpen);
  });
  // interactions inside the popup (typing, toggling controls) must not close it
  const pop = menu.querySelector(".menu-pop");
  if (pop) pop.addEventListener("mousedown", (e) => e.stopPropagation());
}

// any click on the canvas / elsewhere dismisses the open menu
document.addEventListener("mousedown", () => closeAll(null));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAll(null);
});
