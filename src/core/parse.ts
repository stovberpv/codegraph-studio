#!/usr/bin/env tsx
/**
 * codegraph — a simple parser for a TypeScript codebase.
 *
 * What it does:
 *  1. Recursively walks .ts/.tsx files under the root (defaults to cwd).
 *  2. Uses the TypeScript Compiler API (AST only, no type-checker — fast) to find:
 *     - function declarations (function / const arrows / class methods);
 *     - named and default imports (import { a, b as c } from './x');
 *     - function calls inside function bodies.
 *  3. Resolves calls into "function -> function" edges by name:
 *     local file function -> method of the same class (this.x) -> imported name.
 *  4. Writes graph.json (nodes = functions grouped by file; edges = calls).
 *
 * Non-relative imports resolve via nearest package.json `"imports"` (`#…`),
 * tsconfig `paths`, and workspace package names (emit dirs in `"imports"`
 * targets are remapped to source).
 *
 * Usage:  tsx parse.ts [--root DIR] [--out FILE] [--include-tests]
 */

import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

interface Args {
  root: string;
  out: string;
  includeTests: boolean;
}

/**
 * Parses CLI arguments into a normalized {@link Args} object.
 * Why: gives the CLI stable defaults (cwd as root, the standalone server's
 * graph.json path as output) so it can run with no flags.
 */
