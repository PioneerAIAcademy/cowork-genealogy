import { describe, expect, it } from "vitest";
import { familyReadPersonIds, familySearchTreeSourceIds, importBaseline } from "../../src/utils/import-baseline.js";

const FS = { id: "S1", title: "FamilySearch Family Tree (read from John Smith, KWZ1-ABC)", url: "https://www.familysearch.org/tree" };
const REC = { id: "S2", title: "1880 census", url: "https://www.familysearch.org/ark:/61903/1:1:MXYZ-123" };
const person = (id: string, facts: any[] = []) => ({ id, gender: "Male", names: [{ id: `N${id}`, given: id }], facts });
const birth = (id: string, date: string, sources: any[] = []) => ({ id, type: "Birth", date, sources });

describe("import-baseline (Decision 7)", () => {
  it("finds the FamilySearch-tree source by url or title, never by id", () => {
    expect([...familySearchTreeSourceIds({ sources: [FS, REC, { id: "S1x", title: "Other", url: "https://www.familysearch.org/tree/" }] })].sort()).toEqual(["S1", "S1x"]);
    expect(familySearchTreeSourceIds({ sources: [{ id: "S1", title: "1900 census" }] }).size).toBe(0);
  });

  it("with a baseline: a starting-tree edge or fact is an import, a minted one is not", () => {
    const start = {
      persons: [person("I1", [birth("F1", "1850")]), person("I2")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
      sources: [FS],
    };
    const now = {
      ...start,
      persons: [...start.persons, person("I9")],
      relationships: [...start.relationships, { id: "R9", type: "ParentChild", parent: "I9", child: "I1" }],
    };
    const b = importBaseline(now, start);
    expect(b.isImportEdge({ type: "ParentChild", parent: "I2", child: "I1" })).toBe(true);
    expect(b.isImportEdge({ type: "ParentChild", parent: "I9", child: "I1" })).toBe(false);
    expect(b.isImportFact(["I1"], birth("F1", "1850"))).toBe(true);
    expect(b.isImportFact(["I1"], birth("F7", "1850"))).toBe(true);
    expect(b.isImportFact(["I1"], birth("F8", "1862", [{ ref: "S2" }]))).toBe(false);
    expect(b.isImportFact(["I1"], birth("F9", "25 Nov 1850"))).toBe(false);
    expect(b.isImportFact(["I1"], birth("F1", "25 Nov 1879"))).toBe(false);
    const undated = importBaseline(now, { ...start, persons: [person("I1", [{ id: "F1", type: "Residence" }]), person("I2")] });
    expect(undated.isImportFact(["I1"], { id: "F5", type: "Residence", date: "1880", place: "Ohio" })).toBe(false);
  });

  it("with no baseline: a quality-1 FamilySearch-tree ref or no refs reads as an import; a record ref alone does not", () => {
    const tree = { persons: [person("I1")], relationships: [], sources: [FS, REC] };
    const b = importBaseline(tree, null);
    expect(b.isImportEdge({ type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: "S1", quality: 1 }, { ref: "S2" }] })).toBe(true);
    expect(b.isImportEdge({ type: "Couple", person1: "I1", person2: "I2" })).toBe(true);
    expect(b.isImportEdge({ type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: "S2", quality: 3 }] })).toBe(false);
    expect(b.isImportFact(["I1"], birth("F1", "1850", [{ ref: "S1", quality: 2 }]))).toBe(false);
  });

  it("a holder a merge removed from the baseline falls back to the refs", () => {
    const start = { persons: [person("I1")], relationships: [], sources: [FS] };
    const now = { persons: [person("I1"), person("I5")], relationships: [], sources: [FS, REC] };
    const b = importBaseline(now, start);
    expect(b.isImportFact(["I5"], birth("F1", "1850", [{ ref: "S1", quality: 1 }]))).toBe(true);
    expect(b.isImportFact(["I5"], birth("F2", "1850", [{ ref: "S2" }]))).toBe(false);
    expect(b.isImportFact(["I5"], birth("F3", "1850"))).toBe(false);
  });

  it("a merge of two baseline persons keeps the absorbed person's imports as imports", () => {
    const start = {
      persons: [person("I2", [birth("F1", "1850")]), person("I5", [{ id: "F9", type: "Death", date: "1910", sources: [{ ref: "S1", quality: 1 }] }]), person("I9")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I5", child: "I9", sources: [{ ref: "S1", quality: 1 }] }],
      sources: [FS],
    };
    const merged = {
      persons: [person("I2", [birth("F1", "1850"), { id: "F9", type: "Death", date: "1910", sources: [{ ref: "S1", quality: 1 }] }]), person("I9")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I9", sources: [{ ref: "S1", quality: 1 }] }],
      sources: [FS],
    };
    const b = importBaseline(merged, start);
    expect(b.isImportFact(["I2"], merged.persons[0].facts[1])).toBe(true);
    expect(b.isImportEdge(merged.relationships[0])).toBe(true);
    // A new fact that repeats another baseline person's value is not an import.
    expect(b.isImportFact(["I9"], { id: "F77", type: "Birth", date: "1850" })).toBe(false);
  });

  it("a merge that re-numbers a clashing fact id keeps the moved import, and an in-place edit to a sibling's value is not one", () => {
    const fs = [{ ref: "S1", quality: 1 }];
    const place = "Coshocton, Ohio, United States";
    const start = {
      persons: [
        person("A", [{ id: "U1", type: "Birth", date: "1809", place, sources: fs }]),
        person("B", [{ id: "U1", type: "Birth", date: "1807", place, sources: fs }]),
      ],
      relationships: [],
      sources: [FS],
    };
    const merged = {
      persons: [person("A", [{ id: "U1", type: "Birth", date: "1809", place, sources: fs }, { id: "F1", type: "Birth", date: "1807", place, sources: fs }])],
      relationships: [],
      sources: [FS],
    };
    expect(importBaseline(merged, start).isImportFact(["A"], merged.persons[0].facts[1])).toBe(true);
    const edited = {
      persons: [person("A", [{ id: "U1", type: "Birth", date: "1807", place, sources: fs }]), start.persons[1]],
      relationships: [],
      sources: [FS],
    };
    expect(importBaseline(edited, start).isImportFact(["A"], edited.persons[0].facts[0])).toBe(false);
  });
});

