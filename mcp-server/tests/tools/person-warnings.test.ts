import { describe, it, expect } from "vitest";

import {
  getPersonName,
  earliestYearOf,
  latestYearOf,
  isBefore,
} from "../../src/tools/person-warnings.js";
import type { SimplifiedPerson } from "../../src/types/gedcomx.js";

// ────────────────────────────────────────────────────────────────────
// Block A: helpers
// ────────────────────────────────────────────────────────────────────

describe("getPersonName", () => {
  it("returns the preferred name when one is marked preferred", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [
        { id: "N1", given: "Patrick", surname: "Flynn" },
        { id: "N2", preferred: true, given: "Pat", surname: "Flynn" },
      ],
    };
    expect(getPersonName(person)).toBe("Pat Flynn");
  });

  it("falls back to the first name when no name is preferred", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [
        { id: "N1", given: "Patrick", surname: "Flynn" },
        { id: "N2", given: "Pat", surname: "Flynn" },
      ],
    };
    expect(getPersonName(person)).toBe("Patrick Flynn");
  });

  it("returns 'Unknown (id)' when the person has no names", () => {
    const person: SimplifiedPerson = { id: "I1", names: [] };
    expect(getPersonName(person)).toBe("Unknown (I1)");
  });

  it("returns surname-only when given is missing", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [{ id: "N1", preferred: true, surname: "Flynn" }],
    };
    expect(getPersonName(person)).toBe("Flynn");
  });
});

describe("earliestYearOf", () => {
  it("returns the year for a simple year string", () => {
    expect(earliestYearOf({ date: "1845" })).toBe(1845);
  });

  it("returns the start of a range", () => {
    expect(earliestYearOf({ date: "Bet 1840 and 1850" })).toBe(1840);
  });

  it("prefers fact.standard_date when present (skips fallback parsing)", () => {
    // A garbage date but a sane standard_date — should use the sidecar.
    expect(earliestYearOf({ date: "garbage", standard_date: "1845" })).toBe(1845);
  });

  it("falls back to stdDate(date) when standard_date is missing", () => {
    // "12 March 1908" is not yet canonical (full month name); fallback
    // standardizes it to "12 Mar 1908" before extracting the year.
    expect(earliestYearOf({ date: "12 March 1908" })).toBe(1908);
  });

  it("returns null for undefined input", () => {
    expect(earliestYearOf(undefined)).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(earliestYearOf({ date: "not a date at all" })).toBeNull();
  });
});

describe("latestYearOf", () => {
  it("returns the year for a simple year string", () => {
    expect(latestYearOf({ date: "1845" })).toBe(1845);
  });

  it("returns the end of a range", () => {
    expect(latestYearOf({ date: "Bet 1840 and 1850" })).toBe(1850);
  });

  it("prefers fact.standard_date when present", () => {
    expect(latestYearOf({ date: "garbage", standard_date: "Bet 1840 and 1850" })).toBe(1850);
  });

  it("returns null for undefined input", () => {
    expect(latestYearOf(undefined)).toBeNull();
  });
});

describe("isBefore", () => {
  it("returns true when A is clearly before B at year level", () => {
    expect(isBefore({ date: "1840" }, { date: "1850" })).toBe(true);
  });

  it("returns false when A is clearly after B at year level", () => {
    expect(isBefore({ date: "1850" }, { date: "1840" })).toBe(false);
  });

  it("returns true for same-year, different-month (day precision)", () => {
    // The whole point of day precision — year-only would say "same year, equal."
    expect(isBefore({ date: "May 2026" }, { date: "November 2026" })).toBe(true);
  });

  it("prefers standard_date on both sides when present", () => {
    // Both sides have junk in `date` but canonical GEDCOM forms in
    // standard_date — helpers should consume the sidecars and ignore `date`.
    expect(
      isBefore(
        { date: "junk", standard_date: "May 2026" },
        { date: "more junk", standard_date: "Nov 2026" },
      ),
    ).toBe(true);
  });

  it("returns null when ranges overlap at day level", () => {
    // Both are year-only, same year — can't tell which is earlier.
    expect(isBefore({ date: "1845" }, { date: "1845" })).toBeNull();
  });

  it("returns null when either input is undefined", () => {
    expect(isBefore(undefined, { date: "1845" })).toBeNull();
    expect(isBefore({ date: "1845" }, undefined)).toBeNull();
  });

  it("returns null when either input is unparseable", () => {
    expect(isBefore({ date: "garbage" }, { date: "1845" })).toBeNull();
  });
});
