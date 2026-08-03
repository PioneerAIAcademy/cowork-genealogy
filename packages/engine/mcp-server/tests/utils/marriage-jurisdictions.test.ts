import { describe, it, expect } from "vitest";
import { marriageJurisdictionCandidates } from "../../src/utils/marriage-jurisdictions.js";

/**
 * The rule under test, stated generally:
 *
 *   A marriage is filed where the wedding happened, not where the couple later
 *   lived. So when a marriage search is scoped to one jurisdiction, the other
 *   places these people are known to have been are candidates — ranked by how
 *   close they sit to the marriage's own date window, most-recent-before first,
 *   because the last known location before a wedding beats the oldest one.
 *
 * Ordering by *absolute earliest* instead was tried and is wrong: it ranks a
 * later spouse's childhood birthplace above the jurisdiction that actually
 * matters. See the run-5 regression test at the bottom, which is built from the
 * live search arguments and tree state that produced that failure.
 */

/** A couple who married in A and moved to B, plus a much-later third spouse. */
function tree() {
  return {
    persons: [
      {
        id: "LKYG-VKB", // subject
        names: [{ given: "Martha", surname: "Wood" }],
        facts: [
          { type: "Birth", date: "1855", place: "Georgia, United States", standard_place: "Georgia, United States" },
          { type: "Residence", date: "1860", place: "Blount, Alabama, United States", standard_place: "Blount, Alabama, United States" },
          { type: "Residence", date: "1900", place: "Justice Precinct 2, Hill, Texas, United States", standard_place: "Justice Precinct 2, Hill, Texas, United States" },
        ],
      },
      {
        id: "LH8W-LBC", // the husband whose birth state holds the answer
        names: [{ given: "James", surname: "Neal" }],
        facts: [
          { type: "Birth", date: "1857", place: "Yell, Arkansas, United States", standard_place: "Yell, Arkansas, United States" },
          { type: "Residence", date: "1860", place: "Hill, Texas, United States", standard_place: "Hill, Texas, United States" },
        ],
      },
      {
        id: "I2", // third husband, married decades later — his places are noise here
        names: [{ given: "William S", surname: "Hamby" }],
        facts: [
          { type: "Birth", date: "1847", place: "South Carolina, United States", standard_place: "South Carolina, United States" },
        ],
      },
    ],
    relationships: [
      { id: "R1", type: "Couple", person1: "LH8W-LBC", person2: "LKYG-VKB", facts: [{ type: "Marriage", date: "31 July 1879", place: "Hill, Texas, United States", standard_place: "Hill, Texas, United States" }] },
      { id: "R2", type: "Couple", person1: "I2", person2: "LKYG-VKB" },
    ],
  };
}

const WINDOW = { marriageYearFrom: 1865, marriageYearTo: 1873 };

describe("marriageJurisdictionCandidates — candidate set", () => {
  it("includes the other spouse's places, not just the subject's", () => {
    // The decisive place is often a spouse's birthplace, which the subject's
    // own facts never mention.
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW });
    expect(out.map((c) => c.place)).toContain("Yell, Arkansas, United States");
  });

  it("attributes each candidate to whose fact it came from", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW });
    const ar = out.find((c) => c.place === "Yell, Arkansas, United States");
    expect(ar?.whose).toBe("LH8W-LBC");
    expect(ar?.fromFact).toBe("Birth");
  });

  it("ignores facts carrying no place", () => {
    const t = { persons: [{ id: "I1", facts: [{ type: "Birth", date: "1857" }] }], relationships: [] };
    expect(marriageJurisdictionCandidates(t, "I1", { ...WINDOW })).toEqual([]);
  });

  it("returns empty rather than throwing on an absent subject or malformed tree", () => {
    expect(marriageJurisdictionCandidates(tree(), "NOPE", {})).toEqual([]);
    expect(marriageJurisdictionCandidates({}, "I1", {})).toEqual([]);
    expect(marriageJurisdictionCandidates({ persons: [] }, "I1", {})).toEqual([]);
    expect(marriageJurisdictionCandidates(null as never, "I1", {})).toEqual([]);
  });
});

