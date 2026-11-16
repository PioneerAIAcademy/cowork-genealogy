// Owed findings (docs/plan/conclusion-tree.md Decision 33) over the shared
// vectors in docs/specs/schemas/owed-findings-vectors.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { owedFindings } from "../../src/utils/owed-findings.js";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "owed-findings-vectors.json"), "utf-8"),
);

describe("owed findings vectors", () => {
  it.each(vectors.cases.map((c: any) => [c.name, c]))("%s", (_name, c: any) => {
    const got = owedFindings(c.research, c.tree);
    expect(got).toHaveLength(c.expect.length);
    c.expect.forEach((want: any, i: number) => expect(got[i]).toMatchObject(want));
  });
});
