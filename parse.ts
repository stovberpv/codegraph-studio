#!/usr/bin/env tsx
/**
 * codegraph — простой парсер TypeScript-кодовой базы.
 *
 * Что делает:
 *  1. Рекурсивно обходит .ts/.tsx файлы в корне (по умолчанию cwd).
 *  2. Через TypeScript Compiler API (AST, без type-checker — быстро) находит:
 *     - объявления функций (function / const-стрелки / методы классов);
 *     - именованные и default импорты (import { a, b as c } from './x');
 *     - вызовы функций внутри тел функций.
 *  3. Резолвит вызовы в рёбра "функция -> функция" по имени:
 *     локальная функция файла -> метод того же класса (this.x) -> импортированное имя.
 *  4. Пишет graph.json (узлы = функции, сгруппированы по файлам; рёбра = вызовы).
 *
 * Запуск:  tsx parse.ts [--root DIR] [--out FILE] [--include-tests]
 */

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------

interface Args {
  root: string;
  out: string;
  includeTests: boolean;
}

function parseArgs(argv: string[]): Args {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args: Args = {
    root: process.cwd(),
    out: path.join(here, "graph.json"),
    includeTests: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = path.resolve(argv[++i]!);
    else if (a === "--out") args.out = path.resolve(argv[++i]!);
    else if (a === "--include-tests") args.includeTests = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Обход файловой системы
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".turbo",
  ".vite",
  "tmp",
]);

