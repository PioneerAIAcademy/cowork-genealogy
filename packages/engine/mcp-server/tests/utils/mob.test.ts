import { describe, it, expect } from "vitest";

import {
  Mob,
  BIRTHLIKE_FACT_TYPES,
  DEATHLIKE_FACT_TYPES,
  MARRIAGELIKE_FACT_TYPES,
  DIVORCELIKE_FACT_TYPES,
  MIGRATIONLIKE_FACT_TYPES,
  RESIDENCELIKE_FACT_TYPES,
  isVitalType,
} from "../../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

// ────────────────────────────────────────────────────────────────────
// Block A: fact-family constants
// ────────────────────────────────────────────────────────────────────

describe("fact-family constants — sizes match Richard's lists", () => {
  it("BIRTHLIKE_FACT_TYPES has 10 members", () => {
    expect(BIRTHLIKE_FACT_TYPES.size).toBe(10);
  });

  it("DEATHLIKE_FACT_TYPES has 9 members", () => {
    expect(DEATHLIKE_FACT_TYPES.size).toBe(9);
  });

  it("MARRIAGELIKE_FACT_TYPES has 9 members", () => {
    expect(MARRIAGELIKE_FACT_TYPES.size).toBe(9);
  });

  it("DIVORCELIKE_FACT_TYPES has 4 members", () => {
    expect(DIVORCELIKE_FACT_TYPES.size).toBe(4);
  });

  it("MIGRATIONLIKE_FACT_TYPES has 8 members", () => {
    expect(MIGRATIONLIKE_FACT_TYPES.size).toBe(8);
  });

  it("RESIDENCELIKE_FACT_TYPES has 3 members", () => {
    expect(RESIDENCELIKE_FACT_TYPES.size).toBe(3);
  });

  it("birth-like includes Christening and Baptism (not just Birth)", () => {
    expect(BIRTHLIKE_FACT_TYPES.has("Christening")).toBe(true);
    expect(BIRTHLIKE_FACT_TYPES.has("Baptism")).toBe(true);
    expect(BIRTHLIKE_FACT_TYPES.has("BirthRegistration")).toBe(true);
  });

  it("death-like includes Burial / Cremation / Probate / Will", () => {
    expect(DEATHLIKE_FACT_TYPES.has("Burial")).toBe(true);
    expect(DEATHLIKE_FACT_TYPES.has("Cremation")).toBe(true);
    expect(DEATHLIKE_FACT_TYPES.has("Probate")).toBe(true);
    expect(DEATHLIKE_FACT_TYPES.has("Will")).toBe(true);
  });
});

