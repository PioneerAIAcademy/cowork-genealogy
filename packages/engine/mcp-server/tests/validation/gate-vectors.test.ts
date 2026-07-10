// Engine side of the shared tree-gate vectors.
//
// docs/specs/schemas/tree-gate-vectors.json pins the agreement between the
// three tree.gedcomx.json validity gates. This suite asserts validateGedcomx
// (the tree_edit write gate) behaves exactly as each vector's `runtime`
// expectation declares; the harness's test_gate_vectors.py covers the JSON
// Schema and the fixture-gate integrity mirror against the same file. A
// validator change that shifts any verdict fails here, forcing the vectors
// (and therefore a review of the other gates) to move in the same PR.
//
// NOTE: validateGedcomx takes exactly (data, report). An earlier audit found
// that a miscalled signature reports success silently — which is why the
// battery includes a fails-everything control below.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { validateGedcomx } from "../../src/validation/validator.js";
import { createReport } from "../../src/validation/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsPath = join(
  here, "..", "..", "..", "..", "..",
  "docs", "specs", "schemas", "tree-gate-vectors.json",
);

interface GateVector {
  name: string;
  description: string;
  expect: { schema: boolean; integrity: boolean; runtime: boolean };
  tree: unknown;
}

const vectors: GateVector[] = JSON.parse(readFileSync(vectorsPath, "utf-8")).vectors;

describe("tree-gate vectors (runtime validator)", () => {
  it("the battery carries both controls", () => {
    const runtimes = vectors.map((v) => v.expect.runtime);
    expect(runtimes).toContain(true);
    expect(runtimes).toContain(false);
  });

  for (const vector of vectors) {
    it(`${vector.name}: runtime ${vector.expect.runtime ? "accepts" : "rejects"}`, () => {
      const report = createReport();
      validateGedcomx(vector.tree, report);
      expect(
        report.errors.length === 0,
        report.errors.map((e) => `${e.path}: ${e.message}`).join("\n"),
      ).toBe(vector.expect.runtime);
    });
  }
});