function isTsFile(name: string): boolean {
  if (name.endsWith(".d.ts")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

function walk(root: string, selfDir: string, includeTests: boolean): string[] {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (full === selfDir) continue; // не парсим сам codegraph
        stack.push(full);
      } else if (e.isFile() && isTsFile(e.name)) {
        if (!includeTests && /\.(test|spec)\.(ts|tsx)$/.test(e.name)) continue;
        files.push(full);
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Модель графа
// ---------------------------------------------------------------------------

interface FnNode {
  id: string; // relPath#Name
  name: string; // Name (может быть Class.method)
  file: string; // relPath
  kind: "function" | "arrow" | "method" | "module";
  line: number;
}

// метка узла верхнего уровня модуля (код вне функций)
const MODULE_NAME = "«module»";

interface FileEntry {
  path: string;
  functions: string[]; // node ids
}

interface Edge {
  from: string;
  to: string;
}

interface Graph {
  root: string;
  generatedAt: string;
  stats: { files: number; nodes: number; edges: number };
  files: FileEntry[];
  nodes: FnNode[];
  edges: Edge[];
}

// Промежуточная инфа по одному файлу
interface FileFacts {
  relPath: string;
  sf: ts.SourceFile;
  // локальное имя -> module specifier (только относительные важны)
  imports: Map<string, string>;
  // имя top-level функции/const -> nodeId
  localFns: Map<string, string>;
  // "Class.method" -> nodeId, и просто "method" -> nodeId (для this.x)
  methods: Map<string, string>;
  // реэкспорты: exportedName -> { spec, orig } для `export { a as b } from './x'`
  reexports: Map<string, { spec: string; orig: string }>;
  // `export * from './x'` — список спецификаторов
  wildcards: string[];
  // имя переменной -> имя класса из `const x = new Foo(...)` (эвристика инстансов)
  instanceVars: Map<string, string>;
  // className -> (fieldName -> typeName) для DI: constructor(private svc: Svc) / private svc: Svc
  classFields: Map<string, Map<string, string>>;
  // список функций (и псевдо-узла модуля) с AST-узлами тела для второго прохода
  fnBodies: Array<{
    node: FnNode;
    body: ts.Node;
    className?: string;
    isModule?: boolean;
    scan?: ts.Node[]; // для модуля — список top-level выражений
  }>;
}

// ---------------------------------------------------------------------------
// Разбор одного файла (первый проход: объявления и импорты)
// ---------------------------------------------------------------------------

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/** Имя типа из TypeNode: Svc, Svc<T> → Svc, ns.Svc → Svc. */
function typeNameOf(tn: ts.TypeNode | undefined): string | undefined {
  if (!tn) return undefined;
  if (ts.isTypeReferenceNode(tn)) {
    const n = tn.typeName;
    if (ts.isIdentifier(n)) return n.text;
    if (ts.isQualifiedName(n)) return n.right.text;
  }
  return undefined;
}

function ensureClassFields(facts: FileFacts, className: string): Map<string, string> {
  let m = facts.classFields.get(className);
  if (!m) {
    m = new Map();
    facts.classFields.set(className, m);
  }
  return m;
}

function collectFacts(relPath: string, sf: ts.SourceFile): FileFacts {
  const facts: FileFacts = {
    relPath,
    sf,
    imports: new Map(),
    localFns: new Map(),
    methods: new Map(),
    reexports: new Map(),
    wildcards: [],
    instanceVars: new Map(),
    classFields: new Map(),
    fnBodies: [],
  };

  const nodeId = (name: string) => `${relPath}#${name}`;

  for (const stmt of sf.statements) {
    // -- импорты --------------------------------------------------------
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const clause = stmt.importClause;
      if (clause.name) {
        // import Foo from '...'
        facts.imports.set(clause.name.text, spec);
      }
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          facts.imports.set(el.name.text, spec);
        }
      }
      continue;
    }

    // -- реэкспорты: export { a as b } from './x'  /  export * from './x' ----
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const exported = el.name.text;
          const orig = el.propertyName ? el.propertyName.text : el.name.text;
          facts.reexports.set(exported, { spec, orig });
        }
      } else if (!clause) {
        facts.wildcards.push(spec); // export * from './x'
      }
      continue;
    }

    // -- function foo() {} ---------------------------------------------
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      const id = nodeId(name);
      const fn: FnNode = { id, name, file: relPath, kind: "function", line: lineOf(sf, stmt) };
      facts.localFns.set(name, id);
      if (stmt.body) facts.fnBodies.push({ node: fn, body: stmt.body });
      else facts.fnBodies.push({ node: fn, body: stmt });
      continue;
    }

    // -- const foo = () => {} / function expr --------------------------
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          const name = decl.name.text;
          const id = nodeId(name);
          const fn: FnNode = { id, name, file: relPath, kind: "arrow", line: lineOf(sf, decl) };
          facts.localFns.set(name, id);
          facts.fnBodies.push({ node: fn, body: init.body ?? init });
        }
      }
      continue;
    }

    // -- class C { method() {} } ---------------------------------------
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const className = stmt.name.text;
      const fields = ensureClassFields(facts, className);
      for (const member of stmt.members) {
        // конструктор: собираем parameter properties + тело
        if (ts.isConstructorDeclaration(member)) {
          for (const p of member.parameters) {
            // parameter property: constructor(private svc: SvcType)
            const isProp =
              p.modifiers &&
              p.modifiers.some(
                (m) =>
                  m.kind === ts.SyntaxKind.PublicKeyword ||
                  m.kind === ts.SyntaxKind.PrivateKeyword ||
                  m.kind === ts.SyntaxKind.ProtectedKeyword ||
                  m.kind === ts.SyntaxKind.ReadonlyKeyword,
              );
            if (!isProp || !ts.isIdentifier(p.name)) continue;
            const tn = typeNameOf(p.type);
            if (tn) fields.set(p.name.text, tn);
          }
          if (member.body) {
            const qualified = `${className}.constructor`;
            const id = nodeId(qualified);
            const fn: FnNode = {
              id,
              name: qualified,
              file: relPath,
              kind: "method",
              line: lineOf(sf, member),
            };
            facts.methods.set(qualified, id);
            if (!facts.methods.has("constructor")) facts.methods.set("constructor", id);
            facts.fnBodies.push({ node: fn, body: member.body, className });
          }
          continue;
        }
        if (ts.isMethodDeclaration(member) && member.body) {
          const mName = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
          if (!mName) continue;
          const qualified = `${className}.${mName}`;
          const id = nodeId(qualified);
          const fn: FnNode = { id, name: qualified, file: relPath, kind: "method", line: lineOf(sf, member) };
          facts.methods.set(qualified, id);
          // короткое имя -> id (для резолва this.x); при коллизии оставляем первый
          if (!facts.methods.has(mName)) facts.methods.set(mName, id);
          facts.fnBodies.push({ node: fn, body: member.body, className });
          continue;
        }
        // поле с типом: private svc: SvcType;  (+ опционально стрелка)
        if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const tn = typeNameOf(member.type);
          if (tn) fields.set(member.name.text, tn);
          const init = member.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            const mName = member.name.text;
            const qualified = `${className}.${mName}`;
            const id = nodeId(qualified);
            const fn: FnNode = { id, name: qualified, file: relPath, kind: "method", line: lineOf(sf, member) };
            facts.methods.set(qualified, id);
            if (!facts.methods.has(mName)) facts.methods.set(mName, id);
            facts.fnBodies.push({ node: fn, body: init.body ?? init, className });
          }
        }
      }
      continue;
    }
  }

  // -- эвристика инстансов: x = new Foo(...) (по всему файлу) ---------------
  const collectInstances = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      facts.instanceVars.set(node.name.text, node.initializer.expression.text);
    }
    ts.forEachChild(node, collectInstances);
  };
  collectInstances(sf);

  // -- код верхнего уровня модуля (вне функций/классов) --------------------
  const moduleScan: ts.Node[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue;
    if (ts.isExportDeclaration(stmt)) continue; // реэкспорты/type-экспорты
    if (ts.isFunctionDeclaration(stmt)) continue; // отдельный узел
    if (ts.isClassDeclaration(stmt)) continue; // методы — отдельные узлы
    if (
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)
    )
      continue;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (!init) continue;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue; // отдельные узлы
        moduleScan.push(init);
      }
      continue;
    }
    moduleScan.push(stmt); // выражения, if/for/try/switch/throw, export default expr и т.п.
  }
  if (moduleScan.length) {
    const modNode: FnNode = {
      id: `${relPath}#${MODULE_NAME}`,
      name: MODULE_NAME,
      file: relPath,
      kind: "module",
      line: 1,
    };
    facts.fnBodies.push({ node: modNode, body: sf, isModule: true, scan: moduleScan });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Резолв module specifier -> relPath
// ---------------------------------------------------------------------------

function resolveModule(
  fromRel: string,
  spec: string,
  root: string,
  fileSet: Set<string>,
): string | undefined {
  if (!spec.startsWith(".")) return undefined; // пакеты игнорируем
  const fromAbsDir = path.dirname(path.join(root, fromRel));
  const base = path.normalize(path.join(fromAbsDir, spec));

  const candidates: string[] = [];
  // ESM/NodeNext стиль: импорт с расширением .js/.jsx/.mjs/.cjs, а на диске .ts/.tsx
  const jsExt = base.match(/\.(js|jsx|mjs|cjs)$/);
  if (jsExt) {
    const noExt = base.slice(0, -jsExt[0].length);
    candidates.push(noExt + ".ts", noExt + ".tsx");
  }
  candidates.push(base + ".ts", base + ".tsx");
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));
  candidates.push(base); // на случай, если путь уже указывает на существующий файл

  for (const abs of candidates) {
    const rel = toPosix(path.relative(root, abs));
    if (fileSet.has(rel)) return rel;
  }
  return undefined;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Второй проход: извлечение вызовов -> рёбра
