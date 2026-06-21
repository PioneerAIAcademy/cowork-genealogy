import { describe, it, expect } from "vitest";
import {
  compatibleDate,
  compatiblePlace,
  getEarliest,
  getLatest,
  getPersonEventDayRanges,
  hasConflictingDates,
  hasOverlappingDates,
  sameYear,
} from "../../src/utils/date-comparison.js";
import { BIRTHLIKE_FACT_TYPES, DEATHLIKE_FACT_TYPES } from "../../src/utils/mob.js";
import type { SimplifiedPerson } from "../../src/types/gedcomx.js";

function person(
  id: string,
  facts: Array<{ id?: string; type: string; date: string; standard_date?: string }>,
): SimplifiedPerson {
  return {
    id,
    facts: facts.map((f) => ({
      id: f.id ?? `F-${f.type}-${f.date}`,
      type: f.type,
      date: f.date,
      standard_date: f.standard_date ?? f.date,
    })),
  };
}

describe("getEarliest / getLatest", () => {
  it("returns null on an empty list", () => {
    expect(getEarliest([])).toBeNull();
    expect(getLatest([])).toBeNull();
  });

  it("returns min and max of mixed values", () => {
    expect(getEarliest([5, 1, 9, 3])).toBe(1);
    expect(getLatest([5, 1, 9, 3])).toBe(9);
  });
});

