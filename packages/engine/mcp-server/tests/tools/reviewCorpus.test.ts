import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rankForReview } from "../../src/utils/review-ranking.js";

// Ranked over the captured run's REAL 191 links. This corpus caught the defect the
// hand-written tests could not: `core_identifier_conflict` is a descriptive STRING
// (schema: `string | null`), the invented fixtures used a boolean, and the ranking
// put all 39 conflicts LAST while every unit test passed.
const R = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "..", "..", "docs", "captures",
         "2026-09-29-mcandrew-children", "research.json"),
    "utf8"
  )
) as { person_evidence?: Array<Record<string, unknown>> };

const LINKS = R.person_evidence ?? [];

describe("review ranking over the captured links", () => {
  it("has a corpus — a zero-length scan proves nothing", () => {
    expect(LINKS.length).toBe(191);
    expect(LINKS.filter((l) => l.core_identifier_conflict).length).toBe(39);
  });

  it("puts every conflicted link in the top slice", () => {
    const ranked = rankForReview(LINKS);
    const conflicts = LINKS.filter((l) => l.core_identifier_conflict).length;
    const inTop = ranked
      .slice(0, conflicts)
      .filter((r) => r.reasons.includes("core identifier conflict")).length;
    expect(inTop).toBe(conflicts);
  });

  it("does not bury a conflict under links that merely lack a score", () => {
    const ranked = rankForReview(LINKS);
    const firstNoReason = ranked.findIndex((r) => r.reasons.length === 0);
    const lastConflict = ranked
      .map((r) => r.reasons.includes("core identifier conflict"))
      .lastIndexOf(true);
    expect(lastConflict).toBeLessThan(firstNoReason);
  });

  it("keeps all 191 — a review that silently drops rows is worse than none", () => {
    expect(rankForReview(LINKS)).toHaveLength(191);
  });
});
