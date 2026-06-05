import { describe, it, expect } from "vitest";

import {
  getPersonName,
  hasEventBeforeBirth,
  earliestChildBirthToBirth,
  hasEventAfterDeath,
  hasAgeRangeGreaterThan,
  hasBurialAfterDeath,
  deathRangeGreaterThan,
  hasLateMarriage,
  hasEarlyMarriage,
  latestChildBirthToBirth,
  tooManyChildren,
  tooManyFathers,
  tooManyMothers,
  hasBlankName,
  calculateWarnings,
} from "../../src/tools/person-warnings.js";
import { Mob } from "../../src/utils/mob.js";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
} from "../../src/types/gedcomx.js";

// ────────────────────────────────────────────────────────────────────
// getPersonName
// ────────────────────────────────────────────────────────────────────

describe("getPersonName", () => {
  it("returns the preferred name when one is marked preferred", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [
        { id: "N1", given: "Patrick", surname: "Flynn" },
        { id: "N2", preferred: true, given: "Patrick", surname: "O'Flynn" },
      ],
    };
    expect(getPersonName(person)).toBe("Patrick O'Flynn");
  });

  it("falls back to the first name when no name is preferred", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [
        { id: "N1", given: "Patrick", surname: "Flynn" },
        { id: "N2", given: "Pat", surname: "Smith" },
      ],
    };
    expect(getPersonName(person)).toBe("Patrick Flynn");
  });

  it("returns 'Unknown (id)' when the person has no names", () => {
    expect(getPersonName({ id: "I1", names: [] })).toBe("Unknown (I1)");
  });

  it("returns surname-only when given is missing", () => {
    const person: SimplifiedPerson = {
      id: "I1",
      names: [{ id: "N1", surname: "Flynn" }],
    };
    expect(getPersonName(person)).toBe("Flynn");
  });
});

// ────────────────────────────────────────────────────────────────────
// hasEventBeforeBirth — Java MobWarnings.hasEventBeforeBirth(mob, days)
// ────────────────────────────────────────────────────────────────────