function parseArgs(argv: string[]): Args {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args: Args = {
    root: process.cwd(),
    // by default we drop the graph where the standalone server serves it from
    out: path.join(here, "..", "..", "dist", "webview", "graph.json"),
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
// Filesystem walk
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

/**
 * Reports whether a filename is a parseable TypeScript source file.
 * Why: declaration files (.d.ts) carry no call information, so they're excluded.
 */
function isTsFile(name: string): boolean {
  if (name.endsWith(".d.ts")) return false;
  return name.endsWith(".ts") || name.endsWith(".tsx");
}

/**
 * Collects all .ts/.tsx files under `root`, skipping build/vendor directories.
 * Why: an iterative stack walk avoids recursion limits and lets us prune whole
 * subtrees (SKIP_DIRS, codegraph's own dir) cheaply.
 *
 * `onDir`, when supplied, is called with each directory path immediately before
 * it is `readdir`-ed. Since that syscall is the one that can trip a macOS TCC
 * prompt, the last reported directory pinpoints the offending path at runtime.
 * Only symlinked or genuine sub-directories are descended (`dirent.isDirectory()`
 * is false for symlinks), so the walk never follows a symlink out of `root`.
 */
function walk(
  root: string,
  selfDir: string,
  includeTests: boolean,
  onDir?: (dir: string) => void,
): string[] {
  const files: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    onDir?.(dir);
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
        if (full === selfDir) continue; // don't parse codegraph itself
        stack.push(full);
      } else if (e.isFile() && isTsFile(e.name)) {
        if (!includeTests && /\.(test|spec)\.(ts|tsx)$/.test(e.name)) continue;
        files.push(full);
      }
      // Note: entries whose type is UNKNOWN (some network/FUSE filesystems report
      // DT_UNKNOWN) satisfy neither branch and are simply skipped — there is no
      // fs.statSync fallback, so the walk can only ever *under*-read such an
      // entry, never follow it out of `root`.
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Graph model
// ---------------------------------------------------------------------------

interface FnNode {
  id: string; // relPath#Name
  name: string; // Name (may be Class.method)
  file: string; // relPath
  kind: "function" | "arrow" | "method" | "module";
  line: number;
}

// label for a module-level top-level node (code outside functions)
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

/**
 * A single import binding, keyed in {@link FileFacts.imports} by its LOCAL name.
 * `imported` carries the ORIGINAL exported name so aliases (`import { a as b }`)
 * resolve against `a`, not the local `b`. `namespace` is `import * as ns` (and
 * `const ns = await import(...)`); `default` is `import Foo from '...'`.
 */
type ImportBinding =
  | { kind: "named"; spec: string; imported: string }
  | { kind: "default"; spec: string }
  | { kind: "namespace"; spec: string };

/** Sentinel export name meaning "the module's default export". */
const DEFAULT_IMPORT = "\u0000default";

// Intermediate facts gathered for a single file
interface FileFacts {
  relPath: string;
  sf: ts.SourceFile;
  // local name -> import binding (only specifiers resolvable to source matter)
  imports: Map<string, ImportBinding>;
  // top-level function/const name -> nodeId
  localFns: Map<string, string>;
  // "Class.method" -> nodeId, and bare "method" -> nodeId (for this.x)
  methods: Map<string, string>;
  // re-exports: exportedName -> { spec, orig } for `export { a as b } from './x'`
  reexports: Map<string, { spec: string; orig: string }>;
  // `export * from './x'` — list of specifiers
  wildcards: string[];
  // local symbol name that this module exports as `default`, if statically known
  defaultExportName?: string;
  // variable name -> class name from `const x = new Foo(...)` (instance heuristic)
  instanceVars: Map<string, string>;
  // className -> (fieldName -> typeName) for DI: constructor(private svc: Svc) / private svc: Svc
  classFields: Map<string, Map<string, string>>;
  // functions (and the module pseudo-node) with AST body nodes, for the second pass
  fnBodies: Array<{
    node: FnNode;
    body: ts.Node;
    className?: string;
    isModule?: boolean;
    scan?: ts.Node[]; // for the module — list of top-level expressions
  }>;
}

// ---------------------------------------------------------------------------
// Parsing a single file (first pass: declarations and imports)
// ---------------------------------------------------------------------------

/**
 * Maps a filename to the TypeScript ScriptKind (TSX for .tsx, TS otherwise).
 * Why: the scanner needs the right kind to parse JSX syntax correctly.
 */
function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Returns the 1-based source line of a node.
 * Why: node metadata stores line numbers so the viewer can show fn locations.
 */
function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Reports whether a node is any function-like construct.
 * Why: shared predicate for detecting arrow/expression/declaration functions.
 */
function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

/**
 * Reports whether a declaration carries the `default` modifier
 * (`export default class C {}` / `export default function f() {}`).
 * Why: default-exported declarations still have a local name we can resolve
 * members against, recorded as {@link FileFacts.defaultExportName}.
 */
function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods && mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/**
 * If `expr` is a dynamic import call `import('spec')` (optionally `await`-ed),
 * returns its string specifier. Why: `const { X } = await import('./m')` and
 * `const ns = await import('./m')` bind module symbols the same way static
 * imports do, so they must feed the same resolution.
 */
function dynamicImportSpec(expr: ts.Expression): string | undefined {
  let e: ts.Expression = expr;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (
    ts.isCallExpression(e) &&
    e.expression.kind === ts.SyntaxKind.ImportKeyword &&
    e.arguments.length === 1 &&
    ts.isStringLiteral(e.arguments[0]!)
  ) {
    return (e.arguments[0] as ts.StringLiteral).text;
  }
  return undefined;
}

/** Extracts a type name from a TypeNode: Svc, Svc<T> → Svc, ns.Svc → Svc. */
function typeNameOf(tn: ts.TypeNode | undefined): string | undefined {
  if (!tn) return undefined;
  if (ts.isTypeReferenceNode(tn)) {
    const n = tn.typeName;
    if (ts.isIdentifier(n)) return n.text;
    if (ts.isQualifiedName(n)) return n.right.text;
  }
  return undefined;
}

/**
 * Gets (creating if needed) the field-type map for a class.
 * Why: DI resolution records `field -> typeName` per class; this keeps that
 * lazy-initialized without scattering existence checks at call sites.
 */
function ensureClassFields(facts: FileFacts, className: string): Map<string, string> {
  let m = facts.classFields.get(className);
  if (!m) {
    m = new Map();
    facts.classFields.set(className, m);
  }
  return m;
}

/**
 * First pass over one source file: records declarations, imports, re-exports,
 * class members, DI field types and instance variables into {@link FileFacts}.
 * Why: gathering these facts up front lets the second pass resolve calls to
 * concrete node ids without re-walking the AST for every lookup.
 */
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
    // -- imports --------------------------------------------------------
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const clause = stmt.importClause;
      if (clause.name) {
        // import Foo from '...'  (default import)
        facts.imports.set(clause.name.text, { kind: "default", spec });
      }
      const named = clause.namedBindings;
      if (named) {
        if (ts.isNamedImports(named)) {
          // import { a, b as c } from '...'  — record the original export name
          for (const el of named.elements) {
            const imported = el.propertyName ? el.propertyName.text : el.name.text;
            facts.imports.set(el.name.text, { kind: "named", spec, imported });
          }
        } else if (ts.isNamespaceImport(named)) {
          // import * as ns from '...'  (glob/namespace import)
          facts.imports.set(named.name.text, { kind: "namespace", spec });
        }
      }
      continue;
    }

    // -- export default Ident / export default class|function -----------
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) facts.defaultExportName = stmt.expression.text;
      continue;
    }

    // -- re-exports: export { a as b } from './x'  /  export * from './x' ----
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
      if (hasDefaultModifier(stmt)) facts.defaultExportName = name;
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
      if (hasDefaultModifier(stmt)) facts.defaultExportName = className;
      const fields = ensureClassFields(facts, className);
      for (const member of stmt.members) {
        // constructor: collect parameter properties + body
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
          // short name -> id (to resolve this.x); on collision keep the first
          if (!facts.methods.has(mName)) facts.methods.set(mName, id);
          facts.fnBodies.push({ node: fn, body: member.body, className });
          continue;
        }
        // typed field: private svc: SvcType;  (+ optionally an arrow)
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

  // -- instance heuristic + dynamic imports (across the whole file) ---------
  // Dynamic imports live inside function bodies, so scan the whole tree (not just
  // top-level statements) and fold their bindings into the file-scoped maps.
  const collectInstances = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      // const x = new Foo(...)
      if (
        ts.isIdentifier(node.name) &&
        ts.isNewExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression)
      ) {
        facts.instanceVars.set(node.name.text, node.initializer.expression.text);
      }
      // const { A, B as C } = await import('spec')  /  const ns = await import('spec')
      const dyn = dynamicImportSpec(node.initializer);
      if (dyn) {
        if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue; // skip nested/rest patterns
            const local = el.name.text;
            const imported =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : local;
            facts.imports.set(local, { kind: "named", spec: dyn, imported });
          }
        } else if (ts.isIdentifier(node.name)) {
          facts.imports.set(node.name.text, { kind: "namespace", spec: dyn });
        }
      }
    }
    ts.forEachChild(node, collectInstances);
  };
  collectInstances(sf);

  // -- module top-level code (outside functions/classes) -------------------
  const moduleScan: ts.Node[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue;
    if (ts.isExportDeclaration(stmt)) continue; // re-exports / type exports
    if (ts.isFunctionDeclaration(stmt)) continue; // its own node
    if (ts.isClassDeclaration(stmt)) continue; // methods are separate nodes
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
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) continue; // separate nodes
        moduleScan.push(init);
      }
      continue;
    }
    moduleScan.push(stmt); // expressions, if/for/try/switch/throw, export default expr, etc.
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
// Resolve module specifier -> relPath
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Non-relative resolution context (tsconfig paths, package.json imports,
// workspace packages)
// ---------------------------------------------------------------------------

/** Emit dirs the walker skips; stripped from package.json `"imports"` targets. */
const EMIT_DIR_NAMES = new Set(["build", "dist", "out"]);

/** A tsconfig `paths` / package.json `"imports"` rule, targets as abs templates. */
interface AliasRule {
  prefix: string; // "@/*" -> "@/" ; "@app" (no wildcard) -> "@app"
  wildcard: boolean; // key ended with "/*"
  targets: string[]; // absolute path templates; wildcard "*" preserved
}

/** A workspace package discovered from a package.json `name`. */
interface PackageInfo {
  dir: string; // absolute package directory
}

/** `#` import rules owned by one package.json directory. */
interface PackageImports {
  dir: string; // absolute package directory
  rules: AliasRule[];
}

/**
 * Everything {@link resolveModule} needs to resolve non-relative specifiers:
 * nearest-package `imports`, tsconfig `paths`/`baseUrl`, and workspace package
 * names. Built once per {@link buildGraph} so per-call filesystem scans are not
 * repeated.
 */
interface ResolverContext {
  aliases: AliasRule[];
  packages: Map<string, PackageInfo>;
  /** Package dirs with `#` imports, longest path first (nearest match wins). */
  packageImportsByDir: PackageImports[];
}

/**
 * Expands a path base (no extension) into the candidate on-disk source files:
 * ESM/NodeNext `.js`→`.ts`, bare `.ts`/`.tsx`, and `index.ts(x)` for directories.
 * Why: import specifiers never name the real `.ts`/`.tsx` file, so every
 * resolution strategy funnels through the same candidate list.
 */
function expandCandidates(base: string): string[] {
  const candidates: string[] = [];
  const jsExt = base.match(/\.(js|jsx|mjs|cjs)$/);
  if (jsExt) {
    const noExt = base.slice(0, -jsExt[0].length);
    candidates.push(noExt + ".ts", noExt + ".tsx");
  }
  candidates.push(base + ".ts", base + ".tsx");
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));
  candidates.push(base); // in case the path already points at an existing file
  return candidates;
}

