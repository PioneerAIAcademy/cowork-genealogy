/**
 * The support inference `source_screen` scores leave-one-out against. The tree
 * here has the import's shape: one person-level ref per attachment, and names
 * and facts that cite no source, so nothing can be read off the tree itself.
 */

import { describe, it, expect } from "vitest";
import { givenNamesRelated, leaveOneOut, nameRelation, relationshipMatches, supportOf } from "../../src/utils/attachment-support.js";

const R1 = "ark:/61903/1:1:AAAA-111";
const R2 = "ark:/61903/1:1:BBBB-222";

const tree = (facts: any[], names = [{ id: "N1", given: "John", surname: "Boyer" }], relationships: any[] = []) => ({
  persons: [
    { id: "I1", gender: "Male", names, facts, sources: [{ ref: "S1" }, { ref: "S2" }] },
    { id: "I2", gender: "Female", names: [{ id: "N2", given: "Anna", surname: "Boyer" }], facts: [] },
  ],
  relationships,
  sources: [{ id: "S1", url: `https://familysearch.org/${R1}` }, { id: "S2", url: `https://familysearch.org/${R2}` }],
});

let n = 0;
const a = (record: string, persona: string, role: string, fact_type: string, more: Record<string, unknown> = {}) => ({
  id: `a_${String(++n).padStart(3, "0")}`, record_id: record, record_persona_id: persona, record_role: role, fact_type,
  value: "", source_id: "src_001", ...more,
});
const research = (assertions: any[], linkTo: Record<string, string> = {}) => ({
  assertions,
  person_evidence: assertions.map((x, i) => ({
    id: `pe_${i}`, assertion_id: x.id, person_id: linkTo[x.record_persona_id] ?? "I1", confidence: "speculative",
  })),
});

