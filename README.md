# codegraph-studio

Простой, но полностью рабочий парсер TypeScript-кодовой базы. Строит дерево
вызовов между функциями и рисует его на HTML canvas с зумом, панорамой,
перетаскиванием узлов и кривыми связями-стрелками.

Может работать **как standalone** (браузер + `serve.ts`) или как **расширение
VS Code** с редактированием файлов прямо на холсте (CodeMirror 6).

Проект самодостаточный: его можно вынести в отдельный репозиторий как есть.

## VS Code extension

1. Сборка:
   ```bash
   cd lib/codegraph
   npm install
   npm run build
   ```
2. В VS Code: **Extensions: Install from VSIX…** после `npm run package`,
   либо **Run and Debug → Run Codegraph Extension** из папки `lib/codegraph`
   (есть `.vscode/launch.json`).
3. Команда: **Codegraph: Open Call Graph**.
4. На карточке файла иконка ✎ открывает редактор на холсте (подсветка TS/JS,
   сохранение через `WorkspaceEdit` + `doc.save`, ⌘/Ctrl+S). Связи, зум, пан
   и остальные режимы холста сохраняются; редактор масштабируется вместе с
   камерой.

Сообщения webview ↔ host: `ready` / `graph` / `openFile` / `fileContent` /
`saveFile` / `saved` / `rebuild` / `error` / `externalChange`.

## Как устроено

1. **`parse.ts`** — обходит `.ts/.tsx` файлы через TypeScript Compiler API (AST,
   без type-checker). Ловит функции/методы, импорты `{ a } from './x'`,
   `new Foo()`, реэкспорты, top-level вызовы, методы инстансов и DI через
   конструктор/поля. Результат — `graph.json`.

2. **`index.html` + `viewer.js` + `styles.css`** — визуализатор на canvas:
   карточки-файлы с контролами (редактировать / закрепить / скрыть / связи /
   свернуть), группировка файлы|папки, glob-фильтр, следование, ленивое
   наблюдение, папки-острова, localStorage-раскладка, пересборка по пути.

3. **`serve.ts`** — мини статик-сервер + `POST /api/rebuild` для standalone.

4. **`extension/extension.ts` + `webview/editor-overlay.js`** — VS Code host
   и CodeMirror-оверлеи. Сборка: `esbuild.mjs` → `dist/extension.cjs` +
   `dist/webview/{viewer.js,styles.css,editor.js}`.

## Запуск (standalone)

```bash
npx tsx lib/codegraph/parse.ts
npx tsx lib/codegraph/serve.ts
```

Флаги: `--root DIR`, `--out FILE`, `--include-tests`.
Игнорируются: `node_modules`, `dist`, `build`, `out`, `.next`, `coverage`,
`.git`, `tmp` и `.d.ts`.
