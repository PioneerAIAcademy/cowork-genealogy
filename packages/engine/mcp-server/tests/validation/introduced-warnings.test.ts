/**
 * Unit tests for `introducedWarnings` (issue #2840): a writer tool must refuse
 * when its write introduces genealogical warnings the caller has not justified.
 *
 * The six acceptance criteria from the issue:
 * (a) introduced warning with no justification → refuse, tree byte-identical
 * (b) same write with every id justified → lands and persists justifications
 * (c) pre-existing warning → needs no justification
 * (d) warning on a one-hop relative is caught
 * (e) merge: collapsed person's old warning needs none (remap)
 * (f) justification with stale id → refused
 */

import { describe, it, expect } from "vitest";
import {
  introducedWarnings,
  warningId,
  staleJustifications,
  computeTouchedPersonIds,
  competingParentage,
} from "../../src/validation/introduced-warnings.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

function person(id: string, given: string, surname: string, facts: any[] = []) {
  return {
    id,
    gender: "Male",
    names: [{ id: `${id}-n`, given, surname }],
    facts,
  };
}

function tree(persons: any[], relationships: any[] = []): SimplifiedGedcomX {
  return { persons, relationships, sources: [] } as unknown as SimplifiedGedcomX;
}

/** A person with an implausible lifespan (born 1800, died 2000 = 200 years). */
function implausiblePerson(id: string, given: string, surname: string) {
  return person(id, given, surname, [
    { id: `${id}-f1`, type: "Birth", date: "1800", standard_date: "1800" },
    { id: `${id}-f2`, type: "Death", date: "2000", standard_date: "2000" },
  ]);
}

/** A person with a plausible lifespan (born 1900, died 1970 = 70 years). */
function plausiblePerson(id: string, given: string, surname: string) {
  return person(id, given, surname, [
    { id: `${id}-f1`, type: "Birth", date: "1900", standard_date: "1900" },
    { id: `${id}-f2`, type: "Death", date: "1970", standard_date: "1970" },
  ]);
}

describe("introducedWarnings", () => {
  it("(a) an introduced warning with no justification is unjustified", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    // After: birth changed to 1800, making lifespan 170 years
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"]);

    expect(result.unjustified.length).toBeGreaterThan(0);
    expect(result.unjustified[0].issueType).toBe("hasAgeRangeGreaterThan120");
    expect(result.unjustified[0].warningId).toBeTruthy();
  });

  it("(b) same write with every id justified → no unjustified warnings", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    // First call to get the warning ids
    const firstResult = introducedWarnings(before, after, ["I1"]);
    expect(firstResult.unjustified.length).toBeGreaterThan(0);

    // Second call with justifications
    const justifications = firstResult.allIntroduced.map((w) => ({
      warningId: w.warningId,
      justification: "Imported as recorded on FamilySearch",
    }));
    const result = introducedWarnings(before, after, ["I1"], justifications);

    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced.length).toBeGreaterThan(0);
  });

  it("(c) pre-existing warning needs no justification", () => {
    // Both before and after have the implausible lifespan
    const before = tree([implausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"]);

    // No introduced warnings since it was pre-existing
    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced).toHaveLength(0);
  });

  it("(d) warning on a one-hop relative is caught", () => {
    // Before: child has plausible dates
    const childBefore = plausiblePerson("I2", "Junior", "Smith");
    const parent = person("I1", "John", "Smith", [
      { id: "I1-f1", type: "Birth", date: "1900", standard_date: "+1900" },
    ]);
    const before = tree(
      [parent, childBefore],
      [{ id: "R1", type: "ParentChild", person1: "I1", person2: "I2" }],
    );

    // After: change child's birth to make them impossibly old
    const childAfter = implausiblePerson("I2", "Junior", "Smith");
    const after = tree(
      [parent, childAfter],
      [{ id: "R1", type: "ParentChild", person1: "I1", person2: "I2" }],
    );

    // Touch I2 only — but the warning should be caught
    const result = introducedWarnings(before, after, ["I2"]);

    expect(result.unjustified.length).toBeGreaterThan(0);
  });

  it("(e) merge: collapsed person's old warning needs no justification (remap)", () => {
    // Before: both I1 (survivor) and I2 (collapsed) have an implausible lifespan.
    // The merge collapses I2 into I1, keeping I1's facts — I2 disappears.
    // The warning on I1 was pre-existing, so the merge introduces nothing.
    const before = tree([
      implausiblePerson("I1", "John", "Smith"),
      implausiblePerson("I2", "Jane", "Smith"),
    ]);
    // After merge: I2 is gone, I1 (survivor) still has the same implausible dates
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    // collapseMap: I2 was collapsed into I1
    const collapseMap = new Map([["I2", "I1"]]);

    // I1's warning was pre-existing (same facts, same person) so needs none.
    // I2's warning is remapped to I1 — since I1 already had the same warning
    // type before, the delta is empty.
    const result = introducedWarnings(
      before, after, ["I1", "I2"], undefined, collapseMap,
    );

    expect(result.unjustified).toHaveLength(0);
    expect(result.allIntroduced).toHaveLength(0);
  });

  it("(f) justification with stale id is detected", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);

    const result = introducedWarnings(before, after, ["I1"], [
      { warningId: "stale_nonexistent_id", justification: "bad id" },
    ]);

    // Still unjustified because the stale id doesn't match
    expect(result.unjustified.length).toBeGreaterThan(0);

    // And staleJustifications detects the bad id
    const stale = staleJustifications(result.allIntroduced, [
      { warningId: "stale_nonexistent_id", justification: "bad id" },
    ]);
    expect(stale).toContain("stale_nonexistent_id");
  });
});

