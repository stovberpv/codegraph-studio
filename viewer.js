/* codegraph viewer — canvas-рендер дерева вызовов.
 * Без зависимостей. Быстрый: перерисовка только при изменениях (dirty-флаг),
 * куллинг вне вьюпорта, батч-отрисовка рёбер одним path.
 *
 * Карточки-файлы по умолчанию свёрнуты (одинаковые карточки с именем файла).
 * По кнопке [+]/[−] раскрываются в длинный список функций. Связи агрегируются
 * на свёрнутую карточку. Состояние (позиции + свёрнутость) сохраняется.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const tooltip = document.getElementById("tooltip");
  const statsEl = document.getElementById("stats");
  const searchEl = document.getElementById("search");
  const filterEl = document.getElementById("filter");
  const hideIsolatedEl = document.getElementById("hideIsolated");
  const modeFilesEl = document.getElementById("modeFiles");
  const modeFoldersEl = document.getElementById("modeFolders");
  const followModeEl = document.getElementById("followMode");
  const lazyModeEl = document.getElementById("lazyMode");

  // ---- состояние сцены ----------------------------------------------------
  const cam = { x: 0, y: 0, scale: 1 };
  let dpr = window.devicePixelRatio || 1;
  let dirty = true;

  const nodes = new Map(); // id -> node
  let edges = []; // {from,to} на уровне функций
  let renderEdges = []; // агрегированные для отрисовки {a,b} (a/b — узел или группа)
  let groups = []; // карточки-файлы
  let unitAdj = new Map(); // unit -> Set<unit> (соседи вход+выход; unit = файл или карточка папки)
  let folders = []; // сущности папок (только режим folder)
  let folderByKey = new Map(); // key -> folder

  let hoverEntity = null; // узел или группа под курсором
  let hoverNeighbors = new Set(); // соседние сущности для подсветки
  let highlight = new Set(); // id узлов из поиска
  let highlightGroups = new Set(); // группы из поиска
  let storeKey = "codegraph:positions";
  let filterKey = "codegraph:filter";
  let graphRoot = "";

  let layoutMode = "files"; // 'files' | 'folder'
  let followMode = false;
  let followFocus = null; // group | null
  let followSet = new Set(); // видимые группы в режиме следования с фокусом
  let lazyMode = false; // «ленивое наблюдение»: все файлы видны, связи скрыты
  let lazyFocus = null; // group | null — файл, чьи связи показаны по клику

  const NODE_H = 24;
  const GAP = 8;
  const PAD = 12;
  const HEADER_H = 24; // шапка: расширение слева + иконки-контролы справа
  const TITLE_H = 22; // строка с именем файла (тело)
  const COLLAPSED_W = 252;
  const COLLAPSED_H = 66;
  const EDIT_W = 520; // размер карточки в режиме редактирования
  const EDIT_H = 380;
  const BTN = 16; // кликабельная ячейка контрола
  const ICON_PX = 12; // видимый размер иконки (≈ размер шрифта), центрируется в ячейке
  const ICON_ZOOM = 0.3; // ниже этого зума иконки не рисуем (мелкие → «грязь»)
  const CTRL_GAP = 4; // отступ между контролами
  const COLLIDE_GAP = 42; // «воздух» между карточками
  // слева направо в шапке
  const ACTIONS = ["edit", "pin", "hideFile", "hideIncoming", "hideOutgoing", "toggle"];
  // контролы папки (без «закрепить» — папка тянется за шапку/карточку)
  const FOLDER_ACTIONS = ["hideFolder", "hideIncoming", "hideOutgoing", "toggle"];
  const FOLDER_PAD = 28; // «воздух» вокруг файлов внутри острова
  const FOLDER_HEAD = 24; // высота шапки папки (как HEADER_H)
  const FOLDER_CARD_W = 260; // свёрнутая карточка папки
  const FOLDER_CARD_H = 60;

  // VS Code webview API (в standalone — null)
  const vscodeApi =
    typeof acquireVsCodeApi === "function"
      ? (() => {
          try {
            return acquireVsCodeApi();
          } catch {
            return null;
          }
        })()
      : null;
  if (vscodeApi) window.__cgHost = vscodeApi;

  let hoverButton = null; // {g, action} — контрол под курсором
  let selection = new Set(); // выделенные карточки (для группового перетаскивания)

  // ---- утилиты ------------------------------------------------------------
  function hashHue(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((h % 360) + 360) % 360;
  }

  const measureCache = new Map();
  function textWidth(t) {
    let w = measureCache.get(t);
    if (w === undefined) {
      w = ctx.measureText(t).width;
      measureCache.set(t, w);
    }
    return w;
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale };
  }

  function markDirty() {
    dirty = true;
  }

  function basename(f) {
    const p = f.split("/");
    return p[p.length - 1];
  }
  function dirname(f) {
    const i = f.lastIndexOf("/");
    return i <= 0 ? "." : f.slice(0, i);
  }
  // делит basename на имя и расширение по последней точке
  function splitName(f) {
    const b = basename(f);
    const i = b.lastIndexOf(".");
    if (i <= 0) return { name: b, ext: "" };
    return { name: b.slice(0, i), ext: b.slice(i) };
  }

  // ---- видимость (фильтр / следование / ручное скрытие) ------------------
  // «Единица» карты для следования/ленивого: файл, если его папка развёрнута;
  // карточка папки, если папка свёрнута; null — если папка скрыта.
  function unitOf(g) {
    if (!g || layoutMode !== "folder") return g;
    const f = folderByKey.get(g.folder);
    if (!f) return g;
    if (f.hidden) return null;
    if (f.collapsed) return f;
    return g;
  }
  function unitVisible(u) {
    if (!u) return false;
    return isFolder(u) ? folderVisible(u) : groupVisible(u);
  }
  // Валиден ли текущий фокус (единица ещё существует и может быть в фокусе).
  function focusValid(u) {
    if (!u) return false;
    if (isFolder(u)) return layoutMode === "folder" && !u.hidden && u.collapsed;
    return !u.filteredOut && unitOf(u) === u;
  }

  function groupVisible(g) {
    if (!g || g.filteredOut) return false;
    // файл виден, только если он сам является единицей (папка не скрыта и не свёрнута)
    if (unitOf(g) !== g) return false;
    if (lazyMode) return true; // все файлы видны, даже вручную скрытые
    if (followMode) return !followFocus || followSet.has(g);
    return !g.hidden;
  }
  // Видима ли сущность папки (как остров/карточка) на карте.
  function folderVisible(f) {
    if (!f || layoutMode !== "folder" || f.hidden) return false;
    if (!f.collapsed) return true; // остров-контейнер; наличие видимых файлов решает bbox
    // свёрнутая папка — самостоятельная единица, подчиняется режимам
    if (lazyMode) return true;
    if (followMode) return !followFocus || followSet.has(f);
    return true;
  }
  function nodeVisible(n) {
    return n && !n.hidden && n.group && groupVisible(n.group);
  }
  function setFollowFocus(u) {
    followFocus = u || null; // followSet соберётся в rebuildRenderEdges по unitAdj
    rebuildRenderEdges();
    markDirty();
  }
  function setLazyFocus(u) {
    lazyFocus = u || null;
    rebuildRenderEdges();
    markDirty();
  }
  // Приводит сущность под курсором к фокус-единице (файл/свёрнутая папка).
  function focusUnitFromEntity(ent) {
    if (!ent) return null;
    if (isFolder(ent)) return ent.collapsed ? ent : null;
    if (isGroup(ent)) return ent;
    if (ent.group) return ent.group;
    return null;
  }

  // ---- glob-фильтр --------------------------------------------------------
  function globToRegExp(glob) {
    let out = "^";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === "*") {
        if (glob[i + 1] === "*") {
          // ** — любой путь, включая /
          if (glob[i + 2] === "/") {
            out += "(?:.*/)?";
            i += 2;
          } else {
            out += ".*";
            i += 1;
          }
        } else {
          out += "[^/]*";
        }
      } else if (c === "?") {
        out += "[^/]";
      } else if ("+.^$()[]{}|\\".includes(c)) {
        out += "\\" + c;
      } else {
        out += c;
      }
    }
    out += "$";
    return new RegExp(out);
  }
  function parseFilter(str) {
    const include = [];
    const exclude = [];
    const parts = (str || "").split(",").map((s) => s.trim()).filter(Boolean);
    for (let p of parts) {
      // допускаем префикс "glob:" в UI-плейсхолдере
      if (p.toLowerCase().startsWith("glob:")) p = p.slice(5).trim();
      if (!p) continue;
      if (p.startsWith("!")) exclude.push(globToRegExp(p.slice(1)));
      else include.push(globToRegExp(p));
    }
    return { include, exclude };
  }
  function pathMatchesFilter(path, flt) {
    if (flt.exclude.some((re) => re.test(path))) return false;
    if (!flt.include.length) return true;
    return flt.include.some((re) => re.test(path));
  }
  function applyFilter() {
    const raw = filterEl ? filterEl.value.trim() : "";
    const flt = parseFilter(raw);
    for (const g of groups) {
      g.filteredOut = !pathMatchesFilter(g.path, flt);
    }
    if (followFocus && !isFolder(followFocus) && followFocus.filteredOut) setFollowFocus(null);
    else if (lazyFocus && !isFolder(lazyFocus) && lazyFocus.filteredOut) setLazyFocus(null);
    else {
      rebuildRenderEdges();
      markDirty();
    }
    try {
      if (filterKey) localStorage.setItem(filterKey, raw);
    } catch {
      /* nop */
    }
  }

  // ---- иконки Lucide (24×24, обводка) ------------------------------------
  const ICON_D = {
    squarePen: [
      "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
      "M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",
    ],
    pin: [
      "M12 17v5",
      "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
    ],
    eyeOff: [
      "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      "M14.084 14.158a3 3 0 0 1-4.242-4.242",
      "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      "m2 2 20 20",
    ],
    arrowRightToLine: ["M17 12H3", "m11 18 6-6-6-6", "M21 5v14"], // →| входящие
    arrowRightFromLine: ["M3 5v14", "M21 12H7", "m15 18 6-6-6-6"], // |→ исходящие
    chevronDown: ["m6 9 6 6 6-6"],
    chevronUp: ["m18 15-6-6-6 6"],
  };
  const iconCache = new Map();
  function iconPaths(name) {
    let ps = iconCache.get(name);
    if (!ps) {
      ps = ICON_D[name].map((d) => new Path2D(d));
      iconCache.set(name, ps);
    }
    return ps;
  }
  function drawIcon(name, cellX, cellY, color, active) {
    const s = ICON_PX / 24;
    ctx.save();
    ctx.translate(cellX + (BTN - ICON_PX) / 2, cellY + (BTN - ICON_PX) / 2);
    ctx.scale(s, s);
    ctx.strokeStyle = color;
    // толщина в единицах иконки (viewBox 24) → масштабируется вместе с миром,
    // при отдалении штрих тоньше пропорционально, а не сливается в ком
    ctx.lineWidth = active ? 2.4 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const p of iconPaths(name)) ctx.stroke(p);
    ctx.restore();
  }

  // прямоугольники контролов в шапке карточки (право-выровнены)
  function controlRects(g) {
    const groupW = ACTIONS.length * BTN + (ACTIONS.length - 1) * CTRL_GAP;
    const startX = g.x + g.w - 6 - groupW;
    const by = g.y + (HEADER_H - BTN) / 2;
    return ACTIONS.map((a, i) => ({ action: a, x: startX + i * (BTN + CTRL_GAP), y: by }));
  }
  function iconFor(g, action) {
    if (action === "edit") return "squarePen";
    if (action === "pin") return "pin";
    if (action === "hideFile") return "eyeOff";
    if (action === "hideIncoming") return "arrowRightToLine";
    if (action === "hideOutgoing") return "arrowRightFromLine";
    return g.expanded ? "chevronUp" : "chevronDown";
  }
  const CTRL_LABEL = {
    edit: (g) => (g.editing ? "Свернуть редактор" : "Редактировать файл на холсте"),
    pin: (g) => (g.pinned ? "Открепить (разрешить перетаскивание)" : "Зафиксировать позицию"),
    hideFile: () => "Скрыть файл и все его связи",
    hideIncoming: (g) => (g.hideIncoming ? "Показать входящие связи" : "Скрыть входящие связи"),
    hideOutgoing: (g) => (g.hideOutgoing ? "Показать исходящие связи" : "Скрыть исходящие связи"),
    toggle: (g) => (g.expanded ? "Свернуть" : "Развернуть"),
  };

  const isGroup = (x) => x && x.ids !== undefined;
  const isFolder = (x) => x && x.files !== undefined;
  const entKey = (x) => (isFolder(x) ? "f:" + x.key : isGroup(x) ? "g:" + x.path : "n:" + x.id);

  // Собирает сущности папок из текущих групп (сохраняя состояние по ключу).
  function buildFolders() {
    const prev = folderByKey;
    folders = [];
    folderByKey = new Map();
    const byKey = new Map();
    for (const g of groups) {
      if (!byKey.has(g.folder)) byKey.set(g.folder, []);
      byKey.get(g.folder).push(g);
    }
    for (const [key, files] of byKey) {
      const old = prev.get(key);
      const f = {
        key,
        files,
        hue: hashHue(key),
        name: key === "." ? "/" : basename(key),
        collapsed: old ? old.collapsed : false,
        hidden: old ? old.hidden : false,
        hideIncoming: old ? old.hideIncoming : false,
        hideOutgoing: old ? old.hideOutgoing : false,
        cardX: old ? old.cardX : 0,
        cardY: old ? old.cardY : 0,
        cardPlaced: old ? old.cardPlaced : false,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      };
      folders.push(f);
      folderByKey.set(key, f);
    }
  }
  const folderOf = (g) => (layoutMode === "folder" ? folderByKey.get(g.folder) : null);

  // Геометрический bbox файлов папки (для центрирования карточки при сворачивании);
  // visibleOnly=true — только фактически отрисовываемые файлы (для острова-подложки,
  // чтобы в режиме следования не рисовать пустые острова вокруг скрытых файлов).
  function filesBBox(f, visibleOnly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
    for (const g of f.files) {
      if (visibleOnly ? !groupVisible(g) : g.filteredOut || g.hidden) continue;
      any = true;
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w);
      maxY = Math.max(maxY, g.y + g.h);
    }
    return any ? { minX, minY, maxX, maxY } : null;
  }

  // Пересчитывает геометрию папок: остров с шапкой (развёрнута) либо
  // компактная карточка (свёрнута). Дёшево — вызываем перед отрисовкой/хит-тестом.
  function ensureFolderBoxes() {
    if (layoutMode !== "folder") return;
    for (const f of folders) {
      if (f.hidden) {
        f.w = f.h = 0;
        continue;
      }
      if (f.collapsed) {
        if (!f.cardPlaced) {
          const b = filesBBox(f);
          f.cardX = (b ? (b.minX + b.maxX) / 2 : 0) - FOLDER_CARD_W / 2;
          f.cardY = (b ? (b.minY + b.maxY) / 2 : 0) - FOLDER_CARD_H / 2;
          f.cardPlaced = true;
        }
        f.x = f.cardX;
        f.y = f.cardY;
        f.w = FOLDER_CARD_W;
        f.h = FOLDER_CARD_H;
      } else {
        const b = filesBBox(f, true); // остров — только по видимым файлам
        if (!b) {
          f.w = f.h = 0;
          continue;
        }
        f.x = b.minX - FOLDER_PAD;
        f.y = b.minY - FOLDER_PAD - FOLDER_HEAD;
        f.w = b.maxX - b.minX + FOLDER_PAD * 2;
        f.h = b.maxY - b.minY + FOLDER_PAD * 2 + FOLDER_HEAD;
      }
    }
  }

  function folderControlRects(f) {
    const groupW = FOLDER_ACTIONS.length * BTN + (FOLDER_ACTIONS.length - 1) * CTRL_GAP;
    const startX = f.x + f.w - 6 - groupW;
    const by = f.y + (FOLDER_HEAD - BTN) / 2;
    return FOLDER_ACTIONS.map((a, i) => ({ action: a, x: startX + i * (BTN + CTRL_GAP), y: by }));
  }
  function folderIconFor(f, action) {
    if (action === "hideFolder") return "eyeOff";
    if (action === "hideIncoming") return "arrowRightToLine";
    if (action === "hideOutgoing") return "arrowRightFromLine";
    return f.collapsed ? "chevronDown" : "chevronUp";
  }
  const FOLDER_CTRL_LABEL = {
    hideFolder: () => "Скрыть папку и все её связи",
    hideIncoming: (f) => (f.hideIncoming ? "Показать входящие связи папки" : "Скрыть входящие связи папки"),
    hideOutgoing: (f) => (f.hideOutgoing ? "Показать исходящие связи папки" : "Скрыть исходящие связи папки"),
    toggle: (f) => (f.collapsed ? "Развернуть папку" : "Свернуть папку"),
  };

  // ---- загрузка -----------------------------------------------------------
  async function load() {
    if (vscodeApi) {
      window.addEventListener("message", onHostMessage);
      statsEl.textContent = "ожидание графа…";
      vscodeApi.postMessage({ type: "ready" });
      return;
    }
    let data;
    try {
      const res = await fetch("graph.json", { cache: "no-store" });
      data = await res.json();
    } catch (e) {
      statsEl.textContent = "не удалось загрузить graph.json — запусти через serve.ts";
      return;
    }
    build(data);
  }

  function onHostMessage(ev) {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "graph") {
      if (window.__cgEditor && typeof window.__cgEditor.closeAll === "function") {
        window.__cgEditor.closeAll();
      }
      build(msg.graph);
      return;
    }
    if (msg.type === "fileContent") {
      window.__cgEditor?.onFileContent?.(msg);
      return;
    }
    if (msg.type === "saved") {
      window.__cgEditor?.onSaved?.(msg);
      return;
    }
    if (msg.type === "externalChange") {
      window.__cgEditor?.onExternalChange?.(msg);
      return;
    }
    if (msg.type === "error") {
      statsEl.textContent = "ошибка: " + (msg.message || "?");
      rebuilding = false;
    }
  }

  function build(data) {
    nodes.clear();
    for (const n of data.nodes) {
      nodes.set(n.id, { ...n, x: 0, y: 0, w: 0, h: NODE_H, deg: 0, group: null });
    }
    edges = [];
    for (const e of data.edges) {
      const from = nodes.get(e.from);
      const to = nodes.get(e.to);
      if (!from || !to) continue;
      from.deg++;
      to.deg++;
      edges.push({ from, to });
    }
    for (const n of nodes.values()) n.adj = new Set();
    for (const e of edges) {
      e.from.adj.add(e.to.id);
      e.to.adj.add(e.from.id);
    }
    statsEl.textContent = `${data.stats.files} файлов · ${data.stats.nodes} функций · ${data.stats.edges} связей`;
    graphRoot = data.root || "";
    storeKey = "codegraph:positions:" + graphRoot;
    filterKey = "codegraph:filter:" + graphRoot;
    const rp = document.getElementById("rootPath");
    if (rp && data.root) rp.value = data.root;
    // восстановить строку фильтра для этого корня
    if (filterEl) {
      try {
        filterEl.value = localStorage.getItem(filterKey) || "";
      } catch {
        filterEl.value = "";
      }
    }
    // режим группировки из сохранённой раскладки (если есть)
    const saved = loadSaved();
    if (saved && (saved.mode === "files" || saved.mode === "folder")) {
      layoutMode = saved.mode;
      syncModeButtons();
    }
    layout();
    applySaved();
    applyFilter();
    fit();
  }

  // ---- сохранение (localStorage): позиции карточек + свёрнутость ----------
  function saveLayout() {
    const data = { v: 2, mode: layoutMode, nodes: {}, groups: {} };
    for (const n of nodes.values()) {
      if (!n.group) continue;
      // смещение функции относительно карточки — при перемещении файла функции
      // едут вместе с ним и не «отрываются»
      data.nodes[n.id] = [Math.round(n.x - n.group.x), Math.round(n.y - n.group.y)];
    }
    for (const g of groups) {
      data.groups[g.path] = {
        x: Math.round(g.x),
        y: Math.round(g.y),
        exp: g.expanded ? 1 : 0,
        pin: g.pinned ? 1 : 0,
        hid: g.hidden ? 1 : 0,
        hin: g.hideIncoming ? 1 : 0,
        hout: g.hideOutgoing ? 1 : 0,
      };
    }
    data.folders = {};
    for (const f of folders) {
      data.folders[f.key] = {
        col: f.collapsed ? 1 : 0,
        hid: f.hidden ? 1 : 0,
        hin: f.hideIncoming ? 1 : 0,
        hout: f.hideOutgoing ? 1 : 0,
        cx: Math.round(f.cardX),
        cy: Math.round(f.cardY),
        cp: f.cardPlaced ? 1 : 0,
      };
    }
    try {
      localStorage.setItem(storeKey, JSON.stringify(data));
    } catch {
      /* приватный режим / переполнение */
    }
  }

  function loadSaved() {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || "null");
    } catch {
      return null;
    }
  }

  function applySaved() {
    const s = loadSaved();
    if (!s) return false;
    if (s.groups) {
      for (const g of groups) {
        const p = s.groups[g.path];
        if (!p) continue;
        if (Array.isArray(p)) {
          g.x = p[0];
          g.y = p[1];
        } else {
          g.x = p.x;
          g.y = p.y;
          g.expanded = !!p.exp;
          g.pinned = !!p.pin;
          g.hidden = !!p.hid;
          g.hideIncoming = !!p.hin;
          g.hideOutgoing = !!p.hout;
        }
        applySize(g);
      }
    }
    for (const g of groups) if (g.expanded) layoutInner(g);
    if (s.folders) {
      for (const f of folders) {
        const p = s.folders[f.key];
        if (!p) continue;
        f.collapsed = !!p.col;
        f.hidden = !!p.hid;
        f.hideIncoming = !!p.hin;
        f.hideOutgoing = !!p.hout;
        f.cardX = p.cx || 0;
        f.cardY = p.cy || 0;
        f.cardPlaced = !!p.cp;
      }
    }
    // позиции функций — только относительные (v2); старый абсолютный формат игнорируем,
    // функции просто остаются на своих местах внутри карточки
    if (s.v === 2 && s.nodes) {
      for (const n of nodes.values()) {
        if (!n.group) continue;
        const off = s.nodes[n.id];
        if (off) {
          n.x = n.group.x + off[0];
          n.y = n.group.y + off[1];
        }
      }
    }
    markDirty();
    return true;
  }

  function clearSaved() {
    try {
      localStorage.removeItem(storeKey);
    } catch {
      /* nop */
    }
  }

  // ---- размеры карточки ---------------------------------------------------
  function applySize(g) {
    if (g.editing) {
      g.w = g.editW || EDIT_W;
      g.h = g.editH || EDIT_H;
    } else if (g.expanded) {
      g.w = g.expandedW;
      g.h = g.expandedH;
    } else {
      g.w = COLLAPSED_W;
      g.h = COLLAPSED_H;
    }
  }

  function openEditor(g) {
    if (!g) return;
    if (window.__cgEditor && typeof window.__cgEditor.toggle === "function") {
      // редактор занимает тело карточки — список функций прячем
      if (!g.editing) g.expanded = false;
      window.__cgEditor.toggle(g);
      return;
    }
    // standalone / без editor.js
    statsEl.textContent = "редактирование доступно в расширении VS Code";
  }

  function onEditingChange(g) {
    if (!g) return;
    applySize(g);
    g.cx = g.x + g.w / 2;
    g.cy = g.y + g.h / 2;
    rebuildRenderEdges();
    saveLayout();
    markDirty();
  }

  // ---- раскладка ----------------------------------------------------------
  function layout() {
    ctx.font = "13px ui-monospace, monospace";
    selection = new Set(); // группы пересоздаются — старые ссылки невалидны
    const hideIso = hideIsolatedEl.checked;

    const byFile = new Map();
    for (const n of nodes.values()) {
      n.hidden = hideIso && n.deg === 0;
      n.group = null;
      if (n.hidden) continue;
      if (!byFile.has(n.file)) byFile.set(n.file, []);
      byFile.get(n.file).push(n);
    }

    groups = [];
    const groupByPath = new Map();
    const controlsW = ACTIONS.length * BTN + (ACTIONS.length - 1) * CTRL_GAP;
    for (const [file, list] of byFile) {
      list.sort((a, b) => a.line - b.line);
      const { name, ext } = splitName(file);
      let maxW = textWidth(name) + 20;
      for (const n of list) maxW = Math.max(maxW, textWidth(n.name) + 24);
      // шапка должна вместить расширение слева и блок контролов справа
      const headerMinW = 10 + textWidth(ext) + 14 + controlsW + 6;
      const expandedW = Math.max(Math.min(380, Math.max(180, maxW)), headerMinW - PAD * 2) + PAD * 2;
      const expandedH = HEADER_H + TITLE_H + list.length * (NODE_H + GAP) + PAD;
      const wasEditing = !!(window.__cgEditor && window.__cgEditor.isOpen && window.__cgEditor.isOpen(file));
      const g = {
        path: file,
        folder: dirname(file),
        name,
        ext,
        ids: list,
        hue: hashHue(file),
        isGroup: true,
        expanded: false,
        editing: wasEditing,
        pinned: false,
        hidden: false,
        filteredOut: false,
        hideIncoming: false,
        hideOutgoing: false,
        expandedW,
        expandedH,
        editW: EDIT_W,
        editH: EDIT_H,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
        cx: 0,
        cy: 0,
        vx: 0,
        vy: 0,
        linked: false,
      };
      applySize(g);
      for (const n of list) n.group = g;
      groups.push(g);
      groupByPath.set(file, g);
    }

    // межфайловые связи (вес = число вызовов)
    const linkMap = new Map();
    for (const e of edges) {
      if (e.from.hidden || e.to.hidden) continue;
      const a = e.from.file;
      const b = e.to.file;
      if (a === b) continue;
      const key = a < b ? a + "\u0000" + b : b + "\u0000" + a;
      linkMap.set(key, (linkMap.get(key) || 0) + 1);
    }
    const links = [];
    for (const [key, w] of linkMap) {
      const [a, b] = key.split("\u0000");
      const ga = groupByPath.get(a);
      const gb = groupByPath.get(b);
      if (ga && gb) {
        links.push({ a: ga, b: gb, w });
        ga.linked = true;
        gb.linked = true;
      }
    }

    if (layoutMode === "folder") {
      // папка — единственная единица: раскладываем ВСЕ файлы (в т.ч. одиночные)
      // по папкам-островам, отдельную сетку одиночных не используем — иначе
      // остров папки растягивался бы от ядра до далёкой сетки и наезжал.
      folderLayout(groups, links);
    } else {
      const connected = groups.filter((g) => g.linked);
      const isolated = groups.filter((g) => !g.linked);

      if (connected.length) forceLayout(connected, links);

      // bbox связанного ядра
      let minX = 0, minY = 0, maxX = 0, maxY = 0;
      if (connected.length) {
        minX = minY = Infinity;
        maxX = maxY = -Infinity;
        for (const g of connected) {
          minX = Math.min(minX, g.cx - g.w / 2);
          minY = Math.min(minY, g.cy - g.h / 2);
          maxX = Math.max(maxX, g.cx + g.w / 2);
          maxY = Math.max(maxY, g.cy + g.h / 2);
        }
      }

      // одиночные — аккуратная сетка под ядром
      if (isolated.length) {
        isolated.sort((a, b) => b.h - a.h);
        const area = isolated.reduce((s, g) => s + g.w * g.h, 0);
        const coreW = maxX - minX;
        const targetW = Math.max(coreW, Math.sqrt(area) * 1.6, 1200);
        const gap = COLLIDE_GAP;
        const ox = connected.length ? minX : 0;
        const oy = connected.length ? maxY + 140 : 0;
        let x = ox, y = oy, rowH = 0;
        for (const g of isolated) {
          if (x > ox && x + g.w > ox + targetW) {
            x = ox;
            y += rowH + gap;
            rowH = 0;
          }
          g.cx = x + g.w / 2;
          g.cy = y + g.h / 2;
          x += g.w + gap;
          rowH = Math.max(rowH, g.h);
        }
      }
    }

    for (const g of groups) {
      g.x = g.cx - g.w / 2;
      g.y = g.cy - g.h / 2;
      if (g.expanded) layoutInner(g);
    }
    buildFolders();
    markDirty();
  }

  // Двухуровневая раскладка: гравитация внутри папки → гравитация между папками.
  function folderLayout(gs, links) {
    const byFolder = new Map();
    for (const g of gs) {
      if (!byFolder.has(g.folder)) byFolder.set(g.folder, []);
      byFolder.get(g.folder).push(g);
    }

    // 1) внутри каждой папки — компактный локальный forceLayout
    // (тесные параметры: слабое отталкивание, короткие пружины, сильное центрирование)
    const INNER = { chargeScale: 20, springRestExtra: 16, centerK: 0.09, springK: 0.16, iterations: 320, spreadK: 0.7 };
    for (const [, list] of byFolder) {
      if (list.length === 1) {
        list[0].cx = 0;
        list[0].cy = 0;
        list[0].vx = 0;
        list[0].vy = 0;
        continue;
      }
      const localLinks = links.filter((l) => l.a.folder === list[0].folder && l.b.folder === list[0].folder);
      forceLayout(list, localLinks, INNER);
    }

    // 2) bbox каждой папки (локальные координаты) → жёсткий бокс-остров.
    // Запас FOLDER_MARGIN даёт «воздух» между папками, чтобы они не сливались.
    const FOLDER_MARGIN = 64;
    const LABEL_H = 22;
    const folders = [];
    const folderByKey = new Map();
    for (const [key, list] of byFolder) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const g of list) {
        minX = Math.min(minX, g.cx - g.w / 2);
        minY = Math.min(minY, g.cy - g.h / 2);
        maxX = Math.max(maxX, g.cx + g.w / 2);
        maxY = Math.max(maxY, g.cy + g.h / 2);
      }
      if (!Number.isFinite(minX)) {
        minX = minY = 0;
        maxX = maxY = 1;
      }
      const f = {
        key,
        list,
        hue: hashHue(key),
        // размер бокса = габариты кластера + поля со всех сторон (+ место под подпись)
        w: maxX - minX + FOLDER_MARGIN * 2,
        h: maxY - minY + FOLDER_MARGIN * 2 + LABEL_H,
        localMidX: (minX + maxX) / 2,
        localMidY: (minY + maxY) / 2,
        cx: 0,
        cy: 0,
        vx: 0,
        vy: 0,
        linked: false,
      };
      folders.push(f);
      folderByKey.set(key, f);
    }

    // 3) межпапочные связи (вес = сумма межфайловых связей между папками)
    const folderLinks = [];
    const flMap = new Map();
    for (const l of links) {
      if (l.a.folder === l.b.folder) continue;
      const ka = l.a.folder;
      const kb = l.b.folder;
      const key = ka < kb ? ka + "\u0000" + kb : kb + "\u0000" + ka;
      flMap.set(key, (flMap.get(key) || 0) + l.w);
    }
    for (const [key, w] of flMap) {
      const [a, b] = key.split("\u0000");
      const fa = folderByKey.get(a);
      const fb = folderByKey.get(b);
      if (fa && fb) {
        folderLinks.push({ a: fa, b: fb, w });
        fa.linked = true;
        fb.linked = true;
      }
    }

    // 4) раскладка боксов-папок: притяжение между связанными + жёсткое
    //    разведение (боксы не пересекаются, между ними зазор COLLIDE_GAP)
    if (folders.length === 1) {
      folders[0].cx = 0;
      folders[0].cy = 0;
    } else {
      forceLayout(folders, folderLinks, { chargeScale: 42, springRestExtra: 60, centerK: 0.01, springK: 0.06 });
      resolveCollisions(folders, 300); // гарантированно развести острова
    }

    // 5) перенести карточки каждой папки как жёсткое целое к центру её бокса
    for (const f of folders) {
      const dx = f.cx - f.localMidX;
      const dy = f.cy - f.localMidY;
      for (const g of f.list) {
        g.cx += dx;
        g.cy += dy;
        g.vx = 0;
        g.vy = 0;
      }
    }
    // намеренно НЕ вызываем глобальный resolveCollisions по карточкам —
    // он перемешал бы папки; внутри папки пересечений уже нет (шаг 1),
    // между папками — тоже (шаг 4).
  }

  // Раскладка функций внутри раскрытой карточки (вертикальный список).
  function layoutInner(g) {
    const nodeW = g.w - PAD * 2;
    let ny = g.y + HEADER_H + TITLE_H + PAD / 2;
    for (const n of g.ids) {
      n.x = g.x + PAD;
      n.y = ny;
      n.w = nodeW;
      n.h = NODE_H;
      ny += NODE_H + GAP;
    }
  }

  // Force-directed на карточках: отталкивание + пружины + слабое центрирование,
  // плюс жёсткое разведение пересечений (AABB). Подобрано под «острова»: сильное
  // отталкивание и длинные пружины дают воздух, слабая гравитация не стягивает в ком.
  function forceLayout(gs, links, opts) {
    const n = gs.length;
    if (!n) return;
    opts = opts || {};

    // степень связности каждой карточки (число межфайловых связей) —
    // нужна, чтобы ослабить притяжение к «хабам» и не схлопывать всё в ядро
    const deg = new Map();
    for (const l of links) {
      deg.set(l.a, (deg.get(l.a) || 0) + 1);
      deg.set(l.b, (deg.get(l.b) || 0) + 1);
    }

    const spreadK = opts.spreadK != null ? opts.spreadK : 1.4;
    const spread = Math.sqrt(gs.reduce((s, g) => s + g.w * g.h, 0)) * spreadK;
    for (let i = 0; i < n; i++) {
      const g = gs[i];
      const ang = i * 2.399963229728653;
      const r = Math.sqrt((i + 0.5) / n) * spread;
      g.cx = Math.cos(ang) * r;
      g.cy = Math.sin(ang) * r;
      g.vx = 0;
      g.vy = 0;
    }

    const iterations = opts.iterations != null ? opts.iterations : 440;
    const velocityDecay = 0.62;
    const centerK = opts.centerK != null ? opts.centerK : 0.004; // гравитация к центру
    const springK = opts.springK != null ? opts.springK : 0.08;
    const springRestExtra = opts.springRestExtra != null ? opts.springRestExtra : 120; // длина пружины
    const chargeScale = opts.chargeScale != null ? opts.chargeScale : 170; // сила отталкивания
    const maxStep = Math.max(80, spread * 0.035);

    let alpha = 1;
    const alphaDecay = 1 - Math.pow(0.001, 1 / iterations);

    for (let it = 0; it < iterations; it++) {
      alpha *= 1 - alphaDecay;

      for (let i = 0; i < n; i++) {
        const gi = gs[i];
        for (let j = i + 1; j < n; j++) {
          const gj = gs[j];
          let dx = gj.cx - gi.cx;
          let dy = gj.cy - gi.cy;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (i - j) || 1;
            dy = (j - i) || 1;
            d2 = dx * dx + dy * dy;
          }
          const strength = ((gi.w + gi.h) * (gj.w + gj.h) * chargeScale) / d2;
          const dist = Math.sqrt(d2);
          const fx = (dx / dist) * strength * alpha;
          const fy = (dy / dist) * strength * alpha;
          gi.vx -= fx;
          gi.vy -= fy;
          gj.vx += fx;
          gj.vy += fy;
        }
      }

      for (const l of links) {
        const a = l.a;
        const b = l.b;
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const rest = (a.w + a.h) / 2 + (b.w + b.h) / 2 + springRestExtra;
        // делим притяжение на корень из min-степени: связь с хабом тянет слабо,
        // связи внутри маленькой группы — сильно → формируются острова
        const hub = Math.sqrt(Math.min(deg.get(a) || 1, deg.get(b) || 1));
        const k = (springK * Math.min(l.w, 24) * alpha) / hub;
        const disp = (dist - rest) * k;
        const fx = (dx / dist) * disp;
        const fy = (dy / dist) * disp;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (let i = 0; i < n; i++) {
        const g = gs[i];
        g.vx -= g.cx * centerK * alpha;
        g.vy -= g.cy * centerK * alpha;
      }

      for (let i = 0; i < n; i++) {
        const g = gs[i];
        g.vx *= velocityDecay;
        g.vy *= velocityDecay;
        const sp = Math.hypot(g.vx, g.vy);
        if (sp > maxStep) {
          g.vx = (g.vx / sp) * maxStep;
          g.vy = (g.vy / sp) * maxStep;
        }
        g.cx += g.vx;
        g.cy += g.vy;
        if (!Number.isFinite(g.cx) || !Number.isFinite(g.cy)) {
          g.cx = 0;
          g.cy = 0;
          g.vx = 0;
          g.vy = 0;
        }
      }

      resolveCollisions(gs, 2);
    }

    resolveCollisions(gs, 24);
  }

  // Разводит пересекающиеся боксы (AABB) по оси наименьшего проникновения.
  // pinned (Set) — эти карточки не двигаем (двигаем только их соседей).
  function resolveCollisions(gs, passes, pinned) {
    const n = gs.length;
    const gap = COLLIDE_GAP;
    for (let p = 0; p < passes; p++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const gi = gs[i];
        for (let j = i + 1; j < n; j++) {
          const gj = gs[j];
          const dx = gj.cx - gi.cx;
          const dy = gj.cy - gi.cy;
          const ox = (gi.w + gj.w) / 2 + gap - Math.abs(dx);
          const oy = (gi.h + gj.h) / 2 + gap - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            moved = true;
            const pi = pinned && pinned.has(gi);
            const pj = pinned && pinned.has(gj);
            if (pi && pj) continue;
            if (ox < oy) {
              const s = ox * (dx < 0 ? -1 : 1);
              if (pi) gj.cx += s;
              else if (pj) gi.cx -= s;
              else {
                gi.cx -= s / 2;
                gj.cx += s / 2;
              }
            } else {
              const s = oy * (dy < 0 ? -1 : 1);
              if (pi) gj.cy += s;
              else if (pj) gi.cy -= s;
              else {
                gi.cy -= s / 2;
                gj.cy += s / 2;
              }
            }
          }
        }
      }
      if (!moved) break;
    }
  }

  // Переносит новые центры (cx/cy) в top-left (x/y) и двигает функции карточки
  // на ту же дельту — чтобы сохранить их смещения относительно файла.
  function applyCollisionShift(gs) {
    for (const g of gs) {
      const nx = g.cx - g.w / 2;
      const ny = g.cy - g.h / 2;
      const dx = nx - g.x;
      const dy = ny - g.y;
      if (dx || dy) {
        g.x = nx;
        g.y = ny;
        for (const n of g.ids) {
          n.x += dx;
          n.y += dy;
        }
      }
    }
  }

  // ---- агрегированные рёбра ----------------------------------------------
  const endpoint = (fn) => (fn.group && fn.group.expanded ? fn : fn.group);

  function rebuildRenderEdges() {
    unitAdj = new Map();
    const bumpAdj = (a, b) => {
      if (!unitAdj.has(a)) unitAdj.set(a, new Set());
      if (!unitAdj.has(b)) unitAdj.set(b, new Set());
      unitAdj.get(a).add(b);
      unitAdj.get(b).add(a);
    };
    // 1) соседство единиц (для следования) — без учёта ручных скрытий.
    //    Единица = файл (папка развёрнута) или карточка папки (папка свёрнута).
    for (const e of edges) {
      const from = e.from;
      const to = e.to;
      if (!from.group || !to.group) continue;
      if (from.hidden || to.hidden) continue;
      if (from.group.filteredOut || to.group.filteredOut) continue;
      const ua = unitOf(from.group);
      const ub = unitOf(to.group);
      if (!ua || !ub || ua === ub) continue;
      bumpAdj(ua, ub);
    }
    // 2) сбросить неактуальный фокус и пересобрать followSet по свежему соседству
    if (followFocus && !focusValid(followFocus)) followFocus = null;
    if (lazyFocus && !focusValid(lazyFocus)) lazyFocus = null;
    followSet = new Set();
    if (followFocus) {
      followSet.add(followFocus);
      const adj = unitAdj.get(followFocus);
      if (adj) for (const n of adj) followSet.add(n);
    }
    // 3) рёбра для отрисовки (агрегируются к карточке свёрнутой папки)
    renderEdges = [];
    const seen = new Set();
    const manual = !followMode && !lazyMode; // ручные тумблеры только в обычном режиме
    for (const e of edges) {
      const from = e.from;
      const to = e.to;
      if (!from.group || !to.group) continue;
      if (from.hidden || to.hidden) continue;
      const ua = unitOf(from.group);
      const ub = unitOf(to.group);
      if (!ua || !ub || ua === ub) continue;
      if (!unitVisible(ua) || !unitVisible(ub)) continue;
      if (lazyMode) {
        // связи скрыты, пока не выбрана единица; тогда — только её вход+выход
        if (!lazyFocus) continue;
        if (ua !== lazyFocus && ub !== lazyFocus) continue;
      }
      if (manual) {
        // тумблеры на границе папки (только межпапочные рёбра)
        const ff = folderByKey.get(from.group.folder);
        const tf = folderByKey.get(to.group.folder);
        if (ff !== tf) {
          if (tf && tf.hideIncoming) continue;
          if (ff && ff.hideOutgoing) continue;
        }
        // файловые тумблеры — только для «живых» концов (единица = сам файл)
        if (ub === to.group && to.group.hideIncoming) continue;
        if (ua === from.group && from.group.hideOutgoing) continue;
      }
      const a = isFolder(ua) ? ua : endpoint(from);
      const b = isFolder(ub) ? ub : endpoint(to);
      if (!a || !b || a === b) continue;
      const k = entKey(a) + ">" + entKey(b);
      if (seen.has(k)) continue;
      seen.add(k);
      renderEdges.push({ a, b });
    }
    markDirty();
  }

  // ---- вписать в экран ----------------------------------------------------
  function fit() {
    if (!groups.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const g of groups) {
      if (!groupVisible(g)) continue;
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w);
      maxY = Math.max(maxY, g.y + g.h);
    }
    if (layoutMode === "folder") {
      ensureFolderBoxes();
      for (const f of folders) {
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

  // ---- геометрия рёбер ----------------------------------------------------
  // Грань стыковки выбирается по доминирующей оси между центрами карточек:
  // по горизонтали — левый/правый торец, по вертикали — верх/низ. Контрольные
  // точки уводят кривую перпендикулярно выбранной грани, поэтому для близких
  // вертикально расположенных блоков связь не «ныряет» обратно внутрь.
  function edgeGeom(a, b) {
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const dx = bcx - acx, dy = bcy - acy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // горизонтальная стыковка (левый/правый торец)
      const sx = dx >= 0 ? a.x + a.w : a.x;
      const tx = dx >= 0 ? b.x : b.x + b.w;
      const mx = (sx + tx) / 2;
      return { sx, sy: acy, tx, ty: bcy, c1x: mx, c1y: acy, c2x: mx, c2y: bcy, ang: dx >= 0 ? 0 : Math.PI };
    }
    // вертикальная стыковка (верх/низ)
    const sy = dy >= 0 ? a.y + a.h : a.y;
    const ty = dy >= 0 ? b.y : b.y + b.h;
    const my = (sy + ty) / 2;
    return { sx: acx, sy, tx: bcx, ty, c1x: acx, c1y: my, c2x: bcx, c2y: my, ang: dy >= 0 ? Math.PI / 2 : -Math.PI / 2 };
  }

  function addCurve(path, a, b) {
    const p = edgeGeom(a, b);
    path.moveTo(p.sx, p.sy);
    path.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
  }

  function drawArrow(a, b, color) {
    const p = edgeGeom(a, b);
    // вход в грань перпендикулярный (касательная кривой в конце совпадает с ang)
    const ang = p.ang;
    const size = 8 / cam.scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.tx, p.ty);
    ctx.lineTo(p.tx - size * Math.cos(ang - 0.4), p.ty - size * Math.sin(ang - 0.4));
    ctx.lineTo(p.tx - size * Math.cos(ang + 0.4), p.ty - size * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const isHi = (ent) => (isGroup(ent) ? highlightGroups.has(ent) : highlight.has(ent.id));

  // ---- рендер -------------------------------------------------------------
  function drawFolderControls(f) {
    if (cam.scale <= ICON_ZOOM) return;
    for (const r of folderControlRects(f)) {
      const isBtnHover = hoverButton && hoverButton.g === f && hoverButton.action === r.action;
      const activeState =
        (r.action === "hideIncoming" && f.hideIncoming) || (r.action === "hideOutgoing" && f.hideOutgoing);
      if (isBtnHover) {
        roundRect(r.x - 2, r.y - 2, BTN + 4, BTN + 4, 4);
        ctx.fillStyle = "rgba(90,160,255,0.18)";
        ctx.fill();
      }
      const color = activeState ? "#5aa0ff" : isBtnHover ? "#e6edf3" : `hsl(${f.hue},40%,72%)`;
      drawIcon(folderIconFor(f, r.action), r.x, r.y, color, activeState || isBtnHover);
    }
  }

  function drawFolder(f, isHover) {
    const hue = f.hue;
    const showText = cam.scale > 0.1;
    if (f.collapsed) {
      roundRect(f.x, f.y, f.w, f.h, 10);
      ctx.fillStyle = `hsla(${hue},34%,17%,0.92)`;
      ctx.fill();
      ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
      ctx.strokeStyle = isHover ? "#5aa0ff" : `hsla(${hue},45%,45%,0.85)`;
      ctx.stroke();
      if (!showText) return;
      ctx.lineWidth = 1 / cam.scale;
      ctx.strokeStyle = `hsla(${hue},40%,40%,0.45)`;
      ctx.beginPath();
      ctx.moveTo(f.x + 8, f.y + FOLDER_HEAD);
      ctx.lineTo(f.x + f.w - 8, f.y + FOLDER_HEAD);
      ctx.stroke();
      ctx.fillStyle = "#8b97a4";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("dir", f.x + 10, f.y + FOLDER_HEAD / 2 + 4);
      drawFolderControls(f);
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x + 8, f.y + FOLDER_HEAD, f.w - 16, f.h - FOLDER_HEAD);
      ctx.clip();
      ctx.fillStyle = `hsl(${hue},52%,80%)`;
      ctx.font = "13px ui-monospace, monospace";
      ctx.fillText(f.name, f.x + 10, f.y + FOLDER_HEAD + 16);
      ctx.fillStyle = "#8b97a4";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`${f.files.length} файлов`, f.x + 10, f.y + FOLDER_HEAD + 32);
      ctx.restore();
      ctx.font = "13px ui-monospace, monospace";
      return;
    }
    // развёрнутый остров
    roundRect(f.x, f.y, f.w, f.h, 14);
    ctx.fillStyle = `hsla(${hue},28%,18%,0.22)`;
    ctx.fill();
    ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
    ctx.strokeStyle = isHover ? "#5aa0ff" : `hsla(${hue},40%,42%,0.4)`;
    ctx.stroke();
    if (!showText) return;
    ctx.lineWidth = 1 / cam.scale;
    ctx.strokeStyle = `hsla(${hue},40%,40%,0.35)`;
    ctx.beginPath();
    ctx.moveTo(f.x + 8, f.y + FOLDER_HEAD);
    ctx.lineTo(f.x + f.w - 8, f.y + FOLDER_HEAD);
    ctx.stroke();
    // подпись пути слева (обрезаем по свободному месту до контролов)
    const ctrlW = FOLDER_ACTIONS.length * (BTN + CTRL_GAP) + 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x + 8, f.y, f.w - 16 - ctrlW, FOLDER_HEAD);
    ctx.clip();
    ctx.fillStyle = `hsla(${hue},42%,72%,0.95)`;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillText(f.key === "." ? "/" : f.key, f.x + 10, f.y + FOLDER_HEAD / 2 + 4);
    ctx.restore();
    ctx.font = "13px ui-monospace, monospace";
    drawFolderControls(f);
  }

  function render() {
    dirty = false;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0e1116";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.x, dpr * cam.y);
    ctx.font = "13px ui-monospace, monospace";
    ctx.textBaseline = "alphabetic";

    const view = {
      x0: -cam.x / cam.scale,
      y0: -cam.y / cam.scale,
      x1: (cw - cam.x) / cam.scale,
      y1: (ch - cam.y) / cam.scale,
    };
    const inView = (x, y, w, h) => x + w >= view.x0 && x <= view.x1 && y + h >= view.y0 && y <= view.y1;

    const active = hoverEntity || highlight.size;
    // наведение на развёрнутую папку не затемняет файлы (у неё нет рёбер-эндпоинтов)
    const dimHover = hoverEntity && !(isFolder(hoverEntity) && !hoverEntity.collapsed);

    // папки: острова (развёрнуты) и компактные карточки (свёрнуты)
    if (layoutMode === "folder") {
      ensureFolderBoxes();
      for (const f of folders) {
        if (!folderVisible(f) || f.w <= 0) continue;
        if (!inView(f.x, f.y, f.w, f.h)) continue;
        const isHover = f === hoverEntity;
        drawFolder(f, isHover, inView);
      }
    }

    // карточки (фон)
    for (const g of groups) {
      if (!groupVisible(g)) continue;
      if (!inView(g.x, g.y, g.w, g.h)) continue;
      const isHover = g === hoverEntity;
      const isNeighbor = hoverNeighbors.has(g);
      const isMatch = highlightGroups.has(g);
      const dim = (dimHover && !isHover && !isNeighbor) || (highlight.size && !isMatch);

      roundRect(g.x, g.y, g.w, g.h, 9);
      ctx.fillStyle = dim ? `hsla(${g.hue},22%,13%,0.5)` : `hsla(${g.hue},34%,17%,0.72)`;
      ctx.fill();
      ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
      ctx.strokeStyle = isHover
        ? "#5aa0ff"
        : isMatch
          ? "#e0a83d"
          : dim
            ? "rgba(70,80,92,0.5)"
            : `hsla(${g.hue},45%,45%,0.75)`;
      ctx.stroke();

      if (selection.has(g)) {
        ctx.lineWidth = 2.5 / cam.scale;
        ctx.strokeStyle = "#7aa2ff";
        roundRect(g.x - 2.5, g.y - 2.5, g.w + 5, g.h + 5, 11);
        ctx.stroke();
      }

      if (cam.scale > 0.1) {
        // разделитель под шапкой
        ctx.lineWidth = 1 / cam.scale;
        ctx.strokeStyle = dim ? "rgba(70,80,92,0.35)" : `hsla(${g.hue},40%,40%,0.4)`;
        ctx.beginPath();
        ctx.moveTo(g.x + 8, g.y + HEADER_H);
        ctx.lineTo(g.x + g.w - 8, g.y + HEADER_H);
        ctx.stroke();

        // шапка: расширение слева
        if (g.ext) {
          ctx.fillStyle = dim ? "#454e58" : "#8b97a4";
          ctx.font = "11px ui-monospace, monospace";
          ctx.fillText(g.ext, g.x + 10, g.y + HEADER_H / 2 + 4);
        }

        // шапка: иконки-контролы справа (только при достаточном зуме)
        if (cam.scale > ICON_ZOOM) {
          for (const r of controlRects(g)) {
            const isBtnHover = hoverButton && hoverButton.g === g && hoverButton.action === r.action;
            const activeState =
              (r.action === "edit" && g.editing) ||
              (r.action === "pin" && g.pinned) ||
              (r.action === "hideIncoming" && g.hideIncoming) ||
              (r.action === "hideOutgoing" && g.hideOutgoing);
            if (isBtnHover) {
              roundRect(r.x - 2, r.y - 2, BTN + 4, BTN + 4, 4);
              ctx.fillStyle = "rgba(90,160,255,0.18)";
              ctx.fill();
            }
            const color = dim
              ? "#556070"
              : activeState
                ? "#5aa0ff"
                : isBtnHover
                  ? "#e6edf3"
                  : `hsl(${g.hue},40%,70%)`;
            drawIcon(iconFor(g, r.action), r.x, r.y, color, activeState || isBtnHover);
          }
        }

        // тело: имя файла без расширения (под редактором не рисуем)
        if (!g.editing) {
          ctx.fillStyle = dim ? "#5b6672" : `hsl(${g.hue},52%,78%)`;
          ctx.font = "13px ui-monospace, monospace";
          ctx.save();
          ctx.beginPath();
          ctx.rect(g.x + 8, g.y + HEADER_H, g.w - 16, TITLE_H);
          ctx.clip();
          ctx.fillText(g.name, g.x + 10, g.y + HEADER_H + 16);
          ctx.restore();

          if (!g.expanded) {
            ctx.fillStyle = dim ? "#454e58" : "#8b97a4";
            ctx.font = "11px ui-monospace, monospace";
            ctx.fillText(`${g.ids.length} fn`, g.x + 10, g.y + HEADER_H + TITLE_H + 12);
            ctx.font = "13px ui-monospace, monospace";
          }
        }
      }
    }

    // рёбра (агрегированные) — обычные одним path
    ctx.lineWidth = 1 / cam.scale;
    ctx.strokeStyle = active ? "rgba(120,135,150,0.10)" : "rgba(120,135,150,0.26)";
    const normal = new Path2D();
    const hot = [];
    for (const e of renderEdges) {
      const a = e.a, b = e.b;
      const isHot =
        (hoverEntity && (a === hoverEntity || b === hoverEntity)) ||
        (highlight.size && (isHi(a) || isHi(b)));
      if (
        !isHot &&
        !inView(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x) + a.w, Math.abs(a.y - b.y) + a.h)
      )
        continue;
      if (isHot) {
        hot.push(e);
        continue;
      }
      addCurve(normal, a, b);
    }
    ctx.stroke(normal);

    if (hot.length) {
      ctx.strokeStyle = "rgba(90,160,255,0.9)";
      ctx.lineWidth = 1.6 / cam.scale;
      for (const e of hot) {
        const p = new Path2D();
        addCurve(p, e.a, e.b);
        ctx.stroke(p);
        drawArrow(e.a, e.b, "rgba(90,160,255,0.95)");
      }
    }

    // функции раскрытых карточек (не рисуем под открытым редактором)
    const showText = cam.scale > 0.3;
    for (const n of nodes.values()) {
      if (!nodeVisible(n) || !n.group.expanded || n.group.editing) continue;
      if (!inView(n.x, n.y, n.w, n.h)) continue;
      const isHover = n === hoverEntity;
      const isNeighbor = hoverNeighbors.has(n);
      const isMatch = highlight.has(n.id);
      const dim = (dimHover && !isHover && !isNeighbor) || (highlight.size && !isMatch);
      roundRect(n.x, n.y, n.w, n.h, 6);
      const hue = n.group.hue;
      if (isHover) ctx.fillStyle = "#2a3546";
      else if (isMatch) ctx.fillStyle = "#3a2f12";
      else ctx.fillStyle = dim ? "#171b21" : "#1c232c";
      ctx.fill();
      ctx.lineWidth = (isHover ? 2 : 1) / cam.scale;
      ctx.strokeStyle = isHover
        ? "#5aa0ff"
        : isMatch
          ? "#e0a83d"
          : dim
            ? "rgba(70,80,92,0.5)"
            : `hsla(${hue},45%,55%,0.8)`;
      ctx.stroke();
      if (showText) {
        ctx.fillStyle = dim ? "#5b6672" : "#e6edf3";
        ctx.save();
        ctx.beginPath();
        ctx.rect(n.x + 6, n.y, n.w - 12, n.h);
        ctx.clip();
        ctx.fillText(n.name, n.x + 8, n.y + 16);
        ctx.restore();
      }
    }

    // рамка выделения
    if (drag && drag.type === "marquee") {
      const mx = Math.min(drag.x0, drag.x1), my = Math.min(drag.y0, drag.y1);
      const mw = Math.abs(drag.x1 - drag.x0), mh = Math.abs(drag.y1 - drag.y0);
      ctx.fillStyle = "rgba(90,160,255,0.10)";
      ctx.strokeStyle = "rgba(122,162,255,0.85)";
      ctx.lineWidth = 1 / cam.scale;
      ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
      roundRect(mx, my, mw, mh, 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // оверлеи CodeMirror следуют за камерой
    if (window.__cgEditor && typeof window.__cgEditor.sync === "function") {
      window.__cgEditor.sync();
    }
  }

  // ---- hit-test -----------------------------------------------------------
  function controlAt(wx, wy) {
    if (cam.scale <= ICON_ZOOM) return null; // на отдалении иконки скрыты — не кликаем
    for (const g of groups) {
      if (!groupVisible(g)) continue;
      // быстрый отсев: контролы только в правой части шапки
      if (wy < g.y || wy > g.y + HEADER_H || wx < g.x || wx > g.x + g.w) continue;
      for (const r of controlRects(g)) {
        if (wx >= r.x && wx <= r.x + BTN && wy >= r.y && wy <= r.y + BTN) return { g, action: r.action };
      }
    }
    return null;
  }
  function nodeAt(wx, wy) {
    for (const n of nodes.values()) {
      if (!nodeVisible(n) || !n.group.expanded) continue;
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) return n;
    }
    return null;
  }
  function groupDragAt(wx, wy) {
    for (const g of groups) {
      if (!groupVisible(g)) continue;
      if (wx < g.x || wx > g.x + g.w) continue;
      if (g.expanded) {
        if (wy >= g.y && wy <= g.y + HEADER_H) return g;
      } else if (wy >= g.y && wy <= g.y + g.h) return g;
    }
    return null;
  }
  function entityAt(wx, wy) {
    const n = nodeAt(wx, wy);
    if (n) return n;
    for (const g of groups) {
      if (!groupVisible(g)) continue;
      if (wx >= g.x && wx <= g.x + g.w && wy >= g.y && wy <= g.y + g.h) return g;
    }
    // папки — приоритет ниже файлов: свёрнутая карточка целиком, развёрнутая — только шапка
    if (layoutMode === "folder") {
      ensureFolderBoxes();
      for (const f of folders) {
        if (!folderVisible(f) || f.w <= 0) continue;
        if (wx < f.x || wx > f.x + f.w) continue;
        if (f.collapsed) {
          if (wy >= f.y && wy <= f.y + f.h) return f;
        } else if (wy >= f.y && wy <= f.y + FOLDER_HEAD) return f;
      }
    }
    return null;
  }
  function folderControlAt(wx, wy) {
    if (layoutMode !== "folder" || cam.scale <= ICON_ZOOM) return null;
    ensureFolderBoxes();
    for (const f of folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      if (wy < f.y || wy > f.y + FOLDER_HEAD || wx < f.x || wx > f.x + f.w) continue;
      for (const r of folderControlRects(f)) {
        if (wx >= r.x && wx <= r.x + BTN && wy >= r.y && wy <= r.y + BTN) return { g: f, action: r.action };
      }
    }
    return null;
  }
  function folderHeaderAt(wx, wy) {
    if (layoutMode !== "folder") return null;
    ensureFolderBoxes();
    for (const f of folders) {
      if (!folderVisible(f) || f.w <= 0) continue;
      if (wx < f.x || wx > f.x + f.w) continue;
      if (f.collapsed) {
        if (wy >= f.y && wy <= f.y + f.h) return f;
      } else if (wy >= f.y && wy <= f.y + FOLDER_HEAD) return f;
    }
    return null;
  }

  // ---- сворачивание / раскрытие ------------------------------------------
  function toggleExpand(g) {
    g.expanded = !g.expanded;
    const kx = g.x, ky = g.y; // верх-левый угол фиксируем
    applySize(g);
    g.x = kx;
    g.y = ky;
    if (g.expanded) layoutInner(g);

    // раздвинуть соседей (раскрытую карточку не двигаем)
    for (const gg of groups) {
      gg.cx = gg.x + gg.w / 2;
      gg.cy = gg.y + gg.h / 2;
    }
    resolveCollisions(groups, 60, new Set([g]));
    applyCollisionShift(groups);

    rebuildRenderEdges();
    saveLayout();
    markDirty();
  }

  // Выполняет действие контрола карточки.
  function runControl(g, action) {
    if (action === "toggle") {
      toggleExpand(g);
      return;
    }
    if (action === "edit") {
      openEditor(g);
      return;
    }
    if (action === "pin") {
      g.pinned = !g.pinned;
    } else if (action === "hideFile") {
      g.hidden = true;
      if (g.editing && window.__cgEditor) window.__cgEditor.close(g.path);
      if (hoverEntity === g) setHover(null);
    } else if (action === "hideIncoming") {
      g.hideIncoming = !g.hideIncoming;
    } else if (action === "hideOutgoing") {
      g.hideOutgoing = !g.hideOutgoing;
    }
    rebuildRenderEdges();
    saveLayout();
    markDirty();
  }

  // Выполняет действие контрола папки.
  function runFolderControl(f, action) {
    if (action === "toggle") {
      f.collapsed = !f.collapsed;
      if (f.collapsed) f.cardPlaced = false; // карточку центрируем по текущим файлам
    } else if (action === "hideFolder") {
      f.hidden = true;
      if (hoverEntity === f) setHover(null);
    } else if (action === "hideIncoming") {
      f.hideIncoming = !f.hideIncoming;
    } else if (action === "hideOutgoing") {
      f.hideOutgoing = !f.hideOutgoing;
    }
    rebuildRenderEdges();
    saveLayout();
    markDirty();
  }

  function showAllHidden() {
    for (const g of groups) {
      g.hidden = false;
      g.hideIncoming = false;
      g.hideOutgoing = false;
    }
    for (const f of folders) {
      f.hidden = false;
      f.hideIncoming = false;
      f.hideOutgoing = false;
    }
    rebuildRenderEdges();
    saveLayout();
    markDirty();
  }

  function setAllExpanded(v) {
    for (const g of groups) {
      const kx = g.x, ky = g.y;
      g.expanded = v;
      applySize(g);
      g.x = kx;
      g.y = ky;
      if (v) layoutInner(g);
    }
    for (const g of groups) {
      g.cx = g.x + g.w / 2;
      g.cy = g.y + g.h / 2;
    }
    resolveCollisions(groups, 220);
    applyCollisionShift(groups);
    rebuildRenderEdges();
    saveLayout();
    fit();
  }

  // ---- взаимодействие -----------------------------------------------------
  let drag = null;

  canvas.addEventListener("mousedown", (e) => {
    const local = localPos(e);
    const w = screenToWorld(local.x, local.y);
    const shift = e.shiftKey || e.metaKey;

    const ctrl = controlAt(w.x, w.y);
    if (ctrl && !shift) {
      drag = { type: "control", group: ctrl.g, action: ctrl.action, sx: e.clientX, sy: e.clientY };
      return;
    }
    const fctrl = folderControlAt(w.x, w.y);
    if (fctrl && !shift) {
      drag = { type: "folderControl", folder: fctrl.g, action: fctrl.action, sx: e.clientX, sy: e.clientY };
      return;
    }

    // Shift/Cmd: выделение (клик по карточке — тоггл, по фону — рамка)
    if (shift) {
      const ent = entityAt(w.x, w.y);
      const g = ent && (isGroup(ent) ? ent : ent.group);
      if (g) {
        drag = { type: "toggleSelect", group: g, sx: e.clientX, sy: e.clientY };
        return;
      }
      drag = { type: "marquee", x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      return;
    }

    const n = nodeAt(w.x, w.y);
    if (n) {
      drag = { type: "node", node: n, ox: w.x - n.x, oy: w.y - n.y };
      canvas.classList.add("dragging");
      return;
    }
    const g = groupDragAt(w.x, w.y);
    if (g && !g.pinned) {
      // тащим всю выделенную группу, если схватили выделенную карточку; иначе — только её
      let set;
      if (selection.has(g) && selection.size > 0) {
        set = [...selection];
      } else {
        if (selection.size) markDirty();
        selection.clear();
        set = [g];
      }
      drag = { type: "group", groups: set, lastX: w.x, lastY: w.y, startSX: e.clientX, startSY: e.clientY };
      canvas.classList.add("dragging");
      return;
    }
    const fh = folderHeaderAt(w.x, w.y);
    if (fh) {
      drag = { type: "folder", folder: fh, lastX: w.x, lastY: w.y, startSX: e.clientX, startSY: e.clientY };
      canvas.classList.add("dragging");
      return;
    }
    // пустой фон без модификатора — снять выделение и панорамировать
    if (selection.size) {
      selection.clear();
      markDirty();
    }
    drag = { type: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    canvas.classList.add("grabbing");
  });

  window.addEventListener("mousemove", (e) => {
    const local = localPos(e);
    if (drag) {
      const w = screenToWorld(local.x, local.y);
      if (drag.type === "control") {
        // сдвиг курсора превращает нажатие в перетаскивание карточки (если не закреплена)
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
          if (drag.group.pinned) {
            drag = null; // закреплённую не двигаем
          } else {
            drag = { type: "group", groups: [drag.group], lastX: w.x, lastY: w.y };
            canvas.classList.add("dragging");
          }
        }
        return;
      }
      if (drag.type === "folderControl") {
        // сдвиг курсора превращает нажатие на контрол в перетаскивание папки
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
          drag = { type: "folder", folder: drag.folder, lastX: w.x, lastY: w.y };
          canvas.classList.add("dragging");
        }
        return;
      }
      if (drag.type === "toggleSelect") {
        // сдвиг превращает shift-нажатие в перетаскивание выделения
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
          selection.add(drag.group);
          drag = { type: "group", groups: [...selection], lastX: w.x, lastY: w.y };
          canvas.classList.add("dragging");
          markDirty();
        }
        return;
      }
      if (drag.type === "marquee") {
        drag.x1 = w.x;
        drag.y1 = w.y;
      } else if (drag.type === "pan") {
        cam.x = drag.cx + (e.clientX - drag.sx);
        cam.y = drag.cy + (e.clientY - drag.sy);
      } else if (drag.type === "node") {
        drag.node.x = w.x - drag.ox;
        drag.node.y = w.y - drag.oy;
      } else if (drag.type === "group") {
        const dx = w.x - drag.lastX, dy = w.y - drag.lastY;
        for (const g of drag.groups) {
          if (g.pinned) continue; // закреплённые остаются на месте
          g.x += dx;
          g.y += dy;
          for (const n of g.ids) {
            n.x += dx;
            n.y += dy;
          }
        }
        drag.lastX = w.x;
        drag.lastY = w.y;
      } else if (drag.type === "folder") {
        const dx = w.x - drag.lastX, dy = w.y - drag.lastY;
        const f = drag.folder;
        if (f.collapsed) {
          f.cardX += dx;
          f.cardY += dy;
        } else {
          for (const g of f.files) {
            if (g.filteredOut || g.hidden) continue;
            g.x += dx;
            g.y += dy;
            for (const n of g.ids) {
              n.x += dx;
              n.y += dy;
            }
          }
        }
        drag.lastX = w.x;
        drag.lastY = w.y;
      }
      markDirty();
      return;
    }
    const w = screenToWorld(local.x, local.y);
    const ctrl = controlAt(w.x, w.y) || folderControlAt(w.x, w.y);
    if (ctrl) {
      if (!hoverButton || hoverButton.g !== ctrl.g || hoverButton.action !== ctrl.action) {
        hoverButton = ctrl;
        markDirty();
      }
      if (ctrl.g !== hoverEntity) setHover(ctrl.g);
      showButtonTooltip(e, ctrl);
      return;
    }
    if (hoverButton) {
      hoverButton = null;
      markDirty();
    }
    const ent = entityAt(w.x, w.y);
    if (ent !== hoverEntity) setHover(ent);
    if (ent) showTooltip(e, ent);
    else hideTooltip();
  });

  window.addEventListener("mouseup", (e) => {
    if (drag) {
      if (drag.type === "control") {
        runControl(drag.group, drag.action);
      } else if (drag.type === "folderControl") {
        runFolderControl(drag.folder, drag.action);
      } else if (drag.type === "folder") {
        // клик по свёрнутой папке в режиме следования/ленивого — фокус на неё
        const moved = Math.hypot(e.clientX - (drag.startSX || e.clientX), e.clientY - (drag.startSY || e.clientY));
        if ((followMode || lazyMode) && drag.folder.collapsed && moved < 4) {
          (followMode ? setFollowFocus : setLazyFocus)(drag.folder);
        } else {
          saveLayout();
        }
      } else if (drag.type === "toggleSelect") {
        if (selection.has(drag.group)) selection.delete(drag.group);
        else selection.add(drag.group);
        markDirty();
      } else if (drag.type === "marquee") {
        const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
        if (x1 - x0 > 2 || y1 - y0 > 2) {
          for (const g of groups) {
            if (!groupVisible(g)) continue;
            if (g.x < x1 && g.x + g.w > x0 && g.y < y1 && g.y + g.h > y0) selection.add(g);
          }
        }
        markDirty();
      } else if (drag.type === "node" || drag.type === "group") {
        const focusMode = followMode || lazyMode;
        if (focusMode && drag.type === "group" && drag.groups && drag.groups.length === 1) {
          // если почти не сдвинули — это клик для фокуса режима
          const moved = Math.hypot(e.clientX - (drag.startSX || e.clientX), e.clientY - (drag.startSY || e.clientY));
          if (moved < 4) (followMode ? setFollowFocus : setLazyFocus)(drag.groups[0]);
          else saveLayout();
        } else {
          saveLayout();
        }
      } else if (drag.type === "pan" && (followMode || lazyMode)) {
        // клик без заметного сдвига: фокус на единицу (файл/свёрнутая папка) или сброс на фоне
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) {
          const local = localPos(e);
          const w = screenToWorld(local.x, local.y);
          const u = focusUnitFromEntity(entityAt(w.x, w.y));
          (followMode ? setFollowFocus : setLazyFocus)(u || null);
        }
      }
    }
    drag = null;
    canvas.classList.remove("grabbing", "dragging");
  });

  canvas.addEventListener("dblclick", (e) => {
    const local = localPos(e);
    const w = screenToWorld(local.x, local.y);
    if (controlAt(w.x, w.y) || folderControlAt(w.x, w.y)) return; // по контролу — не разворачиваем
    const ent = entityAt(w.x, w.y);
    if (ent && isGroup(ent)) toggleExpand(ent);
    else if (ent && isFolder(ent)) runFolderControl(ent, "toggle");
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const local = localPos(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.max(0.02, Math.min(cam.scale * factor, 4));
      const wx = (local.x - cam.x) / cam.scale;
      const wy = (local.y - cam.y) / cam.scale;
      cam.scale = newScale;
      cam.x = local.x - wx * newScale;
      cam.y = local.y - wy * newScale;
      markDirty();
    },
    { passive: false },
  );

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setHover(entity) {
    hoverEntity = entity;
    hoverNeighbors = new Set();
    if (entity) {
      for (const e of renderEdges) {
        if (e.a === entity) hoverNeighbors.add(e.b);
        else if (e.b === entity) hoverNeighbors.add(e.a);
      }
    }
    markDirty();
  }

  function showTooltip(e, ent) {
    tooltip.hidden = false;
    if (isFolder(ent)) {
      tooltip.innerHTML = `<b>${escapeHtml(ent.name)}</b> <span class="muted">папка${ent.collapsed ? " · свёрнута" : ""}</span><br><span class="muted">${escapeHtml(ent.key)}</span><br><span class="muted">${ent.files.length} файлов · ${hoverNeighbors.size} связей с папками</span>`;
      tooltip.style.left = e.clientX + 14 + "px";
      tooltip.style.top = e.clientY + 14 + "px";
      return;
    }
    if (isGroup(ent)) {
      tooltip.innerHTML = `<b>${escapeHtml(basename(ent.path))}</b> <span class="muted">файл</span><br><span class="muted">${escapeHtml(ent.path)}</span><br><span class="muted">${ent.ids.length} функций · ${hoverNeighbors.size} связей с файлами</span>`;
    } else {
      tooltip.innerHTML = `<b>${escapeHtml(ent.name)}</b> <span class="muted">${ent.kind}</span><br><span class="muted">${escapeHtml(ent.file)}:${ent.line}</span><br><span class="muted">связей: ${ent.deg}</span>`;
    }
    tooltip.style.left = e.clientX + 14 + "px";
    tooltip.style.top = e.clientY + 14 + "px";
  }
  function showButtonTooltip(e, ctrl) {
    tooltip.hidden = false;
    const label = isFolder(ctrl.g) ? FOLDER_CTRL_LABEL[ctrl.action](ctrl.g) : CTRL_LABEL[ctrl.action](ctrl.g);
    tooltip.innerHTML = `<b>${escapeHtml(label)}</b>`;
    tooltip.style.left = e.clientX + 14 + "px";
    tooltip.style.top = e.clientY + 14 + "px";
  }
  function hideTooltip() {
    tooltip.hidden = true;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  }

  // ---- поиск / контролы ---------------------------------------------------
  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    highlight = new Set();
    highlightGroups = new Set();
    if (q) {
      let first = null;
      for (const n of nodes.values()) {
        if (!nodeVisible(n)) continue;
        if (n.name.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)) {
          highlight.add(n.id);
          if (n.group) highlightGroups.add(n.group);
          if (!first) first = n.group && !n.group.expanded ? n.group : n;
        }
      }
      if (first) centerOn(first);
    }
    markDirty();
  });

  if (filterEl) {
    filterEl.addEventListener("input", () => applyFilter());
  }

  function centerOn(ent) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    cam.x = cw / 2 - (ent.x + ent.w / 2) * cam.scale;
    cam.y = ch / 2 - (ent.y + ent.h / 2) * cam.scale;
  }

  function syncModeButtons() {
    if (modeFilesEl) modeFilesEl.classList.toggle("active", layoutMode === "files");
    if (modeFoldersEl) modeFoldersEl.classList.toggle("active", layoutMode === "folder");
  }
  function setLayoutMode(mode) {
    if (mode !== "files" && mode !== "folder") return;
    if (layoutMode === mode) return;
    layoutMode = mode;
    syncModeButtons();
    clearSaved(); // свежая раскладка в новом режиме
    layout();
    applyFilter();
    saveLayout();
    fit();
  }
  if (modeFilesEl) modeFilesEl.addEventListener("click", () => setLayoutMode("files"));
  if (modeFoldersEl) modeFoldersEl.addEventListener("click", () => setLayoutMode("folder"));
  syncModeButtons();

  function setFollowMode(on) {
    followMode = !!on;
    followFocus = null;
    followSet = new Set();
    if (followMode && lazyMode) setLazyMode(false); // режимы взаимоисключающие
    if (followModeEl) followModeEl.classList.toggle("active", followMode);
    rebuildRenderEdges();
    markDirty();
  }
  function setLazyMode(on) {
    lazyMode = !!on;
    lazyFocus = null;
    if (lazyMode && followMode) setFollowMode(false); // режимы взаимоисключающие
    if (lazyModeEl) lazyModeEl.classList.toggle("active", lazyMode);
    rebuildRenderEdges();
    markDirty();
  }
  if (followModeEl) {
    followModeEl.addEventListener("click", () => setFollowMode(!followMode));
  }
  if (lazyModeEl) {
    lazyModeEl.addEventListener("click", () => setLazyMode(!lazyMode));
  }

  document.getElementById("relayout").addEventListener("click", () => {
    clearSaved();
    layout();
    applyFilter();
    fit();
  });
  document.getElementById("fit").addEventListener("click", fit);
  hideIsolatedEl.addEventListener("change", () => {
    layout();
    applySaved();
    applyFilter();
    fit();
  });
  const expandAllEl = document.getElementById("expandAll");
  const collapseAllEl = document.getElementById("collapseAll");
  if (expandAllEl) expandAllEl.addEventListener("click", () => setAllExpanded(true));
  if (collapseAllEl) collapseAllEl.addEventListener("click", () => setAllExpanded(false));
  const showHiddenEl = document.getElementById("showHidden");
  if (showHiddenEl) showHiddenEl.addEventListener("click", showAllHidden);

  // ---- пересборка графа для указанной папки ------------------------------
  const rootPathEl = document.getElementById("rootPath");
  const rebuildEl = document.getElementById("rebuild");
  let rebuilding = false;
  async function rebuildFrom(root) {
    root = (root || "").trim();
    if (!root || rebuilding) return;
    rebuilding = true;
    statsEl.textContent = "пересборка…";
    if (vscodeApi) {
      vscodeApi.postMessage({ type: "rebuild", root, includeTests: false });
      // rebuilding сбросится по ответу graph/error
      setTimeout(() => {
        rebuilding = false;
      }, 50);
      return;
    }
    try {
      const res = await fetch("/api/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root }),
      });
      const data = await res.json();
      if (!res.ok) {
        statsEl.textContent = "ошибка: " + (data && data.error ? data.error : res.status);
        return;
      }
      build(data);
    } catch (e) {
      statsEl.textContent = "ошибка сети при пересборке";
    } finally {
      rebuilding = false;
    }
  }
  if (rebuildEl && rootPathEl) {
    rebuildEl.addEventListener("click", () => rebuildFrom(rootPathEl.value));
    rootPathEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") rebuildFrom(rootPathEl.value);
    });
  }

  // ---- цикл рендера -------------------------------------------------------
  function syncToolbarHeight() {
    const tb = document.getElementById("toolbar");
    if (!tb) return;
    const h = Math.ceil(tb.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--toolbar-h", h + "px");
  }
  function resize() {
    syncToolbarHeight();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    markDirty();
  }
  window.addEventListener("resize", resize);
  // тулбар переносится на несколько строк — следим за его высотой
  const toolbarEl = document.getElementById("toolbar");
  if (toolbarEl && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => resize()).observe(toolbarEl);
  }

  function frame() {
    if (dirty) render();
    requestAnimationFrame(frame);
  }

  resize();
  load();
  frame();

  // отладочный хук (для headless-проверок и ручной отладки)
  window.__cg = {
    get groups() {
      return groups;
    },
    get folders() {
      return folders;
    },
    get layoutMode() {
      return layoutMode;
    },
    get renderEdges() {
      return renderEdges;
    },
    get cam() {
      return cam;
    },
    markDirty,
    applySize,
    onEditingChange,
    openEditor,
    runFolderControl,
    runControl,
    setLayoutMode,
    setFollowMode,
    setLazyMode,
    setFollowFocus,
    setLazyFocus,
    fit,
    centerOn(cx, cy, scale) {
      cam.scale = scale;
      cam.x = canvas.clientWidth / 2 - cx * scale;
      cam.y = canvas.clientHeight / 2 - cy * scale;
      markDirty();
    },
  };
})();
