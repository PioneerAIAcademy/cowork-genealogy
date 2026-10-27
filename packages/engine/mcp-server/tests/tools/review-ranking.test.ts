import { describe, it, expect } from "vitest";
import { rankForReview } from "../../src/utils/review-ranking.js";

// Phase 3 item 4, the highest-value item: "the viewer shows current state and never
// what this session changed... the live run wrote 311 links and its own narration
// said assertions should be reviewed for cleanup, a review nobody can do. One click
// per link is not the problem; FINDING THE ONES THAT MATTER is."
//
// Measured on the captured run's 191 links: 39 carry a core identifier conflict,
// 55 are speculative, and match_score is present on 163 and absent on 28. The
// ranking uses exactly the fields person_evidence already stores.

const link = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "pe_001", assertion_id: "a_001", person_id: "I1",
  confidence: "probable", match_score: 0.8, ...over
});

describe("rankForReview", () => {
  it("treats an EMPTY conflict description as no conflict", () => {
    const out = rankForReview([
      link({ id: "pe_blank", core_identifier_conflict: "   " }),
      link({ id: "pe_spec", confidence: "speculative" })
    ]);
    expect(out[0].id).toBe("pe_spec");
  });

  it("still honours a bare boolean, which older data may carry", () => {
    const out = rankForReview([link({ id: "pe_a" }), link({ id: "pe_bool", core_identifier_conflict: true })]);
    expect(out[0].id).toBe("pe_bool");
  });

  it("puts a core identifier conflict above everything else", () => {
    const out = rankForReview([
      link({ id: "pe_clean", confidence: "speculative", match_score: 0.1 }),
      link({ id: "pe_conflict", confidence: "confident", match_score: 0.99, core_identifier_conflict: "Birth year: census states 1853; tree attests ~1840" })
    ]);
    expect(out[0].id).toBe("pe_conflict");
    expect(out[0].reasons).toContain("core identifier conflict");
  });

  it("ranks a weaker claim above a stronger one, all else equal", () => {
    const out = rankForReview([
      link({ id: "pe_conf", confidence: "confident" }),
      link({ id: "pe_spec", confidence: "speculative" }),
      link({ id: "pe_prob", confidence: "probable" })
    ]);
    expect(out.map((l) => l.id)).toEqual(["pe_spec", "pe_prob", "pe_conf"]);
  });

  it("ranks a low match score above a high one", () => {
    const out = rankForReview([
      link({ id: "pe_high", match_score: 0.95 }),
      link({ id: "pe_low", match_score: 0.2 })
    ]);
    expect(out[0].id).toBe("pe_low");
  });

  it("does not treat a MISSING match score as a score of zero", () => {
    // 28 of the captured run's 191 links have none. Reading absent as 0 would put
    // every one of them at the top and bury the 39 real conflicts.
    const out = rankForReview([
      link({ id: "pe_none", match_score: undefined }),
      link({ id: "pe_zero", match_score: 0 })
    ]);
    expect(out[0].id).toBe("pe_zero");
  });

  it("sinks a superseded link — it has already been replaced", () => {
    const out = rankForReview([
      link({ id: "pe_super", confidence: "speculative", core_identifier_conflict: "Birth year: census states 1853; tree attests ~1840", superseded_by: "pe_009" }),
      link({ id: "pe_live", confidence: "confident", match_score: 0.99 })
    ]);
    expect(out[out.length - 1].id).toBe("pe_super");
  });

  it("says WHY each link is where it is", () => {
    const [top] = rankForReview([link({ confidence: "speculative", match_score: 0.1 })]);
    expect(top.reasons.length).toBeGreaterThan(0);
  });

  it("keeps every link — a review that silently drops rows is worse than none", () => {
    const many = Array.from({ length: 191 }, (_, i) => link({ id: `pe_${i}` }));
    expect(rankForReview(many)).toHaveLength(191);
  });

  it("is stable for equal links, so the list does not reshuffle between renders", () => {
    const a = link({ id: "pe_a" });
    const b = link({ id: "pe_b" });
    expect(rankForReview([a, b]).map((l) => l.id)).toEqual(["pe_a", "pe_b"]);
  });

  it("never throws on a malformed link", () => {
    expect(() => rankForReview([{} as never, { confidence: 5 } as never])).not.toThrow();
  });
});