describe("warningId", () => {
  it("produces a stable id from issueType, personId, relatedPersonId and fact ids", () => {
    const w = {
      scoreType: "coherence",
      issueType: "hasAgeRangeGreaterThan120",
      severity: "contradiction" as const,
      personId: "I1",
      personName: "John Smith",
      message: "test",
      facts: [
        { id: "F2", type: "Death", date: "2000" },
        { id: "F1", type: "Birth", date: "1800" },
      ],
    };
    const id = warningId(w);
    expect(id).toBe("hasAgeRangeGreaterThan120|I1||F1,F2");
  });

  it("includes relatedPersonId when present", () => {
    const w = {
      scoreType: "coherence",
      issueType: "someCheck",
      severity: "contradiction" as const,
      personId: "I1",
      personName: "John Smith",
      message: "test",
      relatedPersonId: "I2",
    };
    const id = warningId(w);
    expect(id).toBe("someCheck|I1|I2|");
  });
});

describe("computeTouchedPersonIds", () => {
  it("detects a person whose facts changed", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([implausiblePerson("I1", "John", "Smith")]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects an added person", () => {
    const before = tree([]);
    const after = tree([plausiblePerson("I1", "John", "Smith")]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects a removed person", () => {
    const before = tree([plausiblePerson("I1", "John", "Smith")]);
    const after = tree([]);
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
  });

  it("detects relationship endpoint changes", () => {
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], []);
    const after = tree(
      [p1, p2],
      [{ id: "R1", type: "ParentChild", person1: "I1", person2: "I2" }],
    );
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
    expect(touched).toContain("I2");
  });
});

