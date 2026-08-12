/**
 * VS Code extension host для codegraph.
 * Команда codegraph.open → WebviewPanel с холстом; парсер в host,
 * чтение/сохранение файлов через workspace.fs / WorkspaceEdit.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildGraph } from "../parse.ts";

type HostToWebview =
  | { type: "graph"; graph: unknown }
  | { type: "fileContent"; path: string; text: string; language: string }
  | { type: "saved"; path: string }
  | { type: "error"; message: string }
  | { type: "externalChange"; path: string; text: string };

type WebviewToHost =
  | { type: "ready" }
  | { type: "openFile"; path: string }
  | { type: "saveFile"; path: string; text: string }
  | { type: "rebuild"; root?: string; includeTests?: boolean };

let currentPanel: vscode.WebviewPanel | undefined;
/** пути, открытые в оверлеях (relative), для externalChange */
const openOverlayPaths = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codegraph.open", () => openPanel(context)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!currentPanel) return;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const rel = path.relative(folder.uri.fsPath, doc.uri.fsPath).split(path.sep).join("/");
      if (!openOverlayPaths.has(rel)) return;
      post(currentPanel, { type: "externalChange", path: rel, text: doc.getText() });
    }),
  );
}

export function deactivate(): void {
  currentPanel = undefined;
  openOverlayPaths.clear();
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  panel.webview.postMessage(msg);
}

function openPanel(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage("Codegraph Studio: откройте папку проекта (File → Open Folder).");
    return;
  }

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.One);
    sendGraph(currentPanel, folder.uri.fsPath, context);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "codegraph",
    "Codegraph Studio",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, "dist", "webview")),
      ],
    },
  );
  currentPanel = panel;

  const nonce = randomNonce();
  panel.webview.html = getHtml(panel.webview, context.extensionPath, nonce);

  panel.onDidDispose(
    () => {
      currentPanel = undefined;
      openOverlayPaths.clear();
    },
    null,
    context.subscriptions,
  );

  panel.webview.onDidReceiveMessage(
    async (raw: WebviewToHost) => {
      try {
        await handleMessage(panel, context, folder, raw);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        post(panel, { type: "error", message });
      }
    },
    null,
    context.subscriptions,
  );
}

async function handleMessage(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  msg: WebviewToHost,
): Promise<void> {
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;

  if (msg.type === "ready") {
    sendGraph(panel, folder.uri.fsPath, context);
    return;
  }

  if (msg.type === "rebuild") {
    const root = (msg.root || "").trim() || folder.uri.fsPath;
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      post(panel, { type: "error", message: `путь не найден или не папка: ${root}` });
      return;
    }
    sendGraph(panel, root, context, !!msg.includeTests);
    return;
  }

  if (msg.type === "openFile") {
    const rel = normalizeRel(msg.path);
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    let text: string;
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(buf).toString("utf8");
    } catch {
      post(panel, { type: "error", message: `не удалось прочитать ${rel}` });
      return;
    }
    openOverlayPaths.add(rel);
    const language = rel.endsWith(".tsx") ? "tsx" : rel.endsWith(".ts") ? "typescript" : "javascript";
    post(panel, { type: "fileContent", path: rel, text, language });
    return;
  }

  if (msg.type === "saveFile") {
    const rel = normalizeRel(msg.path);
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    const doc = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, full, msg.text ?? "");
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      post(panel, { type: "error", message: `не удалось применить правку: ${rel}` });
      return;
    }
    await doc.save();
    post(panel, { type: "saved", path: rel });
    return;
  }
}

function sendGraph(
  panel: vscode.WebviewPanel,
  root: string,
  context: vscode.ExtensionContext,
  includeTests = false,
): void {
  try {
    const selfDir = path.join(context.extensionPath);
    const graph = buildGraph(root, { includeTests, selfDir });
    post(panel, { type: "graph", graph });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post(panel, { type: "error", message: `парсинг: ${message}` });
  }
}

function normalizeRel(p: string): string {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getHtml(webview: vscode.Webview, extensionPath: string, nonce: string): string {
  const base = path.join(extensionPath, "dist", "webview");
  const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(base, "styles.css")));
  const viewerUri = webview.asWebviewUri(vscode.Uri.file(path.join(base, "viewer.js")));
  const editorUri = webview.asWebviewUri(vscode.Uri.file(path.join(base, "editor.js")));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  // Разметка совпадает с index.html + слой #editors и editor.js
  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>codegraph-studio</title>
    <link rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    <div id="toolbar">
      <div class="brand"><span class="logo"></span>codegraph&nbsp;studio</div>
      <span class="sep"></span>
      <div class="grp" role="group" aria-label="Группировка">
        <button id="modeFiles" class="active" title="Гравитация между файлами">файлы</button>
        <button id="modeFolders" title="Сначала внутри папки, потом между папками">папки</button>
      </div>
      <button id="followMode" class="toggle" title="Глобальное следование">следование</button>
      <button id="lazyMode" class="toggle" title="Ленивое наблюдение">ленивое наблюдение</button>
      <span class="sep"></span>
      <button id="showHidden" title="Показать скрытые файлы">показать скрытое</button>
      <label class="chk" title="Спрятать файлы без межфайловых связей"><input id="hideIsolated" type="checkbox" /><span>одиночные</span></label>
      <span class="sep"></span>
      <div class="grp" role="group" aria-label="Вид">
        <button id="relayout" title="Сбросить раскладку">сброс</button>
        <button id="fit" title="Вписать граф в экран">вписать</button>
      </div>
      <label class="field path-field" title="Путь к папке проекта">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>
        <input id="rootPath" class="path" type="text" spellcheck="false" placeholder="путь к папке проекта…" />
      </label>
      <button id="rebuild" class="primary" title="Пересобрать граф">пересобрать</button>
    </div>
    <canvas id="canvas"></canvas>
    <div id="editors" aria-hidden="true"></div>
    <div id="searchPanel" class="float-panel">
      <label class="field" title="Поиск функции">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
        <input id="search" type="search" placeholder="поиск функции…" />
      </label>
      <label class="field" title="Glob-фильтр">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        <input id="filter" type="text" spellcheck="false" placeholder="glob: **/*.service.ts, !*.test.ts" />
      </label>
    </div>
    <div id="cardPanel" class="float-panel">
      <button id="expandAll" title="Раскрыть все карточки">развернуть</button>
      <button id="collapseAll" title="Свернуть все карточки">свернуть</button>
    </div>
    <div id="infobar" class="info-bar"><span id="stats">загрузка…</span></div>
    <div id="hint" class="legend">
      <span><b>колесо</b> — зум</span>
      <span><b>фон</b> — панорама</span>
      <span><b>✎</b> — редактировать на холсте</span>
      <span><b>следование / ленивое</b> — клик по файлу или папке</span>
    </div>
    <div id="tooltip" class="tooltip" hidden></div>
    <script nonce="${nonce}" src="${viewerUri}"></script>
    <script nonce="${nonce}" src="${editorUri}"></script>
  </body>
</html>`;
}
