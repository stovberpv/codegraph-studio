#!/usr/bin/env node
/**
 * Две сборки:
 *  - extension host (Node/CJS) → dist/extension.cjs
 *  - CodeMirror-оверлей (browser/IIFE) → dist/webview/editor.js
 * Плюс копирование viewer.js / styles.css в dist/webview/.
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const webviewDir = path.join(here, "dist", "webview");
fs.mkdirSync(webviewDir, { recursive: true });

function copyStatic() {
  for (const f of ["viewer.js", "styles.css"]) {
    fs.copyFileSync(path.join(here, f), path.join(webviewDir, f));
  }
}

const extensionOpts = {
  entryPoints: [path.join(here, "extension", "extension.ts")],
  bundle: true,
  outfile: path.join(here, "dist", "extension.cjs"),
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
  // shim import.meta.url для parse.ts (CLI-гард и selfDir-fallback)
  banner: {
    js: 'var import_meta_url = require("url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "import_meta_url",
  },
};

const editorOpts = {
  entryPoints: [path.join(here, "webview", "editor-overlay.js")],
  bundle: true,
  outfile: path.join(webviewDir, "editor.js"),
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
  logLevel: "info",
};

async function run() {
  copyStatic();
  if (watch) {
    const ctxExt = await esbuild.context(extensionOpts);
    const ctxEd = await esbuild.context(editorOpts);
    await Promise.all([ctxExt.watch(), ctxEd.watch()]);
    // при изменении viewer/styles — перекопировать
    for (const f of ["viewer.js", "styles.css"]) {
      fs.watch(path.join(here, f), () => {
        try {
          copyStatic();
          console.log(`copied ${f}`);
        } catch (e) {
          console.error(e);
        }
      });
    }
    console.log("watching…");
  } else {
    await Promise.all([esbuild.build(extensionOpts), esbuild.build(editorOpts)]);
    copyStatic();
    console.log("build ok");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