describe("marriageJurisdictionCandidates — excluding the place already searched", () => {
  it("excludes an exactly-matching place", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW, searchedPlace: "Hill, Texas, United States" });
    expect(out.map((c) => c.place)).not.toContain("Hill, Texas, United States");
  });

  // The run-5 defect: the agent searched "Hill County, Texas" while the tree
  // stores "Hill, Texas, United States". Exact string matching let the place it
  // had just searched back into its own list of alternatives.
  it("excludes a differently-spelled form of the same jurisdiction", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW, searchedPlace: "Hill County, Texas" });
    expect(out.map((c) => c.place)).not.toContain("Hill, Texas, United States");
  });

  it("excludes a narrower tree place when a broader place was searched", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { searchedPlace: "Texas, United States" });
    expect(out.map((c) => c.place).filter((p) => p.includes("Texas"))).toEqual([]);
  });

  it("is case- and whitespace-insensitive", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW, searchedPlace: "  hill COUNTY,  texas " });
    expect(out.map((c) => c.place)).not.toContain("Hill, Texas, United States");
  });

  it("does not exclude a genuinely different place that shares a word", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { searchedPlace: "Hill County, Georgia" });
    expect(out.map((c) => c.place)).toContain("Hill, Texas, United States");
  });

  // Review defect: containment ran both ways, so a county-scoped search deleted the
  // parent state from its own candidate list. A statewide search is a DIFFERENT
  // search — it reaches the other counties — and dropping a locality level when the
  // narrow one comes back empty is the most useful broadening move there is.
  it("KEEPS a broader place when a narrower one was searched", () => {
    const t = {
      persons: [{ id: "I1", facts: [
        { type: "Residence", date: "1860", place: "Arkansas, United States", standard_place: "Arkansas, United States" },
        { type: "Birth", date: "1857", place: "Yell, Arkansas, United States", standard_place: "Yell, Arkansas, United States" },
      ] }],
      relationships: [],
    };
    const out = marriageJurisdictionCandidates(t, "I1", { searchedPlace: "Yell County, Arkansas" });
    expect(out.map((c) => c.place)).toContain("Arkansas, United States");
    expect(out.map((c) => c.place)).not.toContain("Yell, Arkansas, United States");
  });

  // Review defect: placeTokens dropped the country term, so a country-only place
  // reduced to [] and the guard let it back through as its own alternative.
  it("excludes a country-only place that was itself searched", () => {
    const t = {
      persons: [{ id: "I1", facts: [{ type: "Birth", date: "1857", place: "United States", standard_place: "United States" }] }],
      relationships: [],
    };
    expect(marriageJurisdictionCandidates(t, "I1", { searchedPlace: "United States" })).toEqual([]);
  });
});

