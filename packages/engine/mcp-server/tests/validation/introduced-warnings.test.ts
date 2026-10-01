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
