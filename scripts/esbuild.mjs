#!/usr/bin/env node
/**
 * Project build:
 *  - precompile the canvas Pug template into a self-contained JS function
 *    (src/extension/generated/webview-template.cjs) — no runtime pug dependency;
 *  - extension host (Node/CJS) → dist/extension.cjs;
 *  - CodeMirror overlay (browser/IIFE) → dist/webview/editor.js;
 *  - canvas viewer modules (browser/IIFE) → dist/webview/viewer.js;
 *  - copy styles.css into dist/webview/;
 *  - render the standalone markup into dist/webview/index.html.
 */
import * as esbuild from "esbuild";
import pug from "pug";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { getMessages } from "../src/i18n/webview.js";

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const watch = process.argv.includes("--watch");
// Production build (npm run package): minify every bundle and skip sourcemaps.
// Why: the packaged VSIX ships the bundled TypeScript compiler in parse-worker
// (~9.5mb unminified); minifying roughly halves it. `.vscodeignore` already
// drops *.map, so prod sourcemaps would only bloat dist on disk. `legalComments:
// "eof"` keeps third-party license notices (TypeScript/CodeMirror) at the file
// end instead of dropping them.
const prod = process.argv.includes("--minify") || process.env.NODE_ENV === "production";

/** Applies the shared prod/dev knobs (minify, sourcemap, legal comments) to an esbuild config. */
function withMode(opts) {
  return {
    ...opts,
    minify: prod,
    sourcemap: prod ? false : true,
    legalComments: prod ? "eof" : "inline",
  };
}

const webviewSrc = path.join(root, "src", "webview");
const templatePath = path.join(root, "src", "extension", "templates", "webview.pug");
const generatedDir = path.join(root, "src", "extension", "generated");
const generatedTpl = path.join(generatedDir, "webview-template.cjs");
const distDir = path.join(root, "dist");
const webviewOut = path.join(distDir, "webview");

fs.mkdirSync(webviewOut, { recursive: true });
fs.mkdirSync(generatedDir, { recursive: true });

// Pug → self-contained renderWebview(locals) function (runtime is inlined).
function compileTemplate() {
  const fn = pug.compileFileClient(templatePath, {
    name: "renderWebview",
    inlineRuntimeFunctions: true,
    compileDebug: false,
  });
  fs.writeFileSync(generatedTpl, `${fn}\nmodule.exports = renderWebview;\n`);
  // Types live in the committed webview-template.d.cts (tsc must resolve the
  // import before this .cjs exists). Keep that file in sync with WebviewLocals.
}

// standalone index.html from the same template.
function renderStandalone() {
  delete require.cache[require.resolve(generatedTpl)];
  const render = require(generatedTpl);
  // no VS Code display language at build time → default to English
  const lang = "en";
  const html = render({
    standalone: true,
    csp: null,
    nonce: undefined,
    cssHref: "styles.css",
    viewerSrc: "viewer.js",
    editorSrc: null,
    t: getMessages(lang),
    lang,
  });
  fs.writeFileSync(path.join(webviewOut, "index.html"), html);
}

function copyStatic() {
  for (const f of ["styles.css"]) {
    fs.copyFileSync(path.join(webviewSrc, f), path.join(webviewOut, f));
  }
}

const extensionOpts = {
  entryPoints: [path.join(root, "src", "extension", "extension.ts")],
  bundle: true,
  outfile: path.join(distDir, "extension.cjs"),
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  logLevel: "info",
  banner: {
    js: 'var import_meta_url = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "import_meta_url",
  },
};

// parse worker (Node/CJS): the same buildGraph, run off the host event loop.
const workerOpts = {
  entryPoints: [path.join(root, "src", "extension", "parse-worker.ts")],
  bundle: true,
  outfile: path.join(distDir, "parse-worker.cjs"),
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  logLevel: "info",
  banner: {
    js: 'var import_meta_url = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "import_meta_url",
  },
};

const editorOpts = {
  entryPoints: [path.join(webviewSrc, "editor-overlay.js")],
  bundle: true,
  outfile: path.join(webviewOut, "editor.js"),
  platform: "browser",
  format: "iife",
  target: "es2020",
  logLevel: "info",
};

// canvas viewer (browser/IIFE): bundle the src/webview/viewer/ modules into the
// single nonce'd script the template loads (same artifact path as before).
const viewerOpts = {
  entryPoints: [path.join(webviewSrc, "viewer", "index.js")],
  bundle: true,
  outfile: path.join(webviewOut, "viewer.js"),
  platform: "browser",
  format: "iife",
  target: "es2020",
  logLevel: "info",
};

async function buildOnce() {
  compileTemplate();
  await Promise.all([
    esbuild.build(withMode(extensionOpts)),
    esbuild.build(withMode(workerOpts)),
    esbuild.build(withMode(editorOpts)),
    esbuild.build(withMode(viewerOpts)),
  ]);
  copyStatic();
  renderStandalone();
  console.log(prod ? "build ok (minified)" : "build ok");
}

async function run() {
  if (!watch) {
    await buildOnce();
    return;
  }
  compileTemplate();
  const ctxExt = await esbuild.context(withMode(extensionOpts));
  const ctxWorker = await esbuild.context(withMode(workerOpts));
  const ctxEd = await esbuild.context(withMode(editorOpts));
  const ctxViewer = await esbuild.context(withMode(viewerOpts));
  await Promise.all([ctxExt.watch(), ctxWorker.watch(), ctxEd.watch(), ctxViewer.watch()]);
  copyStatic();
  renderStandalone();
  // viewer.js is bundled by esbuild (watched above); only styles.css is copied.
  for (const f of [path.join(webviewSrc, "styles.css")]) {
    fs.watch(f, () => {
      try {
        copyStatic();
        console.log(`copied ${path.basename(f)}`);
      } catch (e) {
        console.error(e);
      }
    });
  }
  fs.watch(templatePath, () => {
    try {
      compileTemplate();
      renderStandalone();
      console.log("template recompiled");
    } catch (e) {
      console.error(e);
    }
  });
  console.log("watching…");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