describe("marriageJurisdictionCandidates — ranking", () => {
  it("ranks the most recent place BEFORE the marriage window first", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW, searchedPlace: "Hill County, Texas" });
    expect(out[0]?.place).toBe("Blount, Alabama, United States"); // 1860, closest before 1865
  });

  // No `searchedPlace` here on purpose: searching "Hill County, Texas" would
  // correctly suppress "Justice Precinct 2, Hill, Texas" as a sub-place of the
  // county already searched, which is asserted separately above.
  it("puts places dated AFTER the window last — they say nothing about the wedding", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW });
    const after = out.findIndex((c) => c.place === "Justice Precinct 2, Hill, Texas, United States");
    const before = out.findIndex((c) => c.place === "South Carolina, United States");
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(before);
  });

  // Review defect: undated sorted LAST, contradicting both this module's docstring
  // and the spec. An undated residence still says these people were there, which
  // beats a residence recorded thirty years after the wedding.
  it("puts undated places BETWEEN the two dated buckets", () => {
    const t = {
      persons: [{ id: "I1", facts: [
        { type: "Birth", date: "1855", place: "Georgia", standard_place: "Georgia" },
        { type: "Residence", date: "1900", place: "After County, Texas", standard_place: "After County, Texas" },
        { type: "Residence", place: "Undated County, Kentucky", standard_place: "Undated County, Kentucky" },
      ] }],
      relationships: [],
    };
    const out = marriageJurisdictionCandidates(t, "I1", { ...WINDOW });
    expect(out.map((c) => c.place)).toEqual([
      "Georgia",                    // before the window
      "Undated County, Kentucky",   // undated
      "After County, Texas",        // after the window
    ]);
  });

  // Review defect: the after-window key was MAX_SAFE_INTEGER-based, landing above
  // 2^53 where doubles are spaced 2 apart, so adjacent years collided and sorted
  // out of order (1902, 1900, 1901 came back 1900, 1902, 1901).
  it("orders the after-window bucket exactly, with no float collisions", () => {
    const t = {
      persons: [{ id: "I1", facts: [
        { type: "Residence", date: "1902", place: "A, Texas", standard_place: "A, Texas" },
        { type: "Residence", date: "1900", place: "B, Texas", standard_place: "B, Texas" },
        { type: "Residence", date: "1901", place: "C, Texas", standard_place: "C, Texas" },
      ] }],
      relationships: [],
    };
    const out = marriageJurisdictionCandidates(t, "I1", { ...WINDOW });
    expect(out.map((c) => c.earliestYear)).toEqual([1900, 1901, 1902]);
  });

  // The note promises each entry says whose fact it came from, so a shared
  // relationship fact must not be reported as the subject's own. Uses a dedicated
  // tree because in `tree()` the couple's Marriage place duplicates the husband's
  // 1860 residence, and dedupe correctly keeps the closer-dated person fact.
  it("attributes a Couple relationship fact to the pair, not to the subject", () => {
    const t = {
      persons: [
        { id: "I1", facts: [{ type: "Birth", date: "1855", place: "Georgia", standard_place: "Georgia" }] },
        { id: "I2", facts: [] },
      ],
      relationships: [
        { id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [
          { type: "Marriage", date: "1869", place: "Smith, Texas", standard_place: "Smith, Texas" },
        ] },
      ],
    };
    const out = marriageJurisdictionCandidates(t, "I1", { ...WINDOW });
    const fromCouple = out.find((c) => c.fromFact === "Marriage");
    expect(fromCouple?.place).toBe("Smith, Texas");
    expect(fromCouple?.whose).toBe("couple");
  });

  it("falls back to earliest-first when the search gives no date window", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { searchedPlace: "Hill County, Texas" });
    const years = out.map((c) => c.earliestYear).filter((y): y is number => y !== null);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it("dedupes a shared place, keeping the entry closest to the window", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", { ...WINDOW });
    expect(out.filter((c) => c.place === "Hill, Texas, United States")).toHaveLength(1);
  });

  // The regression this whole revision exists for. Built from the actual
  // arguments of the search that fired the hint in run 5, and the actual tree
  // state at that moment. Under the old absolute-earliest ordering, South
  // Carolina — the third husband's birthplace, from a marriage two decades after
  // the window being searched — came back rank 1, and the run then ran nine
  // South Carolina searches against one for Arkansas.
  it("REGRESSION run-5: a later spouse's birthplace must not outrank the relevant one", () => {
    const out = marriageJurisdictionCandidates(tree(), "LKYG-VKB", {
      marriageYearFrom: 1865,
      marriageYearTo: 1873,
      searchedPlace: "Hill County, Texas",
    });
    const places = out.map((c) => c.place);
    const arkansas = places.indexOf("Yell, Arkansas, United States");
    const southCarolina = places.indexOf("South Carolina, United States");

    expect(arkansas).toBeGreaterThanOrEqual(0);
    expect(southCarolina).toBeGreaterThan(arkansas);
    expect(places[0]).not.toBe("South Carolina, United States");
  });
});
