/**
 * Webview UI strings — the single source of truth for text rendered in the
 * canvas (toolbar, panels, tooltips, card/folder controls, editor overlay).
 *
 * English is the base locale. To add a language, add another entry to LOCALES
 * with the same keys. Placeholders use `{name}` and are filled by the browser's
 * `t()` helper (see viewer.js / editor-overlay.js), which reads the resolved
 * dictionary from the `#cg-i18n` JSON island injected by the Pug template.
 *
 * This module is imported by the renderers (the VS Code host and the standalone
 * esbuild build) — never by the browser directly, because viewer.js ships as a
 * plain (unbundled) script and cannot use ES imports.
 */

/** @typedef {Record<string, string>} Messages */

/** @type {Record<string, Messages>} */
export const LOCALES = {
  en: {
    app_title: "codegraph-studio — call tree",

    // control menus (corner icon-buttons opening a dropdown of controls)
    menu_project_title: "Project",
    menu_view_title: "View",
    menu_arrange_title: "Arrange",
    menu_search_title: "Search & filter",

    // section labels inside the dropdowns
    project_root_label: "Current project",
    project_root_none: "no project loaded",
    view_layout_label: "Layout",
    view_focus_label: "Focus",
    view_visibility_label: "Visibility",
    arrange_cards_label: "Cards",

    // project menu — reparse / folder
    root_path_title: "Absolute path to a folder: /home/… , C:\\Users\\… or ~/…",
    root_path_placeholder: "path to parse (leave empty for current)…",
    rebuild: "Reparse",
    rebuild_title: "Parse the folder above and rebuild the graph",
    reparse_project: "Reparse project",
    reparse_project_title: "Parse the workspace folder again and rebuild the graph",
    open_folder: "Open folder…",
    open_folder_title: "Pick another folder to parse",

    // view menu — layout / focus / visibility
    a11y_grouping: "Grouping",
    mode_files: "Files",
    mode_files_title: "Gravity between files",
    mode_folders: "Folders",
    mode_folders_title: "First within a folder, then between folders",
    follow: "Follow mode",
    follow_title: "Global follow: clicking a file shows only it and its direct links",
    lazy: "Lazy observation",
    lazy_title: "Lazy observation: all files visible, links hidden; click a file to show its incoming + outgoing links",
    zen: "Zen mode",
    zen_title: "Zen mode: keep color only on edited files; grey out the rest. Combines with Follow/Lazy.",
    show_hidden: "Show hidden",
    show_hidden_title: "Show hidden files and restore incoming links",
    hide_isolated: "Hide isolated",
    hide_isolated_title: "Hide files with no cross-file links",

    // arrange menu — fit / reset / cards
    relayout: "Reset layout",
    relayout_title: "Discard saved positions and re-run the layout (does not re-parse)",
    fit: "Fit to screen",
    fit_title: "Fit the graph to the screen",
    expand_all: "Expand all",
    expand_all_title: "Expand all cards",
    collapse_all: "Collapse all",
    collapse_all_title: "Collapse all cards",

    // search / filter panel
    search_title: "Search functions by name",
    search_placeholder: "search function…",
    filter_title: "Glob over the relative path: server/**/*.ts, !*.test.ts",
    filter_placeholder: "glob: **/*.service.ts, !*.test.ts",

    // info bar
    stats_loading: "loading…",
    stats_summary: "{files} files · {nodes} functions · {edges} links",

    // legend (key = bold term, val = trailing description, keep leading space)
    legend_wheel_k: "wheel",
    legend_wheel_v: " — zoom",
    legend_bg_k: "background",
    legend_bg_v: " — pan",
    legend_node_k: "node/header",
    legend_node_v: " — move",
    legend_folder_k: "folder header",
    legend_folder_v: " — move/collapse/hide",
    legend_shift_k: "Shift",
    legend_shift_v: " +marquee/click — select a group",
    legend_follow_k: "follow",
    legend_follow_v: " — click a file / the background",
    legend_lazy_k: "lazy observation",
    legend_lazy_v: " — click a file to show its links",
    legend_edit_k: "✎",
    legend_edit_v: " — edit on the canvas",
    legend_toggle_title: "Controls & shortcuts",

    // start screen (extension only — shown until the user picks a root)
    start_title: "Call Graph",
    start_analyze: "Analyze current project",
    start_pick: "Choose folder",

    // processing toasts for CPU-heavy in-canvas actions (heavy.js)
    busy_reset_layout: "Resetting layout…",
    busy_mode_files: "Switching to files layout…",
    busy_mode_folders: "Switching to folders layout…",
    busy_isolated: "Recomputing layout…",
    busy_expand_all: "Expanding all cards…",
    busy_collapse_all: "Collapsing all cards…",
    busy_show_hidden: "Restoring hidden files…",
    busy_links: "Rebuilding links…",

    // viewer status / errors
    waiting_graph: "waiting for the graph…",
    loading: "Loading…",
    analyzing: "analyzing project…",
    load_failed: "could not load graph.json — run it via serve.ts",
    rebuilding: "rebuilding…",
    rebuild_net_error: "network error during rebuild",
    edit_only_vscode: "editing is available in the VS Code extension",
    error_prefix: "error: ",

    // folder card body
    folder_files_count: "{n} files",

    // tooltips
    tt_folder: "folder",
    tt_folder_collapsed: " · collapsed",
    tt_file: "file",
    tt_folder_meta: "{files} files · {links} links with folders",
    tt_file_meta: "{fns} functions · {links} links with files",
    tt_node_links: "links: {n}",

    // card controls (CTRL_LABEL)
    ctrl_edit_collapse: "Collapse editor",
    ctrl_edit_open: "Edit file on the canvas",
    ctrl_unpin: "Unpin (allow dragging)",
    ctrl_pin: "Pin position",
    ctrl_hide_file: "Hide file and all its links",
    ctrl_show_incoming: "Show incoming links",
    ctrl_hide_incoming: "Hide incoming links",
    ctrl_show_outgoing: "Show outgoing links",
    ctrl_hide_outgoing: "Hide outgoing links",
    ctrl_collapse: "Collapse",
    ctrl_expand: "Expand",

    // folder controls (FOLDER_CTRL_LABEL)
    fctrl_hide_folder: "Hide folder and all its links",
    fctrl_show_incoming: "Show folder incoming links",
    fctrl_hide_incoming: "Hide folder incoming links",
    fctrl_show_outgoing: "Show folder outgoing links",
    fctrl_hide_outgoing: "Hide folder outgoing links",
    fctrl_expand: "Expand folder",
    fctrl_collapse: "Collapse folder",

    // editor overlay
    ed_save: "save",
    ed_save_title: "Save (⌘/Ctrl+S)",
    ed_close_title: "Collapse editor",
    ed_resize_title: "Drag to resize the editor",
    ed_loading: "loading…",
    ed_changed: "• changed",
    ed_saving: "saving…",
    ed_saved: "saved",
    ed_external: "file changed externally",
    ed_updated: "updated",
  },
};

/**
 * Resolves a language preference (e.g. "en-US", "ru") to an available locale.
 * Why: VS Code and browsers report region-tagged languages; we match the exact
 * tag, then the base language, and fall back to English.
 */
export function resolveLocale(pref) {
  const want = String(pref || "").toLowerCase();
  if (want && LOCALES[want]) return want;
  const short = want.split(/[-_]/)[0];
  if (short && LOCALES[short]) return short;
  return "en";
}

/**
 * Returns the resolved message dictionary for a language preference.
 * Why: renderers pass the result to the Pug template (static text) and serialize
 * it into the `#cg-i18n` island for the browser scripts.
 */
export function getMessages(pref) {
  return LOCALES[resolveLocale(pref)];
}