/**
 * Maps a bare specifier onto candidate source bases inside a workspace package.
 * Why: monorepo packages import each other by name (`@scope/pkg`,
 * `@scope/pkg/sub`); their published `main`/`exports` point at built `dist`, so
 * we resolve to source by trying `<pkg>/src/<sub>` and `<pkg>/<sub>` (and
 * `index` for a bare name). Longest matching package name wins.
 */
function packageCandidates(spec: string, packages: Map<string, PackageInfo>): string[] {
  let bestName: string | undefined;
  let bestDir: string | undefined;
  for (const [name, info] of packages) {
    if ((spec === name || spec.startsWith(name + "/")) && (!bestName || name.length > bestName.length)) {
      bestName = name;
      bestDir = info.dir;
    }
  }
  if (!bestName || !bestDir) return [];
  const sub = spec === bestName ? "" : spec.slice(bestName.length + 1);
  if (sub) return [path.join(bestDir, "src", sub), path.join(bestDir, sub)];
  return [path.join(bestDir, "src", "index"), path.join(bestDir, "index"), path.join(bestDir, "src")];
}

/**
 * Removes the first path segment named `build`/`dist`/`out` from an absolute
 * base. Why: package.json `"imports"` often point at compiled output that the
 * walker skips; mapping that emit path back to source keeps `#` aliases usable.
 */
function stripEmitSegment(absBase: string): string | undefined {
  const normalized = path.normalize(absBase);
  const sep = path.sep;
  for (const name of EMIT_DIR_NAMES) {
    const mid = sep + name + sep;
    const at = normalized.indexOf(mid);
    if (at >= 0) {
      return path.normalize(normalized.slice(0, at) + sep + normalized.slice(at + mid.length));
    }
    const tail = sep + name;
    if (normalized.endsWith(tail)) {
      return path.normalize(normalized.slice(0, -tail.length));
    }
  }
  return undefined;
}

