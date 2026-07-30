import { describe, it, expect } from "vitest";
import { marriageJurisdictionCandidates } from "../../src/utils/marriage-jurisdictions.js";

/**
 * The rule under test, stated generally:
 *
 *   A marriage is filed where the wedding happened, not where the couple later
 *   lived. So when a marriage search is scoped to one jurisdiction, every OTHER
 *   place either spouse is known to have been is a candidate — and the EARLIEST
 *   ones matter most, because marriage precedes migration.
 *
 * This is mechanical: read both spouses' dated, placed facts off the tree, drop
 * the one already searched, order earliest-first. No genealogical judgment.
 */

/** Minimal simplified-GedcomX tree: a couple who married in A and moved to B. */
function treeMarriedInAMovedToB() {
  return {
    persons: [
      {
        id: "I1",
        names: [{ given: "James", surname: "Neal" }],
        facts: [
          { type: "Birth", date: "1857", place: "Yell, Arkansas, United States", standard_place: "Yell, Arkansas, United States" },
          { type: "Residence", date: "1880", place: "Hill, Texas, United States", standard_place: "Hill, Texas, United States" },
        ],
      },
      {
        id: "I2",
        names: [{ given: "Martha", surname: "Wood" }],
        facts: [
          { type: "Birth", date: "1855", place: "Georgia, United States", standard_place: "Georgia, United States" },
          { type: "Residence", date: "1900", place: "Hill, Texas, United States", standard_place: "Hill, Texas, United States" },
        ],
      },
    ],
    relationships: [
      {
        id: "R1",
        type: "Couple",
        person1: "I1",
        person2: "I2",
        facts: [{ type: "Marriage", date: "31 July 1879", place: "Hill, Texas, United States", standard_place: "Hill, Texas, United States" }],
      },
    ],
  };
}

describe("marriageJurisdictionCandidates", () => {
  it("surfaces the other spouse's places, not just the subject's", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", "Hill, Texas, United States");
    // Subject I2 has no Arkansas fact at all; it belongs to her husband.
    // A hint that only looked at the subject would miss it entirely.
    expect(out.map((c) => c.place)).toContain("Yell, Arkansas, United States");
  });

  it("orders earliest-first, because marriage precedes migration", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", "Hill, Texas, United States");
    const years = out.map((c) => c.earliestYear).filter((y): y is number => y !== null);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(out[0]?.earliestYear).toBe(1855);
  });

  it("excludes the jurisdiction already searched", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", "Hill, Texas, United States");
    expect(out.map((c) => c.place)).not.toContain("Hill, Texas, United States");
  });

  it("attributes each candidate to whose fact it came from", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", "Hill, Texas, United States");
    const ar = out.find((c) => c.place === "Yell, Arkansas, United States");
    expect(ar?.whose).toBe("I1");
    expect(ar?.fromFact).toBe("Birth");
  });

  it("dedupes a place both spouses share, keeping the earliest date", () => {
    const tree = treeMarriedInAMovedToB();
    const out = marriageJurisdictionCandidates(tree, "I2", "Nowhere");
    const hill = out.filter((c) => c.place === "Hill, Texas, United States");
    expect(hill).toHaveLength(1);
    expect(hill[0]?.earliestYear).toBe(1879); // couple's own marriage fact, earlier than either residence
  });

  it("returns candidates when no place was searched yet", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", undefined);
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns empty rather than throwing when the subject is absent", () => {
    expect(marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "NOPE", undefined)).toEqual([]);
  });

  it("returns empty rather than throwing on a malformed or empty tree", () => {
    expect(marriageJurisdictionCandidates({}, "I1", undefined)).toEqual([]);
    expect(marriageJurisdictionCandidates({ persons: [] }, "I1", undefined)).toEqual([]);
    expect(marriageJurisdictionCandidates(null as never, "I1", undefined)).toEqual([]);
  });

  it("ignores facts with no place, and places with no date still appear last", () => {
    const tree = {
      persons: [
        {
          id: "I1",
          facts: [
            { type: "Birth", date: "1857" }, // no place — ignored
            { type: "Residence", place: "Undated County, Texas", standard_place: "Undated County, Texas" }, // no date
            { type: "Residence", date: "1860", place: "Early County, Georgia", standard_place: "Early County, Georgia" },
          ],
        },
      ],
      relationships: [],
    };
    const out = marriageJurisdictionCandidates(tree, "I1", undefined);
    expect(out.map((c) => c.place)).toEqual(["Early County, Georgia", "Undated County, Texas"]);
  });

  it("treats the searched place case- and whitespace-insensitively", () => {
    const out = marriageJurisdictionCandidates(treeMarriedInAMovedToB(), "I2", "  hill, TEXAS, united states ");
    expect(out.map((c) => c.place)).not.toContain("Hill, Texas, United States");
  });
});
