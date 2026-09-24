import { describe, it, expect } from "vitest";
import { dropDanglingEdges, describeDroppedEdges } from "../../src/utils/tree-graph.js";

// Issue #2747. The guard lifted out of person-read.ts so person_ancestors can
// share it rather than carry a second one-off (CLAUDE.md: one shared guard for
// the second instance of a class already fixed).

const ids = (...xs: string[]) => new Set(xs);

describe("dropDanglingEdges", () => {
  it("keeps an edge whose every endpoint is a returned person", () => {
    const rels = [{ type: "Couple", person1: "A", person2: "B" }];
    expect(dropDanglingEdges(rels, ids("A", "B"))).toEqual(rels);
  });

  it("drops an edge whose endpoint is not a returned person", () => {
    const rels = [{ type: "Couple", person1: "A", person2: "GHOST" }];
    expect(dropDanglingEdges(rels, ids("A", "B"))).toEqual([]);
  });

  it("checks all four endpoint keys, not just the Couple pair", () => {
    // The ParentChild spelling. Both keys must be examined or a leaked
    // parentage edge reaches project_create and fails the whole write.
    const kept = dropDanglingEdges([{ type: "ParentChild", parent: "A", child: "B" }], ids("A", "B"));
    expect(kept).toHaveLength(1);
    const dropped = dropDanglingEdges([{ type: "ParentChild", parent: "A", child: "GHOST" }], ids("A", "B"));
    expect(dropped).toEqual([]);
  });

  it("treats an absent endpoint as satisfied, not as a miss", () => {
    // A Couple carries no parent/child; those undefined keys must not drop it.
    expect(dropDanglingEdges([{ type: "Couple", person1: "A", person2: "B" }], ids("A", "B"))).toHaveLength(1);
  });

  it("never removes a person — it is filter-only", () => {
    // Guards the contract person_ancestors depends on: an ancestor whose
    // spouse is absent keeps their own entry; only the edge goes.
    const rels = [{ type: "Couple", person1: "A", person2: "GHOST" }];
    const kept = dropDanglingEdges(rels, ids("A"));
    expect(kept).toEqual([]);
    expect(rels).toHaveLength(1); // input untouched
  });

  it("compares bare ids — an absolute URL endpoint does not match a bare id", () => {
    // Why every caller must bare its endpoints BEFORE calling. This is the
    // failure mode, pinned: the person IS returned and the edge is still lost.
    const rels = [{ type: "Couple", person1: "https://api.familysearch.org/platform/tree/persons/A", person2: "B" }];
    expect(dropDanglingEdges(rels, ids("A", "B"))).toEqual([]);
  });
});

describe("describeDroppedEdges", () => {
  it("returns undefined when nothing was dropped", () => {
    const rels = [{ type: "Couple", person1: "A", person2: "B" }];
    expect(describeDroppedEdges(rels, rels)).toBeUndefined();
  });

  it("names the count and the per-type breakdown", () => {
    const before = [
      { type: "Couple", person1: "A", person2: "X" },
      { type: "Couple", person1: "A", person2: "Y" },
      { type: "ParentChild", parent: "A", child: "Z" },
    ];
    const note = describeDroppedEdges(before, []);
    expect(note).toMatch(/Dropped 3 relationship\(s\)/);
    expect(note).toMatch(/2 Couple/);
    expect(note).toMatch(/1 ParentChild/);
    expect(note).toMatch(/project_create/);
  });

  it("counts a typeless edge as `untyped` rather than interpolating undefined", () => {
    // SimplifiedRelationship.type is OPTIONAL — simplifyRelationship sets it
    // only when stripUri resolves. Interpolating undefined would emit
    // "1 undefined", and localeCompare on undefined throws outright.
    const note = describeDroppedEdges([{ person1: "A", person2: "GHOST" }], []);
    expect(note).toMatch(/1 untyped/);
    expect(note).not.toMatch(/undefined/);
  });

  it("sorts the breakdown so the sentence is stable across runs", () => {
    const before = [
      { type: "ParentChild", parent: "A", child: "Z" },
      { type: "Couple", person1: "A", person2: "X" },
    ];
    expect(describeDroppedEdges(before, [])).toMatch(/1 Couple, 1 ParentChild/);
  });
});