describe("getPersonEventDayRanges", () => {
  it("returns empty when the person has no matching facts", () => {
    const p = person("I1", [{ type: "Death", date: "1900", standard_date: "1900" }]);
    expect(
      getPersonEventDayRanges(p, BIRTHLIKE_FACT_TYPES, null, false, 0),
    ).toEqual([]);
  });

  it("returns two values per fact (min + max of the day range)", () => {
    const p = person("I1", [
      { type: "Birth", date: "1850", standard_date: "1850" },
    ]);
    const ranges = getPersonEventDayRanges(p, BIRTHLIKE_FACT_TYPES, null, false, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBeLessThan(ranges[1]); // min < max for year-only
  });

  it("respects onlyPerfect: year-only date is excluded when onlyPerfect=true", () => {
    const p = person("I1", [
      { type: "Birth", date: "1850", standard_date: "1850" }, // year only
    ]);
    expect(
      getPersonEventDayRanges(p, BIRTHLIKE_FACT_TYPES, null, true, 0),
    ).toEqual([]);
  });

  it("includes a perfect (DMY) date even when onlyPerfect=true", () => {
    const p = person("I1", [
      { type: "Birth", date: "15 Jun 1850", standard_date: "15 Jun 1850" },
    ]);
    const ranges = getPersonEventDayRanges(p, BIRTHLIKE_FACT_TYPES, null, true, 0);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toBe(ranges[1]); // min === max for perfect
  });
});

describe("sameYear", () => {
  it("returns true for matching years (both year-only)", () => {
    expect(sameYear("1850", "1850")).toBe(true);
  });

  it("returns true across precision levels (year-only vs DMY)", () => {
    expect(sameYear("1850", "15 Jun 1850")).toBe(true);
  });

  it("returns false for different years", () => {
    expect(sameYear("1850", "1851")).toBe(false);
  });

  it("returns false when either input is null", () => {
    expect(sameYear(null, "1850")).toBe(false);
    expect(sameYear("1850", null)).toBe(false);
  });
});

describe("compatibleDate", () => {
  it("returns true for identical dates", () => {
    expect(compatibleDate("15 Jun 1850", "15 Jun 1850")).toBe(true);
  });

  it("returns true for two year-only dates in same year (ranges overlap)", () => {
    expect(compatibleDate("1850", "1850")).toBe(true);
  });

  it("returns true when a year-only date overlaps a DMY date in that year", () => {
    expect(compatibleDate("1850", "15 Jun 1850")).toBe(true);
  });

  it("returns true within the fudge window for adjacent years", () => {
    // 365-day fudge means "1850" and "1851" can overlap.
    expect(compatibleDate("1850", "1851")).toBe(true);
  });

  it("returns false for clearly-separated dates", () => {
    expect(compatibleDate("1850", "1900")).toBe(false);
  });
});

describe("hasConflictingDates", () => {
  it("returns false for two persons with identical Birth dates", () => {
    const p1 = person("I1", [{ type: "Birth", date: "1850", standard_date: "1850" }]);
    const p2 = person("I2", [{ type: "Birth", date: "1850", standard_date: "1850" }]);
    expect(hasConflictingDates(p1, p2)).toBe(false);
  });

  it("returns true when exact Birth days are > 30 days apart", () => {
    const p1 = person("I1", [
      { type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" },
    ]);
    const p2 = person("I2", [
      { type: "Birth", date: "1 Jun 1850", standard_date: "1 Jun 1850" },
    ]);
    expect(hasConflictingDates(p1, p2)).toBe(true);
  });

  it("returns true when birthlike windows don't overlap (clearly different years)", () => {
    const p1 = person("I1", [{ type: "Birth", date: "1840", standard_date: "1840" }]);
    const p2 = person("I2", [{ type: "Birth", date: "1860", standard_date: "1860" }]);
    expect(hasConflictingDates(p1, p2)).toBe(true);
  });

  it("returns true when exact Death days are > 30 days apart", () => {
    const p1 = person("I1", [
      { type: "Death", date: "1 Jan 1900", standard_date: "1 Jan 1900" },
    ]);
    const p2 = person("I2", [
      { type: "Death", date: "1 Jun 1900", standard_date: "1 Jun 1900" },
    ]);
    expect(hasConflictingDates(p1, p2)).toBe(true);
  });
});

describe("hasOverlappingDates", () => {
  it("returns true when births are 1–6 months apart (suggests two distinct people)", () => {
    const p1 = person("I1", [
      { type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" },
    ]);
    const p2 = person("I2", [
      { type: "Birth", date: "1 Mar 1850", standard_date: "1 Mar 1850" },
    ]);
    expect(hasOverlappingDates(p1, p2)).toBe(true);
  });

  it("returns false for two persons with the same exact Birth date", () => {
    const p1 = person("I1", [
      { type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" },
    ]);
    const p2 = person("I2", [
      { type: "Birth", date: "1 Jan 1850", standard_date: "1 Jan 1850" },
    ]);
    expect(hasOverlappingDates(p1, p2)).toBe(false);
  });

  it("returns false when one person has no recorded dates", () => {
    const p1 = person("I1", [{ type: "Birth", date: "1850", standard_date: "1850" }]);
    const p2 = person("I2", []);
    expect(hasOverlappingDates(p1, p2)).toBe(false);
  });
});

describe("compatiblePlace", () => {
  it("returns true for identical places", () => {
    expect(compatiblePlace("Ireland", "Ireland")).toBe(true);
  });

  it("returns true when one is a less-specific prefix of the other", () => {
    expect(compatiblePlace("Ireland", "County Cork, Ireland")).toBe(true);
    expect(compatiblePlace("County Cork, Ireland", "Ireland")).toBe(true);
  });

  it("returns false when the country level disagrees", () => {
    expect(compatiblePlace("Pennsylvania, USA", "County Cork, Ireland")).toBe(false);
  });

  it("returns false when either input is empty/undefined", () => {
    expect(compatiblePlace(undefined, "Ireland")).toBe(false);
    expect(compatiblePlace("Ireland", undefined)).toBe(false);
    expect(compatiblePlace("", "Ireland")).toBe(false);
  });

  it("is case-insensitive (normalization)", () => {
    expect(compatiblePlace("IRELAND", "ireland")).toBe(true);
  });

  it("agrees on the shared levels even when one digs deeper", () => {
    // Both share "USA" + "Pennsylvania"; one adds a county.
    expect(compatiblePlace("Pennsylvania, USA", "Schuylkill, Pennsylvania, USA")).toBe(true);
  });
});
