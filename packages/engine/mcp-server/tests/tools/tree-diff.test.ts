import { describe, it, expect } from "vitest";
import { treeDiff } from "../../src/tools/tree-diff.js";

/**
 * tree_diff reports what a second simplified-GedcomX tree added, removed, and
 * changed relative to a first. The load-bearing behaviours, each pinned below:
 *   - persons key on `id`; facts on a content signature;
 *   - relationships key on ENDPOINTS, never on `id` (a re-pointed PID-TODO
 *     placeholder must read as new structure, not as unchanged);
 *   - a Marriage fact lives on a Couple relationship, so a Couple added with a
 *     Marriage fact is one added relationship, not a person fact;
 *   - `personsWithNewStructure` is the union a tree-encoding gate asks about.
 */
describe("tree_diff", () => {
  const person = (id: string, facts: object[] = []) => ({
    id,
    gender: "Unknown",
    names: [{ given: "A", surname: "B" }],
    facts,
  });
  const birth = (date: string) => ({ id: "f1", type: "Birth", date });

  it("reports a wholly added person", () => {
    const before = { persons: [person("I1")], relationships: [] };
    const after = { persons: [person("I1"), person("I2")], relationships: [] };
    const d = treeDiff({ before, after });
    expect(d.personsAdded).toEqual(["I2"]);
    expect(d.personsRemoved).toEqual([]);
    expect(d.personsWithNewStructure).toContain("I2");
  });

  it("reports a fact added to an existing person", () => {
    const before = { persons: [person("I1")], relationships: [] };
    const after = { persons: [person("I1", [birth("1850")])], relationships: [] };
    const d = treeDiff({ before, after });
    expect(d.personsChanged).toHaveLength(1);
    expect(d.personsChanged[0].id).toBe("I1");
    expect(d.personsChanged[0].addedFacts).toHaveLength(1);
    expect(d.personsWithNewStructure).toContain("I1");
  });

  it("treats a corrected fact date as a change (added + removed)", () => {
    const before = { persons: [person("I1", [birth("1850")])], relationships: [] };
    const after = { persons: [person("I1", [birth("1851")])], relationships: [] };
    const d = treeDiff({ before, after });
    expect(d.personsChanged).toHaveLength(1);
    expect(d.personsChanged[0].addedFacts).toHaveLength(1);
    expect(d.personsChanged[0].removedFacts).toHaveLength(1);
  });

  it("reports an added Couple relationship and its Marriage fact as one relationship", () => {
    const before = {
      persons: [person("I1"), person("I2")],
      relationships: [],
    };
    const after = {
      persons: [person("I1"), person("I2")],
      relationships: [
        {
          id: "R1",
          type: "Couple",
          person1: "I1",
          person2: "I2",
          facts: [{ id: "mf", type: "Marriage", date: "1870" }],
        },
      ],
    };
    const d = treeDiff({ before, after });
    expect(d.relationshipsAdded).toHaveLength(1);
    expect(d.relationshipsAdded[0].type).toBe("Couple");
    // Both endpoints of the added Couple gained structure.
    expect(d.personsWithNewStructure).toEqual(expect.arrayContaining(["I1", "I2"]));
    // A Marriage fact does not surface as a person fact change.
    expect(d.personsChanged).toEqual([]);
  });

  it("reports an added ParentChild relationship", () => {
    const before = { persons: [person("I1"), person("I2")], relationships: [] };
    const after = {
      persons: [person("I1"), person("I2")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2", subtype: "Biological" }],
    };
    const d = treeDiff({ before, after });
    expect(d.relationshipsAdded).toHaveLength(1);
    expect(d.relationshipsAdded[0].type).toBe("ParentChild");
    expect(d.personsWithNewStructure).toEqual(expect.arrayContaining(["I1", "I2"]));
  });

  it("keys relationships on endpoints, not id: a re-pointed placeholder reads as new", () => {
    // The seeded relationship pointed child at a PID-TODO placeholder; the agent
    // re-pointed it to the real person, keeping the SAME id. Keyed on id this
    // would read as unchanged; keyed on endpoints it is one removed + one added.
    const before = {
      persons: [person("I1"), person("PID-TODO")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "PID-TODO" }],
    };
    const after = {
      persons: [person("I1"), person("I2")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    };
    const d = treeDiff({ before, after });
    expect(d.relationshipsAdded).toHaveLength(1);
    expect(d.relationshipsAdded[0].relationship.child).toBe("I2");
    expect(d.relationshipsRemoved).toHaveLength(1);
    expect(d.relationshipsRemoved[0].relationship.child).toBe("PID-TODO");
  });

  it("treats Couple endpoints as unordered", () => {
    const rel = (p1: string, p2: string) => ({ id: "R1", type: "Couple", person1: p1, person2: p2 });
    const before = { persons: [person("I1"), person("I2")], relationships: [rel("I1", "I2")] };
    const after = { persons: [person("I1"), person("I2")], relationships: [rel("I2", "I1")] };
    const d = treeDiff({ before, after });
    expect(d.relationshipsAdded).toEqual([]);
    expect(d.relationshipsRemoved).toEqual([]);
  });

  it("reports a removed relationship", () => {
    const before = {
      persons: [person("I1"), person("I2")],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    };
    const after = { persons: [person("I1"), person("I2")], relationships: [] };
    const d = treeDiff({ before, after });
    expect(d.relationshipsRemoved).toHaveLength(1);
    expect(d.relationshipsAdded).toEqual([]);
  });

  it("finds no change between identical trees", () => {
    const t = {
      persons: [person("I1", [birth("1850")])],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I1x" }],
    };
    const d = treeDiff({ before: t, after: t });
    expect(d.personsAdded).toEqual([]);
    expect(d.personsRemoved).toEqual([]);
    expect(d.personsChanged).toEqual([]);
    expect(d.relationshipsAdded).toEqual([]);
    expect(d.relationshipsRemoved).toEqual([]);
    expect(d.personsWithNewStructure).toEqual([]);
  });
});