/**
 * Expands each base via {@link expandCandidates} and returns the first path in
 * `fileSet`. When `stripEmit` is set, also retries after {@link stripEmitSegment}
 * (package.json `"imports"` → source under skipped emit dirs).
 */
function matchBasesInFileSet(
  bases: string[],
  root: string,
  fileSet: Set<string>,
  stripEmit: boolean,
): string | undefined {
  for (const base of bases) {
    const tries = [base];
    if (stripEmit) {
      const stripped = stripEmitSegment(base);
      if (stripped && stripped !== base) tries.push(stripped);
    }
    for (const tryBase of tries) {
      for (const abs of expandCandidates(tryBase)) {
        const rel = toPosix(path.relative(root, abs));
        if (fileSet.has(rel)) return rel;
      }
    }
  }
  return undefined;
}

/**
 * Returns `#` import rules from the nearest enclosing package.json for `fromRel`.
 * Why: Node resolves `"imports"` relative to the package that owns the importer,
 * not a merged global map (monorepos may reuse `#lib` in multiple packages).
 */
function nearestPackageImports(fromRel: string, root: string, ctx: ResolverContext): AliasRule[] {
  const fromDir = path.normalize(path.dirname(path.join(root, fromRel)));
  for (const { dir, rules } of ctx.packageImportsByDir) {
    if (fromDir === dir || fromDir.startsWith(dir + path.sep)) return rules;
  }
  return [];
}

/**
 * Resolves a module specifier to a repo-relative source path.
 * Relative specifiers resolve against the importer's directory; non-relative
 * ones try (1) nearest package.json `"imports"`, (2) tsconfig path aliases,
 * (3) workspace packages (external npm packages stay unresolved). Every base is
 * expanded via {@link expandCandidates} and checked against the known file set.
 * `"imports"` targets under emit dirs (`build`/`dist`/`out`) are remapped to
 * source when the emit path is not in the file set.
 */
function resolveModule(
  fromRel: string,
  spec: string,
  root: string,
  fileSet: Set<string>,
  ctx: ResolverContext,
): string | undefined {
  if (spec.startsWith(".")) {
    const fromAbsDir = path.dirname(path.join(root, fromRel));
    const bases = [path.normalize(path.join(fromAbsDir, spec))];
    return matchBasesInFileSet(bases, root, fileSet, false);
  }

  const importBases = aliasCandidates(spec, nearestPackageImports(fromRel, root, ctx));
  const fromImports = matchBasesInFileSet(importBases, root, fileSet, true);
  if (fromImports) return fromImports;

  const bases = [...aliasCandidates(spec, ctx.aliases), ...packageCandidates(spec, ctx.packages)];
  if (bases.length === 0 && importBases.length === 0) return undefined; // external npm
  return matchBasesInFileSet(bases, root, fileSet, false);
}

/**
 * Normalizes an OS path to forward-slash (POSIX) form.
 * Why: node ids and the file set use forward slashes for cross-platform stability.
 */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Building the resolver context (config scans, done once per buildGraph)
// ---------------------------------------------------------------------------

/**
 * Collects files named `matcher` anywhere under `root`, pruning {@link SKIP_DIRS}.
 * Why: both tsconfig and package.json discovery need the same bounded walk, and
 * a shared helper keeps the pruning rules in one place.
 */
function findConfigFiles(root: string, matches: (name: string) => boolean): string[] {
  const found: string[] = [];
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
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile() && matches(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  }
  return found;
}

/** Narrows an unknown to a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strips JSONC comments and trailing commas with a character scanner that
 * respects string literals (so `//` or `/*` inside a string is preserved).
 * Why: a regex approach can misfire on escaped quotes; a small state machine is
 * robust for the tsconfig files we read.
 */
function stripJsonc(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Parses JSONC (JSON with comments and trailing commas, as tsconfig allows),
 * tolerating malformed files by returning `undefined`.
 */
function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text));
  } catch {
    return undefined;
  }
}

