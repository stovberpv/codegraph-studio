#!/usr/bin/env tsx
/**
 * Мини-статик-сервер для просмотра графа.
 * Отдаёт файлы из папки codegraph (index.html, viewer.js, styles.css, graph.json).
 * Нужен потому, что fetch('graph.json') не работает по file:// в браузере.
 *
 * Запуск:  tsx serve.ts [--port 5173]
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./parse.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// Кроссплатформенная нормализация пути к проекту (Linux/macOS/Windows).
// Снимает кавычки, раскрывает ~, приводит к абсолютному пути в стиле текущей ОС.
function normalizeRoot(input: string): string {
  let p = (input || "").trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  if (p === "~") p = os.homedir();
  else if (p.startsWith("~/") || p.startsWith("~\\")) p = path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

let port = 5173;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--port") port = Number(argv[++i]);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const method = req.method || "GET";
  const url = (req.url || "/").split("?")[0]!;

  // -- пересборка графа для указанной папки -------------------------------
  if (method === "POST" && url === "/api/rebuild") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let payload: { root?: string; includeTests?: boolean } = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        /* оставим пустым — отвалимся на проверке ниже */
      }
      const raw = typeof payload.root === "string" ? payload.root : "";
      if (!raw.trim()) {
        res.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: "укажите путь к папке проекта" }));
        return;
      }
      const root = normalizeRoot(raw);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(root);
      } catch {
        res.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: `путь не найден: ${root}` }));
        return;
      }
      if (!stat.isDirectory()) {
        res.writeHead(400, JSON_HEADERS).end(JSON.stringify({ error: `это не папка: ${root}` }));
        return;
      }
      try {
        const t0 = Date.now();
        const graph = buildGraph(root, { includeTests: !!payload.includeTests, selfDir: here });
        fs.writeFileSync(path.join(here, "graph.json"), JSON.stringify(graph));
        console.log(
          `rebuild ${root}: ${graph.stats.files} файлов, ${graph.stats.nodes} узлов, ` +
            `${graph.stats.edges} связей за ${Date.now() - t0}ms`,
        );
        res.writeHead(200, JSON_HEADERS).end(JSON.stringify(graph));
      } catch (e) {
        res.writeHead(500, JSON_HEADERS).end(JSON.stringify({ error: String((e as Error)?.message || e) }));
      }
    });
    return;
  }

  const rel = url === "/" ? "index.html" : decodeURIComponent(url.replace(/^\/+/, ""));
  // защита от выхода за пределы папки
  const abs = path.normalize(path.join(here, rel));
  if (!abs.startsWith(here)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(abs)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  const link = `http://localhost:${port}/`;
  console.log(`codegraph viewer: ${link}`);
  if (!fs.existsSync(path.join(here, "graph.json"))) {
    console.log("⚠  graph.json не найден — сначала запусти:  tsx parse.ts");
  }
  // попытка открыть браузер (macOS/Linux/Windows)
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ spawn }) => {
    try {
      spawn(opener, [link], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    } catch {
      /* не критично */
    }
  });
});