// --- The ranking, through the real query tool ---------------------------------------
//
// should-fix 14 of the #3262 self-review: this module was marked BUILT and imported by
// nothing but this file. Ranking that no caller applies orders nothing.

import { researchQuery, researchQuerySchema } from "../../src/tools/research-query.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function project(personEvidence: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "rank-"));
  mkdirSync(join(dir, "results"), { recursive: true });
  writeFileSync(join(dir, "research.json"), JSON.stringify({
    project: { id: "rp_t", status: "active" },
    questions: [], plans: [], plan_items: [], log: [], sources: [], assertions: [],
    person_evidence: personEvidence,
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [],
    evaluations: [], localities: [],
  }), "utf8");
  writeFileSync(join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [{ id: "I1" }], relationships: [], sources: [] }), "utf8");
  return dir;
}

describe("research_query orders person_evidence by consequence", () => {
  // Insertion order puts the safe link first; ranking must not.
  const LINKS = [
    { id: "pe_001", assertion_id: "a_1", person_id: "I1", confidence: "confident", match_score: 0.95 },
    { id: "pe_002", assertion_id: "a_2", person_id: "I1", confidence: "speculative", match_score: 0.2,
      core_identifier_conflict: "Birth year: census states 1853; tree attests ~1840" },
  ];

  it("puts the consequential link first, ahead of insertion order", async () => {
    const r = await researchQuery({ projectPath: project(LINKS), section: "person_evidence", orderBy: "review" } as never) as any;
    expect(r.ok).toBe(true);
    expect(r.items.map((i: any) => i.id)).toEqual(["pe_002", "pe_001"]);
  });

  it("says WHY, because a rank with no reason is a number to distrust", async () => {
    const r = await researchQuery({ projectPath: project(LINKS), section: "person_evidence", orderBy: "review" } as never) as any;
    expect(r.reviewReasons?.pe_002).toContain("core identifier conflict");
  });

  it("carries no reasons key when nothing stands out", async () => {
    const plain = [{ id: "pe_001", assertion_id: "a_1", person_id: "I1",
                     confidence: "confident", match_score: 0.95 }];
    const r = await researchQuery({ projectPath: project(plain), section: "person_evidence", orderBy: "review" } as never) as any;
    expect(r.reviewReasons).toBeUndefined();
  });

  it("does NOT reorder without orderBy — the default is what replays depend on", async () => {
    // `research_query`'s default order is what every committed run replays against.
    // Reordering by default rewrote the recorded truth of 9 replay groups and
    // `test_the_real_engine_collapses_plural_walks` caught it, which is why this is
    // opt-in rather than always-on.
    const r = await researchQuery({ projectPath: project(LINKS), section: "person_evidence" } as never) as any;
    expect(r.items.map((i: any) => i.id)).toEqual(["pe_001", "pe_002"]);
    expect(r.reviewReasons).toBeUndefined();
  });

  it("leaves other sections in their own order", async () => {
    // The ranking is person_evidence's; applying it elsewhere would reorder sections
    // whose order is meaningful (a plan's items are sequenced).
    const r = await researchQuery({ projectPath: project(LINKS), section: "assertions" } as never) as any;
    expect(r.ok).toBe(true);
    expect(r.reviewReasons).toBeUndefined();
  });
});


describe("research_query advertises orderBy", () => {
  it("lists it in the input schema the description tells callers to use", () => {
    // The description says to pass orderBy; a caller that reads only the schema would
    // never find it.
    expect((researchQuerySchema.inputSchema.properties as Record<string, unknown>).orderBy)
      .toEqual(expect.objectContaining({ type: "string", enum: ["review"] }));
  });
});
