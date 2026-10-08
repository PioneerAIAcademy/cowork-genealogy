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