describe("hasEventBeforeBirth predicate", () => {
  it("fires when the gap between earliest event and latest birth-like > days", () => {
    // Walter TimeTraveler: Death 1840, Birth 1850 → 10-year gap.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          names: [{ id: "N", given: "Walter", surname: "TimeTraveler" }],
          gender: "Male",
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
            { id: "F2", type: "Death", date: "1840", standard_date: "1840" },
          ],
        },
      ],
    };
    expect(hasEventBeforeBirth(new Mob(tree, "I1"), 365 * 2)).toBe(true);
  });

  it("does NOT fire on a 6-month gap (under Java's 2-year tolerance)", () => {
    // A subtle case: this would fire under the v1 "any gap" check but
    // does NOT fire under Java's hasEventBeforeBirth365_2.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Borderline", surname: "Case" }],
          facts: [
            // Birth June 1850, Death January 1850 — 5 months apart.
            {
              id: "F1",
              type: "Birth",
              date: "1 June 1850",
              standard_date: "1 Jun 1850",
            },
            {
              id: "F2",
              type: "Death",
              date: "1 January 1850",
              standard_date: "1 Jan 1850",
            },
          ],
        },
      ],
    };
    expect(hasEventBeforeBirth(new Mob(tree, "I1"), 365 * 2)).toBe(false);
  });

  it("uses the birth-like FAMILY — fires on Christening too, not just Birth", () => {
    // Anchor has only a Christening (no Birth). With the literal-"Birth"
    // pre-Java check this would have been skipped; with the birth-like
    // family it fires when other events are >2y earlier.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Just", surname: "Christened" }],
          facts: [
            {
              id: "F1",
              type: "Christening",
              date: "1850",
              standard_date: "1850",
            },
            { id: "F2", type: "Death", date: "1840", standard_date: "1840" },
          ],
        },
      ],
    };
    expect(hasEventBeforeBirth(new Mob(tree, "I1"), 365 * 2)).toBe(true);
  });

  it("returns false when there's no birth-like or no other event", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Only", surname: "Birth" }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
          ],
        },
      ],
    };
    // Only fact is the birth itself. earliest event == latest birth, diff = 0.
    expect(hasEventBeforeBirth(new Mob(tree, "I1"), 365 * 2)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// earliestChildBirthToBirth — Java MobWarnings.earliestChildBirthToBirth
// ────────────────────────────────────────────────────────────────────

describe("earliestChildBirthToBirth predicate", () => {
  const youngParentTree: SimplifiedGedcomX = {
    persons: [
      {
        id: "P",
        gender: "Male",
        names: [{ id: "N", given: "Young", surname: "Father" }],
        facts: [
          { id: "F1", type: "Birth", date: "1820", standard_date: "1820" },
        ],
      },
      {
        id: "C",
        gender: "Female",
        names: [{ id: "N", given: "The", surname: "Child" }],
        facts: [
          { id: "F2", type: "Birth", date: "1828", standard_date: "1828" },
        ],
      },
    ],
    relationships: [{ id: "R", type: "ParentChild", parent: "P", child: "C" }],
  };

  it("fires when parent was at or under cutoff at child's birth", () => {
    // 1828 − 1820 = 8 ≤ 14 → fires.
    expect(earliestChildBirthToBirth(new Mob(youngParentTree, "P"), 14)).toBe(
      true,
    );
  });

  it("fires at exactly the cutoff (Java uses gap <= cutoff, inclusive)", () => {
    // Parent 1814, Child 1828 → gap = 14, fires inclusively.
    const exactlyFourteen: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "Edge", surname: "Case" }],
          facts: [
            { id: "F1", type: "Birth", date: "1814", standard_date: "1814" },
          ],
        },
        {
          id: "C",
          gender: "Female",
          names: [{ id: "N", given: "The", surname: "Child" }],
          facts: [
            { id: "F2", type: "Birth", date: "1828", standard_date: "1828" },
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    expect(earliestChildBirthToBirth(new Mob(exactlyFourteen, "P"), 14)).toBe(
      true,
    );
  });

  it("does not fire above cutoff", () => {
    const old: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "Old", surname: "Father" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
          ],
        },
        {
          id: "C",
          gender: "Female",
          names: [{ id: "N", given: "The", surname: "Child" }],
          facts: [
            { id: "F2", type: "Birth", date: "1828", standard_date: "1828" },
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    expect(earliestChildBirthToBirth(new Mob(old, "P"), 14)).toBe(false);
  });

  it("returns false when there are no children", () => {
    const childless: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "No", surname: "Children" }],
          facts: [
            { id: "F1", type: "Birth", date: "1820", standard_date: "1820" },
          ],
        },
      ],
    };
    expect(earliestChildBirthToBirth(new Mob(childless, "P"), 14)).toBe(false);
  });

  it("uses the birth-like FAMILY on both sides — child's Christening counts", () => {
    // Parent 1820, Child has ONLY a Christening (no Birth fact).
    const christeningOnly: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "Young", surname: "Father" }],
          facts: [
            { id: "F1", type: "Birth", date: "1820", standard_date: "1820" },
          ],
        },
        {
          id: "C",
          gender: "Female",
          names: [{ id: "N", given: "Just", surname: "Christened" }],
          facts: [
            {
              id: "F2",
              type: "Christening",
              date: "1828",
              standard_date: "1828",
            },
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    expect(
      earliestChildBirthToBirth(new Mob(christeningOnly, "P"), 14),
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasEventAfterDeath — Java MobWarnings.hasEventAfterDeath(mob, days)
// ────────────────────────────────────────────────────────────────────

describe("hasEventAfterDeath predicate", () => {
  it("fires when an event is dated > days after the latest deathlike", () => {
    // Mary PosthumousCensus: Death 1900, Census 1910 → 10y gap.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Mary", surname: "PosthumousCensus" }],
          facts: [
            { id: "F1", type: "Birth", date: "1830", standard_date: "1830" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
            { id: "F3", type: "Census", date: "1910", standard_date: "1910" },
          ],
        },
      ],
    };
    expect(hasEventAfterDeath(new Mob(tree, "I1"), 365)).toBe(true);
  });

  it("does NOT fire on a Probate within 1 year of death (Java's tolerance)", () => {
    // Java: death-anchor includes deathlike family (Probate is deathlike),
    // so a Probate dated within the deathlike window doesn't fire.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Normal", surname: "Probate" }],
          facts: [
            { id: "F1", type: "Death", date: "1900", standard_date: "1900" },
            // Probate within a year of death — the deathlike family raises
            // the death anchor, so diff stays small and doesn't fire.
            { id: "F2", type: "Probate", date: "1900", standard_date: "1900" },
          ],
        },
      ],
    };
    expect(hasEventAfterDeath(new Mob(tree, "I1"), 365)).toBe(false);
  });

  it("returns false when there's no death-like fact", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Still", surname: "Living" }],
          facts: [
            { id: "F1", type: "Birth", date: "1990", standard_date: "1990" },
          ],
        },
      ],
    };
    expect(hasEventAfterDeath(new Mob(tree, "I1"), 365)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasAgeRangeGreaterThan — Java MobWarnings.hasAgeRangeGreaterThan
// ────────────────────────────────────────────────────────────────────

describe("hasAgeRangeGreaterThan predicate", () => {
  it("fires for an implausible 130-year lifespan", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Methuselah", surname: "Outlier" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
            { id: "F2", type: "Death", date: "1930", standard_date: "1930" },
          ],
        },
      ],
    };
    expect(hasAgeRangeGreaterThan(new Mob(tree, "I1"), 120)).toBe(true);
  });

  it("does NOT fire for a normal 85-year lifespan", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Normal", surname: "Lifespan" }],
          facts: [
            { id: "F1", type: "Birth", date: "1860", standard_date: "1860" },
            { id: "F2", type: "Death", date: "1945", standard_date: "1945" },
          ],
        },
      ],
    };
    expect(hasAgeRangeGreaterThan(new Mob(tree, "I1"), 120)).toBe(false);
  });

  it("uses the birth-like and death-like FAMILIES — fires on Christening + Burial", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Christened", surname: "Buried" }],
          facts: [
            {
              id: "F1",
              type: "Christening",
              date: "1800",
              standard_date: "1800",
            },
            { id: "F2", type: "Burial", date: "1925", standard_date: "1925" },
          ],
        },
      ],
    };
    expect(hasAgeRangeGreaterThan(new Mob(tree, "I1"), 120)).toBe(true);
  });

  it("returns false when birth-like or death-like is missing", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "No", surname: "Death" }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
          ],
        },
      ],
    };
    expect(hasAgeRangeGreaterThan(new Mob(tree, "I1"), 120)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasBurialAfterDeath — Java MobWarnings.hasBurialAfterDeath
// ────────────────────────────────────────────────────────────────────

describe("hasBurialAfterDeath predicate (Java math: fires when burial > N days BEFORE death)", () => {
  it("fires when earliest Burial is more than 31 days before latest Death", () => {
    // Burial in 1890, Death in 1900 — burial 10 years BEFORE death.
    // Java's math: latest(Death) − earliest(Burial) = +days → fires.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Burial", surname: "BeforeDeath" }],
          facts: [
            { id: "F1", type: "Burial", date: "1890", standard_date: "1890" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
          ],
        },
      ],
    };
    expect(hasBurialAfterDeath(new Mob(tree, "I1"), 31)).toBe(true);
  });

  it("does NOT fire when Burial is normally after Death", () => {
    // Death first, Burial a week later. Java's math goes negative → does
    // not fire.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Normal", surname: "Burial" }],
          facts: [
            {
              id: "F1",
              type: "Death",
              date: "1 Jan 1900",
              standard_date: "1 Jan 1900",
            },
            {
              id: "F2",
              type: "Burial",
              date: "8 Jan 1900",
              standard_date: "8 Jan 1900",
            },
          ],
        },
      ],
    };
    expect(hasBurialAfterDeath(new Mob(tree, "I1"), 31)).toBe(false);
  });

  it("returns false when Burial or Death is missing", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Only", surname: "Death" }],
          facts: [
            { id: "F1", type: "Death", date: "1900", standard_date: "1900" },
          ],
        },
      ],
    };
    expect(hasBurialAfterDeath(new Mob(tree, "I1"), 31)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// deathRangeGreaterThan — Java MobWarnings.deathRangeGreaterThan
// ────────────────────────────────────────────────────────────────────

describe("deathRangeGreaterThan predicate", () => {
  it("fires when death-like dates span more than 2 years", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Multi", surname: "Death" }],
          facts: [
            { id: "F1", type: "Death", date: "1900", standard_date: "1900" },
            { id: "F2", type: "Burial", date: "1905", standard_date: "1905" }, // 5y after, deathlike
          ],
        },
      ],
    };
    expect(deathRangeGreaterThan(new Mob(tree, "I1"), 2)).toBe(true);
  });

  it("does NOT fire for a tight death-like cluster within 2 years", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Normal", surname: "Death" }],
          facts: [
            { id: "F1", type: "Death", date: "1900", standard_date: "1900" },
            { id: "F2", type: "Burial", date: "1900", standard_date: "1900" },
          ],
        },
      ],
    };
    expect(deathRangeGreaterThan(new Mob(tree, "I1"), 2)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasLateMarriage — Java MobWarnings.hasLateMarriage
// ────────────────────────────────────────────────────────────────────

describe("hasLateMarriage predicate", () => {
  it("fires when latest marriage-like year is more than 90 years after latest birth-like year", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Centenarian", surname: "Bride" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
            { id: "F2", type: "Marriage", date: "1900", standard_date: "1900" }, // 100y after
          ],
        },
      ],
    };
    expect(hasLateMarriage(new Mob(tree, "I1"), 90)).toBe(true);
  });

  it("does NOT fire for a normal marriage 25 years after birth", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Normal", surname: "Marriage" }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
            { id: "F2", type: "Marriage", date: "1875", standard_date: "1875" },
          ],
        },
      ],
    };
    expect(hasLateMarriage(new Mob(tree, "I1"), 90)).toBe(false);
  });

  it("returns false when there's no marriage record", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Never", surname: "Married" }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
          ],
        },
      ],
    };
    expect(hasLateMarriage(new Mob(tree, "I1"), 90)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasEarlyMarriage — Java MobWarnings.hasEarlyMarriage
// ────────────────────────────────────────────────────────────────────

describe("hasEarlyMarriage predicate", () => {
  it("fires when marriage age is under 14", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Child", surname: "Bride" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
            { id: "F2", type: "Marriage", date: "1810", standard_date: "1810" }, // age 10
          ],
        },
      ],
    };
    expect(hasEarlyMarriage(new Mob(tree, "I1"), 14)).toBe(true);
  });

  it("does not fire at exactly age 14 (Java uses strict <)", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Edge", surname: "Case" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
            { id: "F2", type: "Marriage", date: "1814", standard_date: "1814" }, // age exactly 14
          ],
        },
      ],
    };
    expect(hasEarlyMarriage(new Mob(tree, "I1"), 14)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// latestChildBirthToBirth — Java MobWarnings.latestChildBirthToBirth
// ────────────────────────────────────────────────────────────────────

describe("latestChildBirthToBirth predicate", () => {
  it("fires when latest child is 80 years younger than self", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "Self", surname: "X" }],
          facts: [
            { id: "F1", type: "Birth", date: "1800", standard_date: "1800" },
          ],
        },
        {
          id: "C",
          gender: "Male",
          names: [{ id: "N", given: "Late", surname: "Child" }],
          facts: [
            { id: "F2", type: "Birth", date: "1885", standard_date: "1885" }, // 85y gap
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    expect(latestChildBirthToBirth(new Mob(tree, "P"), 80)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// tooManyChildren / tooManyFathers / tooManyMothers
// ────────────────────────────────────────────────────────────────────

describe("structural counters", () => {
  function makeTreeWithRelatives(opts: {
    parents: Array<{ gender: "Male" | "Female" }>;
    children: number;
  }): SimplifiedGedcomX {
    const persons: SimplifiedGedcomX["persons"] = [
      {
        id: "I1",
        gender: "Male",
        names: [{ id: "N1", given: "Anchor", surname: "X" }],
      },
    ];
    const relationships: SimplifiedGedcomX["relationships"] = [];
    opts.parents.forEach((p, i) => {
      const id = `P${i}`;
      persons.push({
        id,
        gender: p.gender,
        names: [{ id: `NP${i}`, given: "Parent", surname: "X" }],
      });
      relationships.push({
        id: `RP${i}`,
        type: "ParentChild",
        parent: id,
        child: "I1",
      });
    });
    for (let i = 0; i < opts.children; i++) {
      const id = `C${i}`;
      persons.push({
        id,
        gender: "Male",
        names: [{ id: `NC${i}`, given: "Child", surname: "X" }],
      });
      relationships.push({
        id: `RC${i}`,
        type: "ParentChild",
        parent: "I1",
        child: id,
      });
    }
    return { persons, relationships };
  }

  it("tooManyChildren fires at cutoff 18 with 18 children", () => {
    const tree = makeTreeWithRelatives({ parents: [], children: 18 });
    expect(tooManyChildren(new Mob(tree, "I1"), 18)).toBe(true);
  });

  it("tooManyChildren does not fire at cutoff 18 with 17 children", () => {
    const tree = makeTreeWithRelatives({ parents: [], children: 17 });
    expect(tooManyChildren(new Mob(tree, "I1"), 18)).toBe(false);
  });

  it("tooManyFathers fires when there are 2 male parents", () => {
    const tree = makeTreeWithRelatives({
      parents: [{ gender: "Male" }, { gender: "Male" }],
      children: 0,
    });
    expect(tooManyFathers(new Mob(tree, "I1"))).toBe(true);
  });

  it("tooManyMothers fires when there are 2 female parents", () => {
    const tree = makeTreeWithRelatives({
      parents: [{ gender: "Female" }, { gender: "Female" }],
      children: 0,
    });
    expect(tooManyMothers(new Mob(tree, "I1"))).toBe(true);
  });

  it("tooManyFathers does not fire when there are 1 male + 1 female parent", () => {
    const tree = makeTreeWithRelatives({
      parents: [{ gender: "Male" }, { gender: "Female" }],
      children: 0,
    });
    expect(tooManyFathers(new Mob(tree, "I1"))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// hasBlankName
// ────────────────────────────────────────────────────────────────────

describe("hasBlankName predicate", () => {
  it("fires when given name is the empty string", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "", surname: "Surname" }],
        },
      ],
    };
    expect(hasBlankName(new Mob(tree, "I1"))).toBe(true);
  });

  it("fires when surname is the empty string", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Given", surname: "" }],
        },
      ],
    };
    expect(hasBlankName(new Mob(tree, "I1"))).toBe(true);
  });

  it("does not fire when names are populated", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "John", surname: "Smith" }],
        },
      ],
    };
    expect(hasBlankName(new Mob(tree, "I1"))).toBe(false);
  });

  it("does not fire when a name field is undefined (Java only catches empty string)", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", surname: "OnlySurname" }],
        },
      ],
    };
    expect(hasBlankName(new Mob(tree, "I1"))).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// calculateWarnings — orchestrator
