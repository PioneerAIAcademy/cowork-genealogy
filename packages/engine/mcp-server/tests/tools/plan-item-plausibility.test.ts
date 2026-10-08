import { describe, it, expect } from "vitest";
import { planItemFlags } from "../../src/utils/plan-item-plausibility.js";

// Phase 3 item 5: "dead ends become next actions", and the next actions have to be
// usable. In the reported failure 2 of 8, then 1 of 3 suggestions were viable -- the
// rest "in the wrong place or years", including COUNTY records for a death in an
// independent city the locality guide had already flagged.
//
// A FLAG, never a gate. Searching a neighbouring jurisdiction can be deliberate and
// right, so this reports and the researcher decides. Repo doctrine: heuristics are
// flags, never gates.

const loc = (place: string): { place: string } => ({ place });

describe("planItemFlags — jurisdiction", () => {
  it("is quiet when the item sits inside a recorded locality", () => {
    const item = { jurisdiction: "Detroit, Wayne, Michigan, United States", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("is quiet when the item IS the recorded locality", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1880-1880" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("flags a county search when the locality is an independent city", () => {
    // The reported failure, exactly: Baltimore City is independent and belongs to no
    // county, so county records cannot hold the death.
    const item = { jurisdiction: "Baltimore County, Maryland, United States", date_range: "1908-1908" };
    const flags = planItemFlags(item, [loc("Baltimore, Maryland, United States")]);
    expect(flags.some((f) => f.kind === "jurisdiction")).toBe(true);
  });

  it("says nothing when no locality has been recorded — it cannot know", () => {
    const item = { jurisdiction: "Anywhere, Nowhere", date_range: "1880-1880" };
    expect(planItemFlags(item, [])).toEqual([]);
  });

  it("is quiet when ANY recorded locality contains the item", () => {
    const item = { jurisdiction: "Baltimore, Maryland, United States", date_range: "1908-1908" };
    const flags = planItemFlags(item, [loc("Wayne, Michigan, United States"), loc("Baltimore, Maryland, United States")]);
    expect(flags).toEqual([]);
  });
});

describe("planItemFlags — years", () => {
  it("flags a reversed range", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1920-1880" };
    const flags = planItemFlags(item, [loc("Wayne, Michigan, United States")]);
    expect(flags.some((f) => f.kind === "date_range")).toBe(true);
  });

  it("accepts a single-year range, which is how the corpus writes most of them", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "1900-1900" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("says nothing about a range it cannot parse rather than guessing", () => {
    const item = { jurisdiction: "Wayne, Michigan, United States", date_range: "c. 1880s" };
    expect(planItemFlags(item, [loc("Wayne, Michigan, United States")])).toEqual([]);
  });

  it("never throws on a malformed item", () => {
    for (const bad of [{}, { jurisdiction: 5 }, { date_range: null }] as unknown[]) {
      expect(() => planItemFlags(bad as never, [loc("X")])).not.toThrow();
    }
  });
});
