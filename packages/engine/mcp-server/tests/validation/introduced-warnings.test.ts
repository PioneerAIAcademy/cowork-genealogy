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
    // The op adds ONLY the parentage edge. I1 was already implausible before
    // it, and I2's own facts never change -- so the warning this must catch is
    // the `relatives*` form on I2, a person the write never touched directly.
    //
    // The previous version of this test made I2 ITSELF implausible and passed
    // `["I2"]`, so it fired on `hasAgeRangeGreaterThan120@I2` -- the op's own
    // person -- with the relationship inert. It passed with no relationship at
    // all, which is to say criterion (d) was never exercised. Assert the
    // specific issueType AND personId so it cannot drift back.
    const before = tree(
      [implausiblePerson("I1", "John", "Smith"), plausiblePerson("I2", "Jane", "Smith")],
      [],
    );
    const after = tree(
      [implausiblePerson("I1", "John", "Smith"), plausiblePerson("I2", "Jane", "Smith")],
      [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    );

    // Both ends must be touched by the edge write; reading only
    // `person1`/`person2` returns [] here and the write sails through.
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));

    const result = introducedWarnings(before, after, touched);
    const tags = result.unjustified.map((w) => `${w.issueType}@${w.personId}`);
    expect(tags).toContain("relativesHasAgeRangeGreaterThan120@I2");
  });

  it("(e2) merge: a contradiction NEITHER predecessor carried IS introduced", () => {
    // The reviewer's question: "introduces" reads as a comparison against the
    // pre-write state, and a merge is exactly where that gets interesting.
    //
    // The answer the code gives, asserted here so it is a contract rather than
    // a reading: a merge that SURFACES a contradiction introduces it. I1 has a
    // birth and no death; I2 has a death and no birth; each is individually
    // plausible and neither warns. Collapsing I2 into I1 gives the survivor a
    // 200-year lifespan, which is in neither before-state, so the delta finds
    // it and the writer must justify it. (e) is the converse: a warning the
    // collapsed person already carried is remapped and needs nothing.
    const before = tree([
      person("I1", "John", "Smith", [
        { id: "I1-f1", type: "Birth", date: "1800", standard_date: "1800" },
      ]),
      person("I2", "Jon", "Smith", [
        { id: "I2-f1", type: "Death", date: "2000", standard_date: "2000" },
      ]),
    ]);
    // After the collapse: one survivor carrying both facts.
    const after = tree([
      person("I1", "John", "Smith", [
        { id: "I1-f1", type: "Birth", date: "1800", standard_date: "1800" },
        { id: "I2-f1", type: "Death", date: "2000", standard_date: "2000" },
      ]),
    ]);

    const result = introducedWarnings(before, after, ["I1", "I2"], undefined, new Map([["I2", "I1"]]));
    const tags = result.unjustified.map((w) => `${w.issueType}@${w.personId}`);
    expect(tags).toContain("hasAgeRangeGreaterThan120@I1");
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
      // A ParentChild carries its ends in `parent`/`child`. The previous
      // fixture used `person1`/`person2`, the Couple pair -- a shape that
      // occurs 0 times in the 2240 committed ParentChild edges -- so it
      // exercised the one field pair the function already read.
      [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    );
    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toContain("I1");
    expect(touched).toContain("I2");
  });

  it("repointing a parent touches the OLD parent too", () => {
    // The before-side read of a CHANGED relationship. When a parent moves
    // I1 -> I3, I1 must enter `touched`, or its before-side warnings are never
    // computed and the delta is wrong in I1's favour -- a warning that existed
    // only while I1 was the parent would read as introduced, or one the
    // repoint resolves would read as still present.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const p3 = plausiblePerson("I3", "James", "Smith");
    const before = tree([p1, p2, p3], [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }]);
    const after = tree([p1, p2, p3], [{ id: "R1", type: "ParentChild", parent: "I3", child: "I2" }]);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2", "I3"]));
  });

  it("removing a parentage edge touches both of its ends", () => {
    // The removed-relationship arm. A removal can RESOLVE a warning as easily
    // as a write can introduce one, and the delta is only correct if both ends
    // are recomputed.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }]);
    const after = tree([p1, p2], []);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));
  });

  it("still reads the Couple pair", () => {
    // The accept direction: widening to parent/child must not stop reading the
    // fields a Couple actually uses. 383 of the committed e2e Couple edges use
    // person1/person2 and none uses parent/child.
    const p1 = plausiblePerson("I1", "John", "Smith");
    const p2 = plausiblePerson("I2", "Jane", "Smith");
    const before = tree([p1, p2], []);
    const after = tree([p1, p2], [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }]);

    const touched = computeTouchedPersonIds(before, after);
    expect(touched).toEqual(expect.arrayContaining(["I1", "I2"]));
  });
});
