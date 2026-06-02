import { describe, it, expect } from "vitest";

import {
  getPersonName,
  earliestYearOf,
  latestYearOf,
  isBefore,
  checkDeathBeforeBirth,
  checkFatherTooYoung,
  checkEventAfterDeath,
} from "../../src/tools/person-warnings.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../../src/types/gedcomx.js";

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

// ────────────────────────────────────────────────────────────────────
// Block B: end-to-end warning checks (W1, W2, W3, control)
// Mirrors the personal/warnings-demo fixture so the check logic itself
// has CI coverage rather than living only in the manual demo.
// ────────────────────────────────────────────────────────────────────

describe("checkDeathBeforeBirth (W1)", () => {
  it("fires when the anchor's death is clearly before their birth", () => {
    const anchor: SimplifiedPerson = {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "Walter", surname: "TimeTraveler" }],
      facts: [
        { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
        { id: "F2", type: "Death", date: "1840", standard_date: "1840" },
      ],
    };
    const warning = checkDeathBeforeBirth(anchor);
    expect(warning).not.toBeNull();
    expect(warning?.issueType).toBe("IMPOSSIBLE_EVENT_ORDER");
    expect(warning?.severity).toBe("error");
    expect(warning?.personId).toBe("I1");
    expect(warning?.message).toBe("The death happened before the birth.");
    expect(warning?.factIds).toEqual(["F1", "F2"]);
  });

  it("returns null when birth and death are in a sensible order", () => {
    const anchor: SimplifiedPerson = {
      id: "I5",
      gender: "Male",
      names: [{ id: "N5", given: "Henry", surname: "Normal" }],
      facts: [
        { id: "F8", type: "Birth", date: "1860", standard_date: "1860" },
        { id: "F9", type: "Death", date: "1925", standard_date: "1925" },
      ],
    };
    expect(checkDeathBeforeBirth(anchor)).toBeNull();
  });

  it("returns null when birth or death is missing", () => {
    const anchor: SimplifiedPerson = {
      id: "I2",
      gender: "Male",
      names: [{ id: "N2", given: "John", surname: "OnlyBirth" }],
      facts: [{ id: "F3", type: "Birth", date: "1820", standard_date: "1820" }],
    };
    expect(checkDeathBeforeBirth(anchor)).toBeNull();
  });
});

describe("checkFatherTooYoung (W2)", () => {
  // Same shape as personal/warnings-demo: parent I2 (1820) → child I3 (1828) ⇒ age 8.
  const tree: SimplifiedGedcomX = {
    persons: [
      {
        id: "I2",
        gender: "Male",
        names: [{ id: "N2", given: "John", surname: "YoungParent" }],
        facts: [{ id: "F3", type: "Birth", date: "1820", standard_date: "1820" }],
      },
      {
        id: "I3",
        gender: "Female",
        names: [{ id: "N3", given: "Sarah", surname: "YoungParent" }],
        facts: [{ id: "F4", type: "Birth", date: "1828", standard_date: "1828" }],
      },
    ],
    relationships: [
      { id: "R1", type: "ParentChild", parent: "I2", child: "I3" },
    ],
  };

  it("fires when anchoring on the child (one-hop relative is too young at child's birth)", () => {
    const child = tree.persons![1];
    const warnings = checkFatherTooYoung(child, tree);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].issueType).toBe("YOUNG_BIRTH");
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].personId).toBe("I3");
    expect(warnings[0].relatedPersonId).toBe("I2");
    expect(warnings[0].message).toContain("John YoungParent would have been 8");
    expect(warnings[0].factIds).toEqual(["F3", "F4"]);
  });

  it("fires when anchoring on the parent too (relationship-symmetric)", () => {
    const parent = tree.persons![0];
    const warnings = checkFatherTooYoung(parent, tree);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].personId).toBe("I3");
    expect(warnings[0].relatedPersonId).toBe("I2");
  });

  it("does not fire when the (male) parent was old enough", () => {
    const cleanTree: SimplifiedGedcomX = {
      persons: [
        {
          id: "P1",
          gender: "Male",
          names: [{ id: "N", given: "Old", surname: "Enough" }],
          facts: [{ id: "F1", type: "Birth", date: "1800", standard_date: "1800" }],
        },
        {
          id: "C1",
          gender: "Female",
          names: [{ id: "N", given: "Reasonable", surname: "Child" }],
          facts: [{ id: "F2", type: "Birth", date: "1830", standard_date: "1830" }],
        },
      ],
      relationships: [{ id: "R", type: "ParentChild", parent: "P1", child: "C1" }],
    };
    expect(checkFatherTooYoung(cleanTree.persons![1], cleanTree)).toEqual([]);
  });

  it("does not fire when the parent is female (impl is male-only per spec)", () => {
    const femaleParentTree: SimplifiedGedcomX = {
      persons: [
        {
          id: "P1",
          gender: "Female",
          names: [{ id: "N", given: "Young", surname: "Mother" }],
          facts: [{ id: "F1", type: "Birth", date: "1820", standard_date: "1820" }],
        },
        {
          id: "C1",
          gender: "Male",
          names: [{ id: "N", given: "The", surname: "Child" }],
          facts: [{ id: "F2", type: "Birth", date: "1828", standard_date: "1828" }],
        },
      ],
      relationships: [{ id: "R", type: "ParentChild", parent: "P1", child: "C1" }],
    };
    expect(checkFatherTooYoung(femaleParentTree.persons![1], femaleParentTree)).toEqual([]);
  });
});

describe("checkEventAfterDeath (W3)", () => {
  it("fires when a Census fact is dated after the anchor's Death", () => {
    const anchor: SimplifiedPerson = {
      id: "I4",
      gender: "Female",
      names: [{ id: "N4", given: "Mary", surname: "PosthumousCensus" }],
      facts: [
        { id: "F5", type: "Birth", date: "1830", standard_date: "1830" },
        { id: "F6", type: "Death", date: "1900", standard_date: "1900" },
        { id: "F7", type: "Census", date: "1910", standard_date: "1910", place: "Boston" },
      ],
    };
    const warnings = checkEventAfterDeath(anchor);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].issueType).toBe("IMPOSSIBLE_EVENT_ORDER");
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].personId).toBe("I4");
    expect(warnings[0].message).toBe("The death happened before a census.");
    expect(warnings[0].factIds).toEqual(["F6", "F7"]);
  });

  it("returns an empty array when no event is dated after death", () => {
    const anchor: SimplifiedPerson = {
      id: "I5",
      gender: "Male",
      names: [{ id: "N5", given: "Henry", surname: "Normal" }],
      facts: [
        { id: "F8", type: "Birth", date: "1860", standard_date: "1860" },
        { id: "F9", type: "Death", date: "1925", standard_date: "1925" },
      ],
    };
    expect(checkEventAfterDeath(anchor)).toEqual([]);
  });
});