describe("supportOf / leaveOneOut", () => {
  it("a fact only one record supports is removed; a fact two records support is kept", () => {
    const t = tree([
      { id: "F1", type: "Birth", date: "1845", place: "Pennsylvania" },
      { id: "F2", type: "Death", date: "1900", place: "Carbon, Pennsylvania" },
    ]);
    const r = research([
      a(R1, "p1", "head_of_household", "birth", { date: "1845", place: "Pennsylvania" }),
      a(R2, "p9", "deceased", "birth", { date: "1845" }),
      a(R2, "p9", "deceased", "death", { date: "1900", place: "Carbon, Pennsylvania, United States" }),
    ]);
    const s = supportOf(t as any, r, "I1");
    expect([...s.facts.get("F1")!].sort()).toEqual(["AAAA-111", "BBBB-222"]);
    expect([...s.facts.get("F2")!]).toEqual(["BBBB-222"]);
    const loo = leaveOneOut(t as any, s, R2);
    expect(loo.persons!.find((p) => p.id === "I1")!.facts!.map((f) => f.id)).toEqual(["F1"]);
    expect(leaveOneOut(t as any, s, R1).persons![0].facts!.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(t.persons[0].facts).toHaveLength(2);
  });

  it("a census age agrees with a birth inside its two-year window", () => {
    // Age 25 in 1870 is born 1844-1845; the tree's 1846 is within tolerance of it.
    const t = tree([{ id: "F1", type: "Birth", date: "1846" }]);
    const r = research([
      a(R1, "p1", "head_of_household", "age", { value: "25 years" }),
      a(R1, "p1", "head_of_household", "census", { date: "1870", value: "1870" }),
    ]);
    expect([...supportOf(t as any, r, "I1").facts.get("F1") ?? []]).toEqual(["AAAA-111"]);
  });

  it("a census age far from the tree's birth supports nothing", () => {
    const t = tree([{ id: "F1", type: "Birth", date: "1830" }]);
    const r = research([
      a(R1, "p1", "head_of_household", "age", { value: "25 years" }),
      a(R1, "p1", "head_of_household", "census", { date: "1870", value: "1870" }),
    ]);
    expect(supportOf(t as any, r, "I1").facts.get("F1")).toBeUndefined();
  });

  it("a place given at a coarser level agrees", () => {
    const t = tree([{ id: "F1", type: "Birth", place: "Lower Towamensing, Carbon, Pennsylvania, United States" }]);
    const r = research([a(R1, "p1", "head_of_household", "birthplace", { place: "Pennsylvania" })]);
    expect([...supportOf(t as any, r, "I1").facts.get("F1") ?? []]).toEqual(["AAAA-111"]);
  });

  it("a place that disagrees supports nothing, even on the same year", () => {
    const t = tree([{ id: "F1", type: "Birth", date: "1845", place: "Ohio" }]);
    const r = research([a(R1, "p1", "head_of_household", "birth", { date: "1845", place: "Pennsylvania" })]);
    expect(supportOf(t as any, r, "I1").facts.get("F1")).toBeUndefined();
  });

  it("only assertions linked to the person count, and a superseded link does not", () => {
    const t = tree([{ id: "F1", type: "Birth", date: "1845" }]);
    const x = a(R1, "p1", "head_of_household", "birth", { date: "1845" });
    expect(supportOf(t as any, research([x], { p1: "I2" }), "I1").facts.size).toBe(0);
    const superseded = { assertions: [x], person_evidence: [{ id: "pe_1", assertion_id: x.id, person_id: "I1", superseded_by: "pe_2" }] };
    expect(supportOf(t as any, superseded, "I1").facts.size).toBe(0);
    const retired = { ...x, superseded_by: "a_999" };
    expect(supportOf(t as any, research([retired]), "I1").facts.size).toBe(0);
  });

  it("names agree after the variant fold, and the person keeps a name", () => {
    const t = tree([], [{ id: "N1", given: "Johann", surname: "Boyer" }]);
    const r = research([a(R1, "p1", "head_of_household", "name", { value: "John Boyer" })]);
    const s = supportOf(t as any, r, "I1");
    expect([...s.names.get("N1")!]).toEqual(["AAAA-111"]);
    expect(leaveOneOut(t as any, s, R1).persons![0].names).toHaveLength(1);
    expect(nameRelation({ given: "Johann", surname: "Boyer" }, { given: "John", surname: "Boyer" })).toBe("variant");
    expect(nameRelation({ given: "Kari", surname: "Halsteinsdatter" }, { given: "Kari", surname: "Halsteinsd." })).toBe("variant");
    expect(nameRelation({ given: "John", surname: "Boyer" }, { given: "Henry", surname: "Boyer" })).toBe("different");
  });

  it("a relationship is supported by a relationship assertion naming both parties' personas", () => {
    const rel = { id: "R1", type: "Couple", person1: "I1", person2: "I2" };
    const t = tree([], undefined, [rel]);
    const r = research(
      [
        a(R1, "p1", "head_of_household", "name", { value: "John Boyer" }),
        a(R1, "p2", "wife", "relationship", { structured_value: { relationship_type: "spouse", related_person_role: "head_of_household" } }),
      ],
      { p2: "I2" },
    );
    const s = supportOf(t as any, r, "I1");
    expect([...s.relationships.get("R1")!]).toEqual(["AAAA-111"]);
    expect(leaveOneOut(t as any, s, R1).relationships).toEqual([]);
    expect(leaveOneOut(t as any, s, R2).relationships).toEqual([rel]);
  });
});

describe("relationshipMatches", () => {
  it("reads the stated type through its category, whatever the word or case", () => {
    const pc = { type: "ParentChild", parent: "I2", child: "I1" };
    const couple = { type: "Couple", person1: "I1", person2: "I2" };
    expect(relationshipMatches("son", "I1", "I2", pc)).toBe(true);
    expect(relationshipMatches("Daughter", "I1", "I2", pc)).toBe(true);
    expect(relationshipMatches("child_inferred", "I1", "I2", pc)).toBe(true);
    expect(relationshipMatches("father", "I2", "I1", pc)).toBe(true);
    expect(relationshipMatches("Wife", "I2", "I1", couple)).toBe(true);
    expect(relationshipMatches("son", "I2", "I1", pc)).toBe(false);
    expect(relationshipMatches("wife", "I1", "I2", pc)).toBe(false);
    expect(relationshipMatches("constructor", "I1", "I2", pc)).toBe(false);
    expect(relationshipMatches("toString", "I1", "I2", couple)).toBe(false);
  });
});

describe("record id case", () => {
  it("a lowercase record_id is the record leave-one-out names", () => {
    const t = tree([{ id: "F1", type: "Death", date: "1900" }]);
    const r = research([a("ark:/61903/1:1:bbbb-222", "p9", "deceased", "death", { date: "1900" })]);
    const s = supportOf(t as any, r, "I1");
    expect([...s.facts.get("F1")!]).toEqual(["BBBB-222"]);
    expect(leaveOneOut(t as any, s, R2).persons![0].facts).toEqual([]);
  });
});

describe("givenNamesRelated", () => {
  it("names sharing three or more table forms are variants; two shared nicknames are not enough", () => {
    expect(givenNamesRelated("Louis", "Lewis")).toBe("variant");
    expect(givenNamesRelated("Katharine", "Catherine")).toBe("variant");
    expect(givenNamesRelated("Margaret", "Mary")).toBe("different");
    expect(givenNamesRelated("John", "Jane")).toBe("different");
    expect(givenNamesRelated("Robert", "Richard")).toBe("different");
  });
});