describe("isVitalType", () => {
  it("returns true for any birth-like type", () => {
    expect(isVitalType("Christening")).toBe(true);
  });
  it("returns true for any death-like type", () => {
    expect(isVitalType("Burial")).toBe(true);
  });
  it("returns true for any marriage-like type", () => {
    expect(isVitalType("MarriageBanns")).toBe(true);
  });
  it("returns false for non-vital types like Census", () => {
    expect(isVitalType("Census")).toBe(false);
  });
  it("returns false for undefined", () => {
    expect(isVitalType(undefined)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block B: Mob construction and anchor lookup
// ────────────────────────────────────────────────────────────────────

const tree: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      gender: "Male",
      names: [{ id: "N1", given: "John", surname: "Smith" }],
      facts: [
        { id: "F1", type: "Birth", date: "1850", standard_date: "1850" },
        { id: "F2", type: "Christening", date: "1851", standard_date: "1851" },
        { id: "F3", type: "Death", date: "1920", standard_date: "1920" },
        { id: "F4", type: "Census", date: "1900", standard_date: "1900" },
      ],
    },
    {
      id: "I2",
      gender: "Female",
      names: [{ id: "N2", given: "Mary", surname: "Smith" }],
      facts: [{ id: "F5", type: "Birth", date: "1855" }],
    },
    {
      id: "I3",
      gender: "Male",
      names: [{ id: "N3", given: "Father", surname: "Smith" }],
      facts: [{ id: "F6", type: "Birth", date: "1820" }],
    },
    {
      id: "I4",
      gender: "Female",
      names: [{ id: "N4", given: "Mother", surname: "Smith" }],
      facts: [{ id: "F7", type: "Birth", date: "1825" }],
    },
    {
      id: "I5",
      gender: "Male",
      names: [{ id: "N5", given: "Child", surname: "Smith" }],
    },
    {
      id: "I6",
      gender: "Female",
      names: [{ id: "N6", given: "Sister", surname: "Smith" }],
    },
  ],
  relationships: [
    { id: "R1", type: "ParentChild", parent: "I3", child: "I1" },
    { id: "R2", type: "ParentChild", parent: "I4", child: "I1" },
    { id: "R3", type: "Couple", person1: "I1", person2: "I2" },
    { id: "R4", type: "ParentChild", parent: "I1", child: "I5" },
    { id: "R5", type: "ParentChild", parent: "I3", child: "I6" }, // I6 = sibling of I1 (same father I3)
  ],
};

describe("Mob construction", () => {
  it("throws when the anchor id is not in tree.persons", () => {
    expect(() => new Mob(tree, "I999")).toThrow(/I999.*not found/);
  });

  it("returns the anchor person from getPerson", () => {
    const mob = new Mob(tree, "I1");
    expect(mob.getPerson().id).toBe("I1");
    expect(mob.getPerson().names?.[0].given).toBe("John");
  });

  it("returns the anchor's gender", () => {
    expect(new Mob(tree, "I1").getGender()).toBe("Male");
    expect(new Mob(tree, "I2").getGender()).toBe("Female");
  });

  it("getAllPersons returns the whole tree.persons array", () => {
    expect(new Mob(tree, "I1").getAllPersons()).toHaveLength(6);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block C: relative accessors
// ────────────────────────────────────────────────────────────────────

describe("Mob relative accessors — anchor I1 (John Smith)", () => {
  const mob = new Mob(tree, "I1");

  it("getParents returns [father, mother]", () => {
    expect(mob.getParents().map((p) => p.id)).toEqual(["I3", "I4"]);
  });

  it("getFathers returns the male parent only", () => {
    expect(mob.getFathers().map((p) => p.id)).toEqual(["I3"]);
  });

  it("getMothers returns the female parent only", () => {
    expect(mob.getMothers().map((p) => p.id)).toEqual(["I4"]);
  });

  it("getSpouses returns the partner from the Couple relationship", () => {
    expect(mob.getSpouses().map((p) => p.id)).toEqual(["I2"]);
  });

  it("getChildren returns the children", () => {
    expect(mob.getChildren().map((p) => p.id)).toEqual(["I5"]);
  });

  it("getSons returns male children only", () => {
    expect(mob.getSons().map((p) => p.id)).toEqual(["I5"]);
  });

  it("getSiblings returns half/full siblings (children of any parent)", () => {
    // I1's father I3 also has child I6, so I6 is a sibling of I1.
    expect(mob.getSiblings().map((p) => p.id)).toEqual(["I6"]);
  });

  it("getSiblings excludes the anchor itself", () => {
    expect(mob.getSiblings().map((p) => p.id)).not.toContain("I1");
  });
});

// ────────────────────────────────────────────────────────────────────
// Block D: anchor fact filters
// ────────────────────────────────────────────────────────────────────

describe("Mob anchor fact filters — I1 has Birth, Christening, Death, Census", () => {
  const mob = new Mob(tree, "I1");

  it("getFacts returns all 4 facts on the anchor", () => {
    expect(mob.getFacts().map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4"]);
  });

  it("getFactsOfType('Birth') returns only the Birth fact", () => {
    expect(mob.getFactsOfType("Birth").map((f) => f.id)).toEqual(["F1"]);
  });

  it("birthLikeFacts returns Birth + Christening (both in the family)", () => {
    expect(mob.birthLikeFacts().map((f) => f.id)).toEqual(["F1", "F2"]);
  });

  it("deathLikeFacts returns only Death (Census is not death-like)", () => {
    expect(mob.deathLikeFacts().map((f) => f.id)).toEqual(["F3"]);
  });

  it("marriageLikeFacts is empty for I1 (no marriage facts attached)", () => {
    expect(mob.marriageLikeFacts()).toEqual([]);
  });

  it("vitalFacts returns Birth + Christening + Death (not Census)", () => {
    expect(mob.vitalFacts().map((f) => f.id)).toEqual(["F1", "F2", "F3"]);
  });
});
