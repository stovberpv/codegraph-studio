/**
 * Parse worker: runs the CPU-bound TypeScript AST walk off the extension host's
 * event loop. Why: buildGraph is synchronous and can take seconds on large
 * projects; running it here keeps the host responsive and lets the host cancel a
 * run by terminating the worker.
 *
 * Protocol: the host posts one { root, includeTests, selfDir, debug } request;
 * the worker streams zero or more { type: "progress", … } messages while parsing
 * (and, when `debug` is set, batched { type: "debug", paths } traces), then
 * replies once with { ok: true, graph } or { ok: false, error }. The host tells
 * these apart by the `type` field. Progress and debug reach the host live
 * because buildGraph runs here while the host event loop stays free — so the
 * last debug path posted before a blocking macOS TCC prompt pinpoints it.
 */
import { parentPort } from "node:worker_threads";
import { buildGraph, type ParseProgress } from "../core/parse.ts";

type ParseRequest = { root: string; includeTests?: boolean; selfDir?: string; debug?: boolean };
type ParseProgressMsg = ParseProgress & { type: "progress" };
type ParseDebugMsg = { type: "debug"; paths: string[] };
type ParseReply = { ok: true; graph: unknown } | { ok: false; error: string };

// Cap total per-path traces so a huge tree can't flood the channel; a dir event
// flushes immediately (its readdir may block on a TCC prompt), files batch.
const DEBUG_CAP = 2000;

parentPort?.on("message", (req: ParseRequest) => {
  let onDebug: ((kind: "dir" | "file", p: string) => void) | undefined;
  let flushDebug = (): void => {};
  if (req.debug) {
    let sent = 0;
    let batch: string[] = [];
    flushDebug = () => {
      if (!batch.length) return;
      parentPort?.postMessage({ type: "debug", paths: batch } satisfies ParseDebugMsg);
      batch = [];
    };
    onDebug = (kind, p) => {
      if (sent >= DEBUG_CAP) return;
      if (++sent === DEBUG_CAP) batch.push(`… (trace capped at ${DEBUG_CAP} paths)`);
      batch.push(kind === "dir" ? `dir  ${p}` : `file ${p}`);
      // Flush before the (potentially blocking) readdir, or when a batch fills.
      if (kind === "dir" || batch.length >= 64) flushDebug();
    };
  }

  let reply: ParseReply;
  try {
    const graph = buildGraph(req.root, {
      includeTests: !!req.includeTests,
      selfDir: req.selfDir,
      onProgress: (p) => parentPort?.postMessage({ type: "progress", ...p } satisfies ParseProgressMsg),
      onDebug,
    });
    reply = { ok: true, graph };
  } catch (e) {
    reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  flushDebug(); // deliver any trailing batch before the final reply
  parentPort?.postMessage(reply);
});