// Issue #2525: competing biological parentage, surfaced by the tree writers.
describe("competingParentage", () => {
  const gp = (id: string, given: string, gender: string) => ({
    id,
    gender,
    names: [{ id: `${id}-n`, given, surname: "Flynn" }],
    facts: [],
  });
  const people = () => [
    gp("I1", "Patrick", "Male"),
    gp("I2", "Thomas", "Male"),
    gp("I3", "John", "Male"),
    gp("I4", "Mary", "Female"),
    gp("I5", "Ann", "Female"),
    gp("I6", "James", "Male"),
  ];
  const pc = (id: string, parent: string, subtype?: string, ref = "S1") => ({
    id,
    type: "ParentChild",
    parent,
    child: "I1",
    ...(subtype ? { subtype } : {}),
    sources: [{ ref }],
  });
  const research = {
    sources: [
      { id: "src_001", gedcomx_source_description_id: "S1" },
      { id: "src_002", gedcomx_source_description_id: "S2" },
    ],
    assertions: [
      { id: "a_001", source_id: "src_001", fact_type: "relationship" },
      { id: "a_002", source_id: "src_001", fact_type: "birth" },
      { id: "a_003", source_id: "src_002", fact_type: "relationship" },
    ],
    person_evidence: [
      { assertion_id: "a_001", person_id: "I2" },
      { assertion_id: "a_003", person_id: "I3" },
    ],
  };
  const surface = (
    beforeRels: any[],
    afterRels: any[],
    proposed?: Map<string, string>,
    beforePeople = people(),
    afterPeople = people(),
  ) => {
    const before = tree(beforePeople, beforeRels);
    const after = tree(afterPeople, afterRels);
    return competingParentage(before, after, research, proposed);
  };

  it("names both fathers and the assertion behind each when a second biological father is added", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", undefined, "S2")]);
    expect(out).toEqual([
      {
        personId: "I1",
        factType: "ParentChild",
        values: ["I2 Thomas Flynn (a_001)", "I3 John Flynn (a_003)"],
      },
    ]);
  });

  it("names the proposed edge by the call's sourceAssertionId", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3")], new Map([["I3|I1", "a_099"]]));
    expect(out[0].values).toContain("I3 John Flynn (a_099)");
  });

  it("falls back to the source ref when no parentage assertion resolves", () => {
    const out = surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", undefined, "S9")]);
    expect(out[0].values).toContain("I3 John Flynn (source S9)");
  });

  it("surfaces a new biological father when a biological and an adoptive one already stood", () => {
    // tooManyFathers2 already stands on I1 here (the detector ignores subtype),
    // so the gate's introduced list is empty. This is why the check reads the
    // trees rather than that list.
    const standing = [pc("R1", "I2"), pc("R2", "I3", "Adoptive")];
    const before = tree(people(), standing);
    const after = tree(people(), [...standing, pc("R3", "I6", undefined, "S9")]);
    const introduced = introducedWarnings(before, after, computeTouchedPersonIds(before, after)).allIntroduced;
    expect(introduced.filter((w) => w.issueType === "tooManyFathers2")).toEqual([]);
    const out = surface(standing, [...standing, pc("R3", "I6", undefined, "S9")]);
    expect(out).toEqual([
      {
        personId: "I1",
        factType: "ParentChild",
        values: ["I2 Thomas Flynn (a_001)", "I6 James Flynn (source S9)"],
      },
    ]);
  });

  it("surfaces a second father made by changing a parent's gender", () => {
    const rels = [pc("R1", "I2"), pc("R2", "I4")];
    const afterPeople = people().map((p) => (p.id === "I4" ? { ...p, gender: "Male" } : p));
    expect(surface(rels, rels, undefined, people(), afterPeople)).toHaveLength(1);
  });

  it("does not surface an adoptive father beside a biological one", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", "Adoptive")])).toEqual([]);
  });

  it("counts an absent subtype and Biological alike", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I3", "Biological")])).toHaveLength(1);
  });

  it("counts a parent holding both a Biological and an Adoptive edge once", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I2", "Adoptive")])).toEqual([]);
  });

  it("surfaces two biological mothers the same way", () => {
    const out = surface([pc("R1", "I4")], [pc("R1", "I4"), pc("R2", "I5")]);
    expect(out.map((c) => c.values.length)).toEqual([2]);
  });

  it("does not surface a mother added beside a father", () => {
    expect(surface([pc("R1", "I2")], [pc("R1", "I2"), pc("R2", "I4")])).toEqual([]);
  });

  it("does not cite an assertion linked only to the child (it may name the mother)", () => {
    const rs = {
      sources: [{ id: "src_001", gedcomx_source_description_id: "S1" }],
      assertions: [
        { id: "a_001", source_id: "src_001", fact_type: "relationship", value: "Father: Thomas" },
        { id: "a_002", source_id: "src_001", fact_type: "relationship", value: "Mother: Mary" },
      ],
      person_evidence: [
        { assertion_id: "a_001", person_id: "I2" },
        { assertion_id: "a_002", person_id: "I1" },
      ],
    };
    const before = tree(people(), [pc("R1", "I2")]);
    const after = tree(people(), [pc("R1", "I2"), pc("R2", "I3", undefined, "S2")]);
    expect(competingParentage(before, after, rs)[0].values).toEqual([
      "I2 Thomas Flynn (a_001)",
      "I3 John Flynn (source S2)",
    ]);
  });

  it("is skipped when no ParentChild edge or gender changed", () => {
    // A fact edit on a tree that already holds two fathers raises nothing new.
    const rels = [pc("R1", "I2"), pc("R2", "I3")];
    const before = tree(people(), []);
    const after = tree(people(), rels);
    expect(competingParentage(after, after, research)).toEqual([]);
    expect(competingParentage(before, after, research)).toHaveLength(1);
  });

  it("does not surface a set that did not grow", () => {
    const both = [pc("R1", "I2"), pc("R2", "I3")];
    expect(surface(both, [...both, pc("R3", "I2")])).toEqual([]);
  });
});