// ---------------------------------------------------------------------------

function extractCalls(
  facts: FileFacts,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  edgeSet: Set<string>,
  edges: Edge[],
): void {
  for (const entry of facts.fnBodies) {
    const fn = entry.node;
    const className = entry.className;
    const targets = new Set<string>();

    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const target = resolveCallee(n.expression, facts, className, root, fileSet, factsByRel, false);
        if (target && target !== fn.id) targets.add(target);
      } else if (ts.isNewExpression(n)) {
        // new X() -> конструктор класса X
        const target = resolveCallee(n.expression, facts, className, root, fileSet, factsByRel, true);
        if (target && target !== fn.id) targets.add(target);
      }
      ts.forEachChild(n, visit);
    };
    if (entry.isModule && entry.scan) {
      for (const s of entry.scan) visit(s);
    } else {
      visit(entry.body);
    }

    for (const to of targets) {
      const key = fn.id + "\u0000" + to;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ from: fn.id, to });
    }
  }
}

// Ищет определение экспортируемого символа в файле, следуя по реэкспортам
// (`export { a as b } from './x'` и `export * from './x'`).
//  - method === null  -> свободная функция с именем `name`;
//  - method !== null  -> метод класса `${name}.${method}` (в т.ч. 'constructor').
function resolveExport(
  rel: string,
  name: string,
  method: string | null,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  seen: Set<string>,
): string | undefined {
  const key = rel + "|" + name + "|" + (method ?? "\u0000fn");
  if (seen.has(key)) return undefined;
  seen.add(key);

  const tf = factsByRel.get(rel);
  if (!tf) return undefined;

  // прямое определение в этом файле
  if (method !== null) {
    const q = `${name}.${method}`;
    if (tf.methods.has(q)) return tf.methods.get(q);
  } else {
    if (tf.localFns.has(name)) return tf.localFns.get(name);
  }

  // именованный реэкспорт
  const re = tf.reexports.get(name);
  if (re) {
    const nr = resolveModule(rel, re.spec, root, fileSet);
    if (nr) {
      const r = resolveExport(nr, re.orig, method, root, fileSet, factsByRel, seen);
      if (r) return r;
    }
  }

  // export * from './x'
  for (const spec of tf.wildcards) {
    const nr = resolveModule(rel, spec, root, fileSet);
    if (nr) {
      const r = resolveExport(nr, name, method, root, fileSet, factsByRel, seen);
      if (r) return r;
    }
  }

  return undefined;
}