/** Resolves a tsconfig `extends` value (relative/absolute) to an existing file. */
function resolveExtendsPath(fromDir: string, spec: string): string | undefined {
  if (typeof spec !== "string" || !spec) return undefined;
  const relative = spec.startsWith("./") || spec.startsWith("../");
  if (!relative && !path.isAbsolute(spec)) return undefined; // bare node-module extends: skip
  const base = relative ? path.resolve(fromDir, spec) : spec;
  const candidates = base.endsWith(".json") ? [base] : [base, base + ".json"];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

interface ResolvedTsconfig {
  baseDir: string;
  paths: Record<string, string[]> | undefined;
}

/**
 * Reads one tsconfig, merging inherited `extends` first, then its own
 * `baseUrl`/`paths`. Why: `paths` are relative to `baseUrl` (or the declaring
 * file's dir), and a child overrides an inherited base; `chain` guards cycles.
 */
function readTsconfig(file: string, chain: Set<string>): ResolvedTsconfig | undefined {
  const resolved = path.resolve(file);
  if (chain.has(resolved)) return undefined;
  chain.add(resolved);

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    return undefined;
  }
  const json = parseJsonc(raw);
  if (!isRecord(json)) return undefined;

  const dir = path.dirname(resolved);
  let baseDir = dir;
  let paths: Record<string, string[]> | undefined;

  const extendsField = json.extends;
  const extendList = Array.isArray(extendsField)
    ? extendsField
    : typeof extendsField === "string"
      ? [extendsField]
      : [];
  for (const ext of extendList) {
    if (typeof ext !== "string") continue;
    const parentFile = resolveExtendsPath(dir, ext);
    if (!parentFile) continue;
    const parent = readTsconfig(parentFile, chain);
    if (!parent) continue;
    baseDir = parent.baseDir;
    if (parent.paths) paths = parent.paths;
  }

  const compilerOptions = isRecord(json.compilerOptions) ? json.compilerOptions : undefined;
  if (compilerOptions) {
    if (typeof compilerOptions.baseUrl === "string") {
      baseDir = path.resolve(dir, compilerOptions.baseUrl);
    }
    if (isRecord(compilerOptions.paths)) {
      const next: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(compilerOptions.paths)) {
        if (Array.isArray(value)) next[key] = value.filter((t): t is string => typeof t === "string");
      }
      paths = next;
    }
  }

  return { baseDir, paths };
}

/** Turns a resolved tsconfig `paths` map into {@link AliasRule}s. */
function rulesFromPaths(baseDir: string, pathsMap: Record<string, string[]>): AliasRule[] {
  const rules: AliasRule[] = [];
  for (const [key, rawTargets] of Object.entries(pathsMap)) {
    if (!key || !Array.isArray(rawTargets)) continue;
    const wildcard = key.endsWith("/*");
    const prefix = wildcard ? key.slice(0, -1) : key; // "@/*" -> "@/"
    const targets: string[] = [];
    for (const t of rawTargets) {
      if (typeof t !== "string" || !t) continue;
      targets.push(path.normalize(path.resolve(baseDir, t))); // keeps a trailing "*" literal
    }
    if (targets.length) rules.push({ prefix, wildcard, targets });
  }
  return rules;
}

/**
 * Scans every `tsconfig*.json` under `root`, follows `extends`, and flattens
 * their `compilerOptions.paths` (resolved against `baseUrl`) into
 * {@link AliasRule}s. Why: projects import by path alias (`@/x` → `./src/x`),
 * often declared in an extended base config; rules are deduped across files.
 */
