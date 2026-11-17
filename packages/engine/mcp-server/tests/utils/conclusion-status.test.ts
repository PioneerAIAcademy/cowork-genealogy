// Conclusion status (docs/plan/conclusion-tree.md Decision 6) over the shared
// vectors in docs/specs/schemas/conclusion-status-vectors.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conclusionStatus } from "../../src/utils/conclusion-status.js";

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "conclusion-status-vectors.json"), "utf-8"),
);

describe("conclusion status vectors", () => {
  it.each<[string, any]>(vectors.cases.map((c: any) => [c.name, c]))("%s", (_name: string, c: any) => {
    const rows = conclusionStatus(c.research, c.tree, c.startingTree);
    if (c.expectRowCount !== undefined) expect(rows).toHaveLength(c.expectRowCount);
    for (const want of c.expect) {
      const row = rows.find(
        (r) => JSON.stringify(r.holder) === JSON.stringify(want.holder) && (want.factId === undefined || r.factId === want.factId),
      );
      expect(row, `no row for ${JSON.stringify(want.holder)}`).toBeDefined();
      expect(row).toMatchObject(want);
    }
  });
});