function resolveCallee(
  expr: ts.Expression,
  facts: FileFacts,
  className: string | undefined,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  isNew: boolean,
): string | undefined {
  // foo()  или  new Foo()
  if (ts.isIdentifier(expr)) {
    const name = expr.text;

    if (isNew) {
      // new Foo() -> Foo.constructor (локально или из импорта, следуя реэкспортам)
      const q = `${name}.constructor`;
      if (facts.methods.has(q)) return facts.methods.get(q);
      const spec = facts.imports.get(name);
      if (spec) {
        const targetRel = resolveModule(facts.relPath, spec, root, fileSet);
        if (targetRel) return resolveExport(targetRel, name, "constructor", root, fileSet, factsByRel, new Set());
      }
      return undefined;
    }

    // 1) локальная функция файла
    if (facts.localFns.has(name)) return facts.localFns.get(name);
    // 2) импортированное имя (следуя реэкспортам через баррелы)
    const spec = facts.imports.get(name);
    if (spec) {
      const targetRel = resolveModule(facts.relPath, spec, root, fileSet);
      if (targetRel) return resolveExport(targetRel, name, null, root, fileSet, factsByRel, new Set());
    }
    return undefined;
  }

  // this.method() / this.field.method() / obj.method()
  if (ts.isPropertyAccessExpression(expr)) {
    const propName = expr.name.text;
    const obj = expr.expression;

    // this.method() -> метод того же класса
    if (obj.kind === ts.SyntaxKind.ThisKeyword && className) {
      const qualified = `${className}.${propName}`;
      if (facts.methods.has(qualified)) return facts.methods.get(qualified);
      return undefined;
    }

    // this.field.method() — DI через конструктор / типизированное поле
    if (
      className &&
      ts.isPropertyAccessExpression(obj) &&
      obj.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const field = obj.name.text;
      const typeName = facts.classFields.get(className)?.get(field);
      if (typeName) {
        const lq = `${typeName}.${propName}`;
        if (facts.methods.has(lq)) return facts.methods.get(lq);
        const cspec = facts.imports.get(typeName);
        if (cspec) {
          const crel = resolveModule(facts.relPath, cspec, root, fileSet);
          if (crel) {
            const r = resolveExport(crel, typeName, propName, root, fileSet, factsByRel, new Set());
            if (r) return r;
          }
        }
      }
      return undefined;
    }

    if (ts.isIdentifier(obj)) {
      const objName = obj.text;

      // 1) локальный инстанс: const x = new Foo(); x.method()
      const localCls = facts.instanceVars.get(objName);
      if (localCls) {
        const lq = `${localCls}.${propName}`;
        if (facts.methods.has(lq)) return facts.methods.get(lq); // класс в этом же файле
        const cspec = facts.imports.get(localCls); // класс импортирован
        if (cspec) {
          const crel = resolveModule(facts.relPath, cspec, root, fileSet);
          if (crel) {
            const r = resolveExport(crel, localCls, propName, root, fileSet, factsByRel, new Set());
            if (r) return r;
          }
        }
      }

      // 2) импортированное имя objName
      const spec = facts.imports.get(objName);
      if (spec) {
        const targetRel = resolveModule(facts.relPath, spec, root, fileSet);
        if (targetRel) {
          // 2a) статический/неймспейс: objName — класс, метод objName.propName
          const r1 = resolveExport(targetRel, objName, propName, root, fileSet, factsByRel, new Set());
          if (r1) return r1;
          const tf = factsByRel.get(targetRel);
          // 2b) импортированный инстанс: objName = new Cls() в target-модуле
          const instCls = tf?.instanceVars.get(objName);
          if (instCls) {
            const r2 = resolveExport(targetRel, instCls, propName, root, fileSet, factsByRel, new Set());
            if (r2) return r2;
          }
          // 2c) свободная функция propName в target-модуле (namespace-подобный импорт)
          if (tf?.localFns.has(propName)) return tf.localFns.get(propName);
        }
      }

      // 3) локальный класс: Foo.method() (static)
      const localQ = `${objName}.${propName}`;
      if (facts.methods.has(localQ)) return facts.methods.get(localQ);
    }
    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Построение графа (переиспользуется CLI и сервером пересборки)
// ---------------------------------------------------------------------------

export interface BuildOptions {
  includeTests?: boolean;
  /** папка самого codegraph, чтобы не парсить его собственные файлы */
  selfDir?: string;
}

export function buildGraph(root: string, opts: BuildOptions = {}): Graph {
  const includeTests = opts.includeTests ?? false;
  const selfDir = opts.selfDir ?? path.dirname(fileURLToPath(import.meta.url));

  const absFiles = walk(root, selfDir, includeTests);
  const relFiles = absFiles.map((f) => toPosix(path.relative(root, f)));
  const fileSet = new Set(relFiles);

  // Первый проход
  const factsByRel = new Map<string, FileFacts>();
  const nodes: FnNode[] = [];
  const files: FileEntry[] = [];

  for (let i = 0; i < absFiles.length; i++) {
    const abs = absFiles[i]!;
    const rel = relFiles[i]!;
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKindFor(rel));
    const facts = collectFacts(rel, sf);
    factsByRel.set(rel, facts);

    const fnIds: string[] = [];
    for (const { node } of facts.fnBodies) {
      nodes.push(node);
      fnIds.push(node.id);
    }
    if (fnIds.length) files.push({ path: rel, functions: fnIds });
  }

  // Второй проход: вызовы
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const facts of factsByRel.values()) {
    extractCalls(facts, root, fileSet, factsByRel, edgeSet, edges);
  }
  // отфильтровать рёбра на несуществующие узлы (на всякий случай)
  const cleanEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // убрать пустые псевдо-узлы модуля без единой связи (нет top-level вызовов)
  const degree = new Set<string>();
  for (const e of cleanEdges) {
    degree.add(e.from);
    degree.add(e.to);
  }
  const dropped = new Set(
    nodes.filter((n) => n.kind === "module" && !degree.has(n.id)).map((n) => n.id),
  );
  const finalNodes = nodes.filter((n) => !dropped.has(n.id));
  const finalFiles = files
    .map((f) => ({ path: f.path, functions: f.functions.filter((id) => !dropped.has(id)) }))
    .filter((f) => f.functions.length);

  return {
    root,
    generatedAt: new Date().toISOString(),
    stats: { files: finalFiles.length, nodes: finalNodes.length, edges: cleanEdges.length },
    files: finalFiles,
    nodes: finalNodes,
    edges: cleanEdges,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const graph = buildGraph(args.root, { includeTests: args.includeTests, selfDir });
  fs.writeFileSync(args.out, JSON.stringify(graph));
  const ms = Date.now() - t0;
  console.log(
    `codegraph: ${graph.stats.files} файлов с функциями, ` +
      `${graph.stats.nodes} узлов, ${graph.stats.edges} связей за ${ms}ms`,
  );
  console.log(`graph.json -> ${args.out}`);
}

// запускаем main только при прямом вызове (не при импорте из serve.ts / extension)
try {
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const metaUrl = typeof import.meta !== "undefined" && import.meta.url ? import.meta.url : "";
  if (metaUrl && invokedPath) {
    const thisFile = fileURLToPath(metaUrl);
    if (invokedPath === thisFile || invokedPath === path.resolve(thisFile)) {
      main();
    }
  }
} catch {
  /* bundled CJS без import.meta — CLI не запускаем */
}