function loadTsconfigAliases(root: string): AliasRule[] {
  const merged: AliasRule[] = [];
  const seen = new Set<string>();
  for (const file of findConfigFiles(root, (n) => /^tsconfig.*\.json$/i.test(n))) {
    try {
      const loaded = readTsconfig(file, new Set());
      if (!loaded?.paths) continue;
      for (const rule of rulesFromPaths(loaded.baseDir, loaded.paths)) {
        const sig = JSON.stringify([rule.prefix, rule.wildcard, rule.targets]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        merged.push(rule);
      }
    } catch {
      /* skip this tsconfig */
    }
  }
  return merged;
}

/**
 * Substitutes matching {@link AliasRule}s to yield absolute path bases (no
 * extension) for a bare specifier. Wildcard rules splice the post-prefix
 * remainder into each target's `*`; exact rules require an equal specifier.
 * Why: turns `@/a/b` into `<root>/src/a/b` for {@link expandCandidates}.
 */
function aliasCandidates(spec: string, rules: AliasRule[]): string[] {
  if (!spec || spec.startsWith(".") || spec.startsWith("/")) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    let mapped: string[] | undefined;
    if (rule.wildcard) {
      if (!spec.startsWith(rule.prefix)) continue;
      const rest = spec.slice(rule.prefix.length);
      mapped = rule.targets.map((t) => (t.includes("*") ? t.replace("*", rest) : t));
    } else if (spec === rule.prefix) {
      mapped = rule.targets;
    }
    if (!mapped) continue;
    for (const m of mapped) {
      const abs = path.normalize(m);
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

/**
 * Discovers workspace packages and Node `#` subpath imports from every
 * package.json under `root`. Why: monorepo imports use package names, and many
 * projects (NodeNext) map `#methods` → built output only in `"imports"`, with
 * no tsconfig `paths`. Imports stay keyed by package directory so resolution
 * uses the nearest enclosing package.json (Node semantics).
 */
function loadPackageJsonContext(root: string): {
  packages: Map<string, PackageInfo>;
  packageImportsByDir: PackageImports[];
} {
  const packages = new Map<string, PackageInfo>();
  const packageImportsByDir: PackageImports[] = [];
  for (const file of findConfigFiles(root, (n) => n === "package.json")) {
    const json = parseJsonc(fs.readFileSync(file, "utf8").toString());
    if (!isRecord(json)) continue;
    const dir = path.dirname(file);
    const name = json.name;
    if (typeof name === "string" && name && !packages.has(name)) {
      packages.set(name, { dir });
    }
    if (isRecord(json.imports)) {
      const rules = rulesFromPackageImports(dir, json.imports);
      if (rules.length) packageImportsByDir.push({ dir, rules });
    }
  }
  // Longest directory first so the nearest enclosing package wins.
  packageImportsByDir.sort((a, b) => b.dir.length - a.dir.length);
  return { packages, packageImportsByDir };
}

/**
 * Collects string path leaves from a package.json `"imports"` value (string,
 * array, or nested condition object). Why: conditional exports nest under
 * `types`/`import`/`default`/…; we try every leaf until one hits the file set.
 */
function collectImportTargets(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) out.push(...collectImportTargets(item));
    return out;
  }
  if (!isRecord(value)) return [];
  const out: string[] = [];
  const preferred = ["types", "import", "default", "require", "node"];
  const seen = new Set<string>();
  for (const key of preferred) {
    if (!(key in value)) continue;
    seen.add(key);
    out.push(...collectImportTargets(value[key]));
  }
  for (const [key, nested] of Object.entries(value)) {
    if (seen.has(key)) continue;
    out.push(...collectImportTargets(nested));
  }
  return out;
}

/**
 * Turns a package.json `"imports"` map into {@link AliasRule}s for `#` keys only.
 * Targets resolve against the package directory (Node semantics).
 */
function rulesFromPackageImports(pkgDir: string, importsMap: Record<string, unknown>): AliasRule[] {
  const rules: AliasRule[] = [];
  for (const [key, value] of Object.entries(importsMap)) {
    if (!key.startsWith("#")) continue;
    const wildcard = key.endsWith("/*");
    const prefix = wildcard ? key.slice(0, -1) : key; // "#mod/*" -> "#mod/"
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const t of collectImportTargets(value)) {
      const abs = path.normalize(path.resolve(pkgDir, t));
      if (seen.has(abs)) continue;
      seen.add(abs);
      targets.push(abs);
    }
    if (targets.length) rules.push({ prefix, wildcard, targets });
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Second pass: extracting calls -> edges
// ---------------------------------------------------------------------------

/**
 * Walks every function body of a file and records call/new expressions as edges.
 * Why: the second pass needs the first-pass facts of all files to resolve a call
 * target to a concrete node id; edges are deduped via `edgeSet`.
 */
function extractCalls(
  facts: FileFacts,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  ctx: ResolverContext,
  edgeSet: Set<string>,
  edges: Edge[],
): void {
  for (const entry of facts.fnBodies) {
    const fn = entry.node;
    const className = entry.className;
    const targets = new Set<string>();

    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const target = resolveCallee(n.expression, facts, className, root, fileSet, factsByRel, ctx, false);
        if (target && target !== fn.id) targets.add(target);
      } else if (ts.isNewExpression(n)) {
        // new X() -> constructor of class X
        const target = resolveCallee(n.expression, facts, className, root, fileSet, factsByRel, ctx, true);
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

/**
 * Finds the definition of an exported symbol in a file, following re-exports
 * (`export { a as b } from './x'` and `export * from './x'`).
 *  - method === null  -> free function named `name`;
 *  - method !== null  -> class method `${name}.${method}` (incl. 'constructor').
 * Why: barrel files re-export symbols, so a call target may live several hops
 * away; `seen` guards against cyclic re-export chains.
 */
function resolveExport(
  rel: string,
  name: string,
  method: string | null,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  ctx: ResolverContext,
  seen: Set<string>,
): string | undefined {
  const key = rel + "|" + name + "|" + (method ?? "\u0000fn");
  if (seen.has(key)) return undefined;
  seen.add(key);

  const tf = factsByRel.get(rel);
  if (!tf) return undefined;

  // default export: resolve the module's `default` to a concrete symbol, then
  // continue as if it were named that (following `export { X as default } from`).
  if (name === DEFAULT_IMPORT) {
    if (tf.defaultExportName) {
      const r = resolveExport(rel, tf.defaultExportName, method, root, fileSet, factsByRel, ctx, seen);
      if (r) return r;
    }
    const red = tf.reexports.get("default");
    if (red) {
      const nr = resolveModule(rel, red.spec, root, fileSet, ctx);
      if (nr) {
        const orig = red.orig === "default" ? DEFAULT_IMPORT : red.orig;
        const r = resolveExport(nr, orig, method, root, fileSet, factsByRel, ctx, seen);
        if (r) return r;
      }
    }
    return undefined;
  }

  // direct definition in this file
  if (method !== null) {
    const q = `${name}.${method}`;
    if (tf.methods.has(q)) return tf.methods.get(q);
  } else {
    if (tf.localFns.has(name)) return tf.localFns.get(name);
  }

  // named re-export
  const re = tf.reexports.get(name);
  if (re) {
    const nr = resolveModule(rel, re.spec, root, fileSet, ctx);
    if (nr) {
      const orig = re.orig === "default" ? DEFAULT_IMPORT : re.orig;
      const r = resolveExport(nr, orig, method, root, fileSet, factsByRel, ctx, seen);
      if (r) return r;
    }
  }

  // export * from './x'
  for (const spec of tf.wildcards) {
    const nr = resolveModule(rel, spec, root, fileSet, ctx);
    if (nr) {
      const r = resolveExport(nr, name, method, root, fileSet, factsByRel, ctx, seen);
      if (r) return r;
    }
  }

  return undefined;
}

/**
 * Resolves a callee expression to a target node id.
 * Handles bare identifiers (local/imported functions, `new Foo()`), `this.method()`,
 * DI via `this.field.method()`, local/imported instances and static calls.
 * Why: this is the heart of edge resolution — it maps syntactic calls onto the
 * concrete functions declared elsewhere in the graph, using first-pass facts.
 */
function resolveCallee(
  expr: ts.Expression,
  facts: FileFacts,
  className: string | undefined,
  root: string,
  fileSet: Set<string>,
  factsByRel: Map<string, FileFacts>,
  ctx: ResolverContext,
  isNew: boolean,
): string | undefined {
  // The export name to look up in the target for a non-namespace binding:
  // the original name for `named`, the module's default for `default`.
  const exportNameOf = (b: ImportBinding): string =>
    b.kind === "default" ? DEFAULT_IMPORT : b.kind === "named" ? b.imported : "";

  // Resolve a `symbol` (or its `.member`) exported by whatever module `b` points at.
  const viaImport = (b: ImportBinding, symbol: string, member: string | null): string | undefined => {
    const targetRel = resolveModule(facts.relPath, b.spec, root, fileSet, ctx);
    if (!targetRel) return undefined;
    return resolveExport(targetRel, symbol, member, root, fileSet, factsByRel, ctx, new Set());
  };

  // foo()  or  new Foo()
  if (ts.isIdentifier(expr)) {
    const name = expr.text;

    if (isNew) {
      // new Foo() -> Foo.constructor (local or from an import, following re-exports)
      const q = `${name}.constructor`;
      if (facts.methods.has(q)) return facts.methods.get(q);
      const b = facts.imports.get(name);
      if (b && b.kind !== "namespace") return viaImport(b, exportNameOf(b), "constructor");
      return undefined;
    }

    // 1) local file function
    if (facts.localFns.has(name)) return facts.localFns.get(name);
    // 2) imported name (following re-exports through barrels)
    const b = facts.imports.get(name);
    if (b && b.kind !== "namespace") return viaImport(b, exportNameOf(b), null);
    return undefined;
  }

  // this.method() / this.field.method() / obj.method() / ns.foo()
  if (ts.isPropertyAccessExpression(expr)) {
    const propName = expr.name.text;
    const obj = expr.expression;

    // this.method() -> method of the same class
    if (obj.kind === ts.SyntaxKind.ThisKeyword && className) {
      const qualified = `${className}.${propName}`;
      if (facts.methods.has(qualified)) return facts.methods.get(qualified);
      return undefined;
    }

    // this.field.method() — DI via constructor / typed field
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
        const cb = facts.imports.get(typeName);
        if (cb && cb.kind !== "namespace") {
          const r = viaImport(cb, exportNameOf(cb), propName);
          if (r) return r;
        }
      }
      return undefined;
    }

    if (ts.isIdentifier(obj)) {
      const objName = obj.text;

      // 1) local instance: const x = new Foo(); x.method()
      const localCls = facts.instanceVars.get(objName);
      if (localCls) {
        const lq = `${localCls}.${propName}`;
        if (facts.methods.has(lq)) return facts.methods.get(lq); // class in this same file
        const cb = facts.imports.get(localCls); // class is imported
        if (cb && cb.kind !== "namespace") {
          const r = viaImport(cb, exportNameOf(cb), propName);
          if (r) return r;
        }
      }

      // 2) imported name objName
      const b = facts.imports.get(objName);
      if (b) {
        if (b.kind === "namespace") {
          // ns.foo() -> free fn/const foo of the module; new ns.Foo() -> Foo.constructor
          const r = viaImport(b, propName, isNew ? "constructor" : null);
          if (r) return r;
        } else {
          const symbol = exportNameOf(b);
          // 2a) static/namespace: objName is a class, method objName.propName
          const r1 = viaImport(b, symbol, propName);
          if (r1) return r1;
          const targetRel = resolveModule(facts.relPath, b.spec, root, fileSet, ctx);
          const tf = targetRel ? factsByRel.get(targetRel) : undefined;
          // 2b) imported instance: objName = new Cls() in the target module
          const instCls = tf?.instanceVars.get(objName);
          if (instCls && targetRel) {
            const r2 = resolveExport(targetRel, instCls, propName, root, fileSet, factsByRel, ctx, new Set());
            if (r2) return r2;
          }
          // 2c) free function propName in the target module (namespace-like default import)
          if (tf?.localFns.has(propName)) return tf.localFns.get(propName);
        }
      }

      // 3) local class: Foo.method() (static)
      const localQ = `${objName}.${propName}`;
      if (facts.methods.has(localQ)) return facts.methods.get(localQ);
    }
    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Graph construction (shared by the CLI and the rebuild server)
// ---------------------------------------------------------------------------

/**
 * Coarse parse progress, reported so a caller can tell "slow" from "hung".
 *  - `discover`: the file walk finished; `files` is the total to parse.
 *  - `parse`: first-pass progress; `parsed` of `files` source files read.
 * Counts only — it never changes the resulting graph.
 */
export interface ParseProgress {
  phase: "discover" | "parse";
  files: number;
  parsed?: number;
}

export interface BuildOptions {
  includeTests?: boolean;
  /** codegraph's own directory, so we don't parse its own files */
  selfDir?: string;
  /**
   * Optional coarse progress callback (see {@link ParseProgress}). Throttled by
   * the caller-agnostic emitter below; when omitted the parse has no overhead.
   */
  onProgress?: (p: ParseProgress) => void;
  /**
   * Optional per-path diagnostic hook: `dir` before each directory is read,
   * `file` before each source file is read. Off the hot path when omitted; used
   * by the extension to trace which exact path a parse touches (e.g. to pinpoint
   * a macOS TCC prompt). Callers are responsible for throttling/capping output.
   */
  onDebug?: (kind: "dir" | "file", path: string) => void;
}

/**
 * Builds the full call graph for a project root: walks files, runs the two
 * passes, prunes dangling edges and empty module pseudo-nodes.
 * Why: this is the single entry point reused by the CLI, the standalone server
 * and the VS Code extension so every runtime produces an identical graph.
 */
export function buildGraph(root: string, opts: BuildOptions = {}): Graph {
  const includeTests = opts.includeTests ?? false;
  const selfDir = opts.selfDir ?? path.dirname(fileURLToPath(import.meta.url));

  const onDebug = opts.onDebug;
  const absFiles = walk(root, selfDir, includeTests, onDebug && ((dir) => onDebug("dir", dir)));
  const relFiles = absFiles.map((f) => toPosix(path.relative(root, f)));
  const fileSet = new Set(relFiles);

  // Report the discovered total once, then throttle first-pass progress so the
  // callback fires at most every ~100 files or ~100ms — negligible overhead and
  // no per-file spam. Emitting only happens when a caller wants progress.
  const report = opts.onProgress;
  report?.({ phase: "discover", files: absFiles.length });
  let sinceReport = 0;
  let lastReportAt = Date.now();

  // First pass
  const factsByRel = new Map<string, FileFacts>();
  const nodes: FnNode[] = [];
  const files: FileEntry[] = [];

  for (let i = 0; i < absFiles.length; i++) {
    const abs = absFiles[i]!;
    const rel = relFiles[i]!;
    let text: string;
    onDebug?.("file", abs);
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

    if (report && (++sinceReport >= 100 || Date.now() - lastReportAt >= 100)) {
      report({ phase: "parse", files: absFiles.length, parsed: i + 1 });
      sinceReport = 0;
      lastReportAt = Date.now();
    }
  }

  // Second pass: calls. Build the non-relative resolver context once (tsconfig
  // path aliases + package.json `#` imports + workspace package names) and
  // reuse it for every file.
  const pkgCtx = loadPackageJsonContext(root);
  const ctx: ResolverContext = {
    aliases: loadTsconfigAliases(root),
    packages: pkgCtx.packages,
    packageImportsByDir: pkgCtx.packageImportsByDir,
  };
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const facts of factsByRel.values()) {
    extractCalls(facts, root, fileSet, factsByRel, ctx, edgeSet, edges);
  }
  // drop edges pointing at non-existent nodes (just in case)
  const cleanEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  // drop empty module pseudo-nodes with no connection (no top-level calls)
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

/**
 * CLI entry point: builds the graph from parsed args and writes graph.json.
 * Why: keeps the executable behavior separate from {@link buildGraph} so the
 * latter stays importable without side effects.
 */
function main(): void {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const graph = buildGraph(args.root, { includeTests: args.includeTests, selfDir });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(graph));
  const ms = Date.now() - t0;
  console.log(
    `codegraph: ${graph.stats.files} files with functions, ` +
      `${graph.stats.nodes} nodes, ${graph.stats.edges} edges in ${ms}ms`,
  );
  console.log(`graph.json -> ${args.out}`);
}

// Run main only when this module is the CLI entry, never when imported (serve.ts,
// the extension) or bundled into the parse worker. The worker imports buildGraph,
// and esbuild's banner rewrites import.meta.url to the bundle path while a worker
// thread's process.argv[1] resolves to that same file — so the "invoked directly"
// check alone misfires there and would run the CLI (walking process.cwd()) at load,
// blocking the worker before it handles a parse request. Requiring the main thread
// closes that hole: worker threads never auto-run main.
try {
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const metaUrl = typeof import.meta !== "undefined" && import.meta.url ? import.meta.url : "";
  if (isMainThread && metaUrl && invokedPath) {
    const thisFile = fileURLToPath(metaUrl);
    if (invokedPath === thisFile || invokedPath === path.resolve(thisFile)) {
      main();
    }
  }
} catch {
  /* bundled CJS without import.meta — don't run the CLI */
}
