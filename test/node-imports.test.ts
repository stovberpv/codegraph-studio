import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildGraph } from "../src/core/parse.ts";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "node-imports",
);

describe("package.json imports resolution", () => {
  it("links #methods through emit path + barrel export * chain", () => {
    const graph = buildGraph(fixtureRoot, { selfDir: path.join(fixtureRoot, "..") });
    const edge = graph.edges.find(
      (e) =>
        e.from === "src/callers/app.ts#handle" &&
        e.to === "src/methods/skillaz/common.ts#uploadFolder",
    );
    assert.ok(edge, "expected handle → uploadFolder via #methods barrels");
  });

  it("resolves wildcard #mod/* with conditional import targets", () => {
    const graph = buildGraph(fixtureRoot, { selfDir: path.join(fixtureRoot, "..") });
    const edge = graph.edges.find(
      (e) =>
        e.from === "src/callers/app.ts#handle" && e.to === "src/mod/alpha/index.ts#alphaPing",
    );
    assert.ok(edge, "expected handle → alphaPing via #mod/alpha");
  });
});