describe("familyReadPersonIds", () => {
  const src = (title: string) => ({ id: "S1", title, url: "https://www.familysearch.org/tree" });

  it("finds the person read by the PID in the source title, through any ark spelling", () => {
    const tree = {
      sources: [src("FamilySearch Family Tree (read from Smith, John, Jr., ab12-c3d)")],
      persons: [
        { id: "I1", ark: "https://www.familysearch.org/ark:/61903/4:1:AB12-C3D" },
        { id: "I2", ark: "ark:/61903/4:1:ZZZZ-999" },
        { id: "I3" },
      ],
    };
    expect(familyReadPersonIds(tree)).toEqual(["I1"]);
  });

  it("is empty with no read-from title, or a read-from title on a non-Family-Tree source", () => {
    const persons = [{ id: "I1", ark: "ark:/61903/4:1:AB12-C3D" }];
    expect(familyReadPersonIds({ sources: [src("FamilySearch Family Tree")], persons })).toEqual([]);
    expect(
      familyReadPersonIds({ sources: [{ id: "S2", title: "Notes (read from John, AB12-C3D)" }], persons }),
    ).toEqual([]);
    expect(familyReadPersonIds({})).toEqual([]);
  });

  it("names every tree person linked to the PID read, once each", () => {
    const tree = {
      sources: [src("FamilySearch Family Tree (read from John, AB12-C3D)")],
      persons: [
        { id: "I1", ark: "ark:/61903/4:1:AB12-C3D" },
        { id: "I7", ark: "ark:/61903/4:1:ab12-c3d" },
      ],
    };
    expect(familyReadPersonIds(tree)).toEqual(["I1", "I7"]);
  });
});