// ────────────────────────────────────────────────────────────────────

describe("calculateWarnings — orchestrator", () => {
  it("returns hasEventBeforeBirth365_2 (and hasEventAfterDeath1) for Walter TimeTraveler", () => {
    // Walter: Birth 1850, Death 1840 — corrupt in both directions. Java would
    // also emit both:
    //   - hasEventBeforeBirth365_2: gap birth−event = 10y > 730d
    //   - hasEventAfterDeath1:      gap event−death = 10y > 365d
    // Both triggers being present is itself a useful signal that the data is
    // corrupt in two different ways.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Walter", surname: "TimeTraveler" }],
          facts: [
            { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
            { id: "F2", type: "Death", date: "1840", standard_date: "1840" },
          ],
        },
      ],
    };
    const warnings = calculateWarnings(new Mob(tree, "I1"), true);
    const tags = warnings.map((w) => w.issueType);
    expect(tags).toContain("hasEventBeforeBirth365_2");
    expect(tags).toContain("hasEventAfterDeath1");
    for (const w of warnings) {
      expect(w.personId).toBe("I1");
      expect(w.severity).toBe("error");
    }
  });

  it("returns both earliestChildBirthToBirthMale14 AND earliestChildBirthToBirth12 for a male young father (Java emits both)", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Male",
          names: [{ id: "N", given: "Young", surname: "Father" }],
          facts: [
            { id: "F1", type: "Birth", date: "1820", standard_date: "1820" },
          ],
        },
        {
          id: "C",
          gender: "Female",
          names: [{ id: "N", given: "The", surname: "Child" }],
          facts: [
            { id: "F2", type: "Birth", date: "1828", standard_date: "1828" },
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    const tags = calculateWarnings(new Mob(tree, "P"), true).map(
      (w) => w.issueType,
    );
    expect(tags).toContain("earliestChildBirthToBirthMale14");
    expect(tags).toContain("earliestChildBirthToBirth12");
  });

  it("FEMALE anchor with young-child fires earliestChildBirthToBirth12 only (not Male14)", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "P",
          gender: "Female", // not male — the Male14 check is gender-filtered
          names: [{ id: "N", given: "Young", surname: "Mother" }],
          facts: [
            { id: "F1", type: "Birth", date: "1820", standard_date: "1820" },
          ],
        },
        {
          id: "C",
          gender: "Male",
          names: [{ id: "N", given: "The", surname: "Child" }],
          facts: [
            { id: "F2", type: "Birth", date: "1828", standard_date: "1828" },
          ],
        },
      ],
      relationships: [
        { id: "R", type: "ParentChild", parent: "P", child: "C" },
      ],
    };
    const tags = calculateWarnings(new Mob(tree, "P"), true).map(
      (w) => w.issueType,
    );
    expect(tags).not.toContain("earliestChildBirthToBirthMale14");
    expect(tags).toContain("earliestChildBirthToBirth12");
  });

  it("returns the hasEventAfterDeath1 warning for Mary PosthumousCensus", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Mary", surname: "PosthumousCensus" }],
          facts: [
            { id: "F1", type: "Birth", date: "1830", standard_date: "1830" },
            { id: "F2", type: "Death", date: "1900", standard_date: "1900" },
            { id: "F3", type: "Census", date: "1910", standard_date: "1910" },
          ],
        },
      ],
    };
    const warnings = calculateWarnings(new Mob(tree, "I1"), true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].issueType).toBe("hasEventAfterDeath1");
    expect(warnings[0].severity).toBe("error");
    expect(warnings[0].personId).toBe("I1");
  });

  it("emits ONE hasEventAfterDeath1 even when multiple facts are past death (one-per-person, matching Java)", () => {
    // Java's hasEventAfterDeath is boolean — at most one warning per mob.
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Female",
          names: [{ id: "N", given: "Multi", surname: "Posthumous" }],
          facts: [
            { id: "F1", type: "Death", date: "1900", standard_date: "1900" },
            { id: "F2", type: "Census", date: "1910", standard_date: "1910" },
            { id: "F3", type: "Census", date: "1920", standard_date: "1920" },
            {
              id: "F4",
              type: "Residence",
              date: "1915",
              standard_date: "1915",
            },
          ],
        },
      ],
    };
    const eventAfter = calculateWarnings(new Mob(tree, "I1"), true).filter(
      (w) => w.issueType === "hasEventAfterDeath1",
    );
    expect(eventAfter).toHaveLength(1);
  });

  it("returns empty for a clean person (control)", () => {
    const tree: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N", given: "Henry", surname: "Normal" }],
          facts: [
            { id: "F1", type: "Birth", date: "1860", standard_date: "1860" },
            { id: "F2", type: "Death", date: "1925", standard_date: "1925" },
          ],
        },
      ],
    };
    expect(calculateWarnings(new Mob(tree, "I1"), true)).toEqual([]);
  });
});
