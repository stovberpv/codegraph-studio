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

const selfDir = path.join(fixtureRoot, "..");

describe("package.json imports resolution", () => {
  it("links #methods through emit path + barrel export * chain", () => {
    const graph = buildGraph(fixtureRoot, { selfDir });
    const edge = graph.edges.find(
      (e) =>
        e.kind === "call" &&
        e.from === "src/callers/app.ts#handle" &&
        e.to === "src/methods/skillaz/common.ts#uploadFolder",
    );
    assert.ok(edge, "expected handle → uploadFolder via #methods barrels");
  });

  it("resolves wildcard #mod/* with conditional import targets", () => {
    const graph = buildGraph(fixtureRoot, { selfDir });
    const edge = graph.edges.find(
      (e) =>
        e.kind === "call" &&
        e.from === "src/callers/app.ts#handle" &&
        e.to === "src/mod/alpha/index.ts#alphaPing",
    );
    assert.ok(edge, "expected handle → alphaPing via #mod/alpha");
  });
});

describe("import dependency edges", () => {
  it("follows import-then-re-export barrels to the defining file", () => {
    const graph = buildGraph(fixtureRoot, { selfDir });
    const edge = graph.edges.find(
      (e) =>
        e.kind === "import" &&
        e.from === "src/repo/repo.ts#«module»" &&
        e.to === "src/models/Offer.ts#«module»",
    );
    assert.ok(edge, "expected repo → Offer.ts via #models local re-export");
    const toIndex = graph.edges.find(
      (e) =>
        e.kind === "import" &&
        e.from === "src/repo/repo.ts#«module»" &&
        e.to === "src/models/index.ts#«module»",
    );
    assert.equal(toIndex, undefined, "import edge should not stop at the barrel");
  });

  it("does not emit import edges for import type", () => {
    const graph = buildGraph(fixtureRoot, { selfDir });
    // Only one value import from #models in repo.ts; type-only must not add extras.
    const fromRepo = graph.edges.filter(
      (e) => e.kind === "import" && e.from === "src/repo/repo.ts#«module»",
    );
    assert.equal(fromRepo.length, 1);
    assert.equal(fromRepo[0]!.to, "src/models/Offer.ts#«module»");
  });
});
