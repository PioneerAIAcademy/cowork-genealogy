import { describe, it, expect } from "vitest";

import {
  getStandardDate,
  earliestDayOfSelfFacts,
  latestDayOfSelfFacts,
  earliestYearOfSelfFacts,
  latestYearOfSelfFacts,
  earliestYearOfChildFacts,
  factDaysDiffEarliestLatest,
  factDaysDiffLatestLatest,
} from "../../src/utils/fact-helpers.js";
import {
  BIRTHLIKE_FACT_TYPES,
  DEATHLIKE_FACT_TYPES,
  Mob,
} from "../../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

// ────────────────────────────────────────────────────────────────────
// getStandardDate
// ────────────────────────────────────────────────────────────────────

describe("getStandardDate", () => {
  it("prefers fact.standard_date when present", () => {
    expect(getStandardDate({ date: "garbage", standard_date: "1850" })).toBe(
      "1850",
    );
  });

  it("falls back to stdDate(fact.date) when standard_date is missing", () => {
    expect(getStandardDate({ date: "12 March 1908" })).toBe("12 Mar 1908");
  });

  it("returns null for undefined fact", () => {
    expect(getStandardDate(undefined)).toBeNull();
  });

  it("returns null for fact with no date and no standard_date", () => {
    expect(getStandardDate({ type: "Birth" })).toBeNull();
  });

  it("returns null when the date is unparseable", () => {
    expect(getStandardDate({ date: "completely garbled" })).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Self-fact aggregations on the anchor
// ────────────────────────────────────────────────────────────────────

const anchorWithBirthAndDeath: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Doe" }],
      facts: [
        // Two birth-like facts (Birth and Christening)
        { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
        {
          id: "F2",
          type: "Christening",
          date: "1851",
          standard_date: "1851",
        },
        // Death (death-like)
        { id: "F3", type: "Death", date: "1920", standard_date: "1920" },
        // Burial (also death-like — should be included in DEATHLIKE)
        { id: "F4", type: "Burial", date: "1921", standard_date: "1921" },
        // Census (not vital, not a death-like)
        { id: "F5", type: "Census", date: "1900", standard_date: "1900" },
      ],
    },
  ],
};

const anchorMob = new Mob(anchorWithBirthAndDeath, "I1");

describe("earliestYearOfSelfFacts / latestYearOfSelfFacts — anchor John Doe", () => {
  it("earliest birth-like year is 1850 (Birth, not the later Christening)", () => {
    expect(earliestYearOfSelfFacts(anchorMob, BIRTHLIKE_FACT_TYPES)).toBe(1850);
  });

  it("latest birth-like year is 1851 (Christening, not the earlier Birth)", () => {
    expect(latestYearOfSelfFacts(anchorMob, BIRTHLIKE_FACT_TYPES)).toBe(1851);
  });

  it("earliest death-like year is 1920 (Death, not the later Burial)", () => {
    expect(earliestYearOfSelfFacts(anchorMob, DEATHLIKE_FACT_TYPES)).toBe(1920);
  });

  it("latest death-like year is 1921 (Burial)", () => {
    expect(latestYearOfSelfFacts(anchorMob, DEATHLIKE_FACT_TYPES)).toBe(1921);
  });

  it("with factTypes=null, considers EVERY fact (earliest = 1850)", () => {
    expect(earliestYearOfSelfFacts(anchorMob, null)).toBe(1850);
  });

  it("with factTypes=null, considers EVERY fact (latest = 1921)", () => {
    expect(latestYearOfSelfFacts(anchorMob, null)).toBe(1921);
  });

  it("returns null when no fact matches the filter", () => {
    expect(
      earliestYearOfSelfFacts(anchorMob, new Set(["NotARealType"])),
    ).toBeNull();
  });
});

describe("earliestDayOfSelfFacts / latestDayOfSelfFacts — day-level mode", () => {
  it("earliest day across all facts comes from F1 (Birth 1850)", () => {
    const earliestDay = earliestDayOfSelfFacts(anchorMob, null);
    expect(earliestDay).not.toBeNull();
    expect(earliestDay).toBeLessThan(latestDayOfSelfFacts(anchorMob, null)!);
  });

  it("latest birth-like day is on/in 1851 (the Christening), not 1850", () => {
    const earliest = earliestDayOfSelfFacts(anchorMob, BIRTHLIKE_FACT_TYPES);
    const latest = latestDayOfSelfFacts(anchorMob, BIRTHLIKE_FACT_TYPES);
    expect(earliest).not.toBeNull();
    expect(latest).not.toBeNull();
    expect(latest!).toBeGreaterThan(earliest!);
  });

  it("returns null when no matching fact has a parseable date", () => {
    expect(
      earliestDayOfSelfFacts(anchorMob, new Set(["NotARealType"])),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// earliestYearOfChildFacts — walks across all children
// ────────────────────────────────────────────────────────────────────

const parentWithChildren: SimplifiedGedcomX = {
  persons: [
    {
      id: "P1",
      gender: "Male",
      names: [{ id: "N", given: "Parent", surname: "X" }],
      facts: [{ id: "F1", type: "Birth", date: "1800", standard_date: "1800" }],
    },
    {
      id: "C1",
      gender: "Male",
      names: [{ id: "N", given: "Older", surname: "X" }],
      facts: [{ id: "F2", type: "Birth", date: "1830", standard_date: "1830" }],
    },
    {
      id: "C2",
      gender: "Female",
      names: [{ id: "N", given: "Younger", surname: "X" }],
      facts: [
        { id: "F3", type: "Christening", date: "1825", standard_date: "1825" },
      ],
    },
  ],
  relationships: [
    { id: "R1", type: "ParentChild", parent: "P1", child: "C1" },
    { id: "R2", type: "ParentChild", parent: "P1", child: "C2" },
  ],
};

describe("earliestYearOfChildFacts — walks all children's facts", () => {
  const mob = new Mob(parentWithChildren, "P1");

  it("earliest birth-like year across all children is 1825 (C2's Christening)", () => {
    expect(earliestYearOfChildFacts(mob, BIRTHLIKE_FACT_TYPES)).toBe(1825);
  });

  it("returns null when no child has a matching dated fact", () => {
    expect(
      earliestYearOfChildFacts(mob, new Set(["NotARealType"])),
    ).toBeNull();
  });

  it("returns null for an anchor with no children", () => {
    const childlessMob = new Mob(anchorWithBirthAndDeath, "I1");
    expect(
      earliestYearOfChildFacts(childlessMob, BIRTHLIKE_FACT_TYPES),
    ).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// factDaysDiffEarliestLatest / factDaysDiffLatestLatest
// ────────────────────────────────────────────────────────────────────

describe("factDaysDiffEarliestLatest — used by W1 (hasEventBeforeBirth)", () => {
  it("returns a positive number when birth-like is later than the earliest event", () => {
    // Set 1 = any event, Set 2 = birth-like.
    // earliest any-event ≈ 1850, latest birth-like ≈ 1851 → diff ≈ ~365 days.
    const diff = factDaysDiffEarliestLatest(
      anchorMob,
      null,
      null,
      BIRTHLIKE_FACT_TYPES,
      null,
    );
    expect(diff).not.toBeNull();
    expect(diff!).toBeGreaterThan(0);
  });

  it("returns null when either side is empty", () => {
    expect(
      factDaysDiffEarliestLatest(
        anchorMob,
        new Set(["NotARealType"]),
        null,
        BIRTHLIKE_FACT_TYPES,
        null,
      ),
    ).toBeNull();
  });
});

describe("factDaysDiffLatestLatest — used by W3 (hasEventAfterDeath)", () => {
  it("returns negative or near-zero when no event is after the latest deathlike", () => {
    // Set 1 = death-like, Set 2 = any event.
    // latest deathlike = Burial (1921), latest any event = Burial (1921).
    // diff = 0 (Burial is in both sets and is the latest of each).
    const diff = factDaysDiffLatestLatest(
      anchorMob,
      DEATHLIKE_FACT_TYPES,
      null,
      null,
      null,
    );
    expect(diff).toBe(0);
  });

  it("returns null when there's no death-like fact", () => {
    const noDeath: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Living", surname: "Person" }],
          facts: [
            { id: "F1", type: "Birth", date: "1990", standard_date: "1990" },
          ],
        },
      ],
    };
    const livingMob = new Mob(noDeath, "I1");
    expect(
      factDaysDiffLatestLatest(
        livingMob,
        DEATHLIKE_FACT_TYPES,
        null,
        null,
        null,
      ),
    ).toBeNull();
  });
});
