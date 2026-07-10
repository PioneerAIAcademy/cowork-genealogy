import { describe, it, expect } from "vitest";

import { mergeGedcomx } from "../../src/utils/merge-gedcomx.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

/**
 * Assert the document is internally consistent: every relationship endpoint
 * resolves to a person, every source `ref` resolves to a source, and ids are
 * unique within each kind (person, source, fact, name).
 */
function assertIntegrity(doc: SimplifiedGedcomX): void {
  const personIds = new Set((doc.persons ?? []).map((p) => p.id));
  const sourceIds = new Set((doc.sources ?? []).map((s) => s.id));

  for (const rel of doc.relationships ?? []) {
    for (const ep of [rel.parent, rel.child, rel.person1, rel.person2]) {
      if (ep !== undefined) expect(personIds.has(ep)).toBe(true);
    }
    for (const sr of rel.sources ?? []) {
      if (sr.ref !== undefined) expect(sourceIds.has(sr.ref)).toBe(true);
    }
  }

  const factIds: (string | undefined)[] = [];
  const nameIds: (string | undefined)[] = [];
  const checkRefs = (srs?: { ref?: string }[]) => {
    for (const sr of srs ?? []) {
      if (sr.ref !== undefined) expect(sourceIds.has(sr.ref)).toBe(true);
    }
  };
  for (const p of doc.persons ?? []) {
    checkRefs(p.sources);
    for (const n of p.names ?? []) {
      nameIds.push(n.id);
      checkRefs(n.sources);
    }
    for (const f of p.facts ?? []) {
      factIds.push(f.id);
      checkRefs(f.sources);
    }
  }
  for (const r of doc.relationships ?? []) {
    for (const f of r.facts ?? []) factIds.push(f.id);
  }

  const personIdList = (doc.persons ?? []).map((p) => p.id);
  expect(new Set(personIdList).size).toBe(personIdList.length);
  const sourceIdList = (doc.sources ?? []).map((s) => s.id);
  expect(new Set(sourceIdList).size).toBe(sourceIdList.length);
  expect(new Set(factIds).size).toBe(factIds.length);
  expect(new Set(nameIds).size).toBe(nameIds.length);
}

// ────────────────────────────────────────────────────────────────────
// Block A: validation (spec §6.1, §8)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — validation", () => {
  const target: SimplifiedGedcomX = {
    persons: [{ id: "I1", names: [{ id: "N1", given: "Ann" }] }],
  };
  const candidate: SimplifiedGedcomX = {
    persons: [{ id: "I1", names: [{ id: "N1", given: "Ann" }] }],
  };

  it("throws when merges is empty", () => {
    expect(() => mergeGedcomx(target, candidate, [])).toThrow(/merges/i);
  });

  it("throws when a survivor id is not in the target", () => {
    expect(() => mergeGedcomx(target, candidate, [["I9", "I1"]])).toThrow(/I9/);
  });

  it("throws when a collapsed id is not in the candidate (mode 1)", () => {
    expect(() => mergeGedcomx(target, candidate, [["I1", "I9"]])).toThrow(/I9/);
  });

  it("throws when a survivor id appears in more than one pair (mode 2)", () => {
    const t: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }, { id: "I3" }],
    };
    expect(() =>
      mergeGedcomx(t, null, [
        ["I1", "I2"],
        ["I1", "I3"],
      ]),
    ).toThrow(/I1/);
  });

  it("throws on a merge chain — an id that is both survivor and collapsed (mode 2)", () => {
    const t: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }, { id: "I3" }],
    };
    expect(() =>
      mergeGedcomx(t, null, [
        ["I1", "I2"],
        ["I2", "I3"],
      ]),
    ).toThrow(/I2/);
  });

  it("throws when the target has no persons", () => {
    expect(() => mergeGedcomx({ persons: [] }, candidate, [["I1", "I1"]])).toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────
// Block B: mode-1 core — collapse, id remap, ark/gender, purity
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — mode 1 core", () => {
  it("collapses one pair: survivor id kept, facts unioned, colliding candidate fact id remapped", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1845" }] }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1", facts: [{ id: "F1", type: "Residence", standard_date: "1880" }] }],
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I1"]]);

    expect(out.persons).toHaveLength(1);
    const p = out.persons![0];
    expect(p.id).toBe("I1");
    expect((p.facts ?? []).map((f) => f.type).sort()).toEqual(["Birth", "Residence"]);
    const factIds = (p.facts ?? []).map((f) => f.id);
    expect(new Set(factIds).size).toBe(2); // no id collision
    const residence = p.facts!.find((f) => f.type === "Residence")!;
    expect(residence.id).not.toBe("F1"); // remapped off the target's F1
  });

  it("keeps the survivor's ark/gender on conflict, adopts the candidate's when the survivor has none", () => {
    const conflict = mergeGedcomx(
      { persons: [{ id: "I1", ark: "T-ARK", gender: "Male" }] },
      { persons: [{ id: "I1", ark: "C-ARK", gender: "Female" }] },
      [["I1", "I1"]],
    );
    expect(conflict.persons![0].ark).toBe("T-ARK");
    expect(conflict.persons![0].gender).toBe("Male");

    const adopt = mergeGedcomx(
      { persons: [{ id: "I1" }] },
      { persons: [{ id: "I1", ark: "C-ARK", gender: "Female" }] },
      [["I1", "I1"]],
    );
    expect(adopt.persons![0].ark).toBe("C-ARK");
    expect(adopt.persons![0].gender).toBe("Female");
  });

  it("does not mutate either input document (purity)", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1845" }] }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1", facts: [{ id: "F1", type: "Residence", standard_date: "1880" }] }],
    };
    const targetBefore = structuredClone(target);
    const candidateBefore = structuredClone(candidate);

    mergeGedcomx(target, candidate, [["I1", "I1"]]);

    expect(target).toEqual(targetBefore);
    expect(candidate).toEqual(candidateBefore);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block C: mode-1 relationships, sources, carry-over, integrity
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — mode 1 relationships / sources / carry-over", () => {
  it("repoints candidate relationships to survivors and drops exact duplicates", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    };

    const out = mergeGedcomx(target, candidate, [
      ["I1", "I1"],
      ["I2", "I2"],
    ]);

    const pc = (out.relationships ?? []).filter((r) => r.type === "ParentChild");
    expect(pc).toHaveLength(1);
    expect(pc[0]).toMatchObject({ parent: "I2", child: "I1" });
    assertIntegrity(out);
  });

  it("carries an unpaired candidate person in as a new relative with a fresh id", () => {
    const target: SimplifiedGedcomX = { persons: [{ id: "I1" }] };
    const candidate: SimplifiedGedcomX = {
      persons: [
        { id: "I1" },
        { id: "I2", names: [{ id: "N1", given: "Mary", surname: "Flynn" }] },
      ],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I1"]]);

    expect(out.persons).toHaveLength(2);
    const mary = out.persons!.find((p) =>
      (p.names ?? []).some((n) => n.given === "Mary"),
    )!;
    expect(mary).toBeDefined();
    expect(mary.id).not.toBe("I1");
    // the relationship now points parent → the carried person's fresh id
    const pc = (out.relationships ?? []).find((r) => r.type === "ParentChild")!;
    expect(pc.parent).toBe(mary.id);
    expect(pc.child).toBe("I1");
    assertIntegrity(out);
  });

  it("dedups sources by title and rewrites every source ref to the surviving id", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1", sources: [{ ref: "S1" }] }],
      sources: [{ id: "S1", title: "1850 Census" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          facts: [
            { id: "F1", type: "Residence", standard_date: "1880", sources: [{ ref: "S1" }] },
            { id: "F2", type: "Census", standard_date: "1885", sources: [{ ref: "S2" }] },
          ],
        },
      ],
      sources: [
        { id: "S1", title: "1850 Census" }, // same title → dedups to target's S1
        { id: "S2", title: "1880 Census" }, // distinct → carried with a fresh id
      ],
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I1"]]);

    expect((out.sources ?? []).map((s) => s.title).sort()).toEqual([
      "1850 Census",
      "1880 Census",
    ]);
    const byId = new Map((out.sources ?? []).map((s) => [s.id, s.title]));
    const p = out.persons![0];
    const residence = p.facts!.find((f) => f.type === "Residence")!;
    const census = p.facts!.find((f) => f.type === "Census")!;
    // refs resolve to the correct source (Residence → deduped 1850, Census → 1880)
    expect(byId.get(residence.sources![0].ref!)).toBe("1850 Census");
    expect(byId.get(census.sources![0].ref!)).toBe("1880 Census");
    assertIntegrity(out);
  });

  it("handles a full id collision across persons/names/facts/rels/sources with no dangling refs", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          ark: "T",
          gender: "Male",
          names: [{ id: "N1", preferred: true, given: "Patrick", surname: "Flynn" }],
          facts: [{ id: "F1", type: "Birth", standard_date: "1845", sources: [{ ref: "S1" }] }],
          sources: [{ ref: "S1" }],
        },
        { id: "I2", gender: "Male", names: [{ id: "N2", given: "Michael", surname: "Flynn" }] },
      ],
      relationships: [
        { id: "R1", type: "ParentChild", parent: "I2", child: "I1", sources: [{ ref: "S1" }] },
      ],
      sources: [{ id: "S1", title: "1850 Census" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "Patrick", surname: "Flynn" }],
          facts: [{ id: "F1", type: "Residence", standard_date: "1880", sources: [{ ref: "S1" }] }],
          sources: [{ ref: "S1" }],
        },
        { id: "I2", gender: "Male", names: [{ id: "N1", given: "Michael", surname: "Flynn" }] },
        { id: "I3", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Flynn" }] },
      ],
      relationships: [
        { id: "R1", type: "ParentChild", parent: "I2", child: "I1", sources: [{ ref: "S1" }] }, // dup
        { id: "R2", type: "ParentChild", parent: "I3", child: "I1" }, // new (mother)
        { id: "R3", type: "Couple", person1: "I2", person2: "I3" }, // new (parents)
      ],
      sources: [
        { id: "S1", title: "1850 Census" },
        { id: "S2", title: "1880 Census" },
      ],
    };

    const out = mergeGedcomx(target, candidate, [
      ["I1", "I1"],
      ["I2", "I2"],
    ]);

    assertIntegrity(out);
    expect(out.persons).toHaveLength(3); // I1, I2, carried Mary
    expect(out.relationships).toHaveLength(3); // PC(I2→I1), PC(Mary→I1), Couple(I2,Mary)
    expect((out.sources ?? []).map((s) => s.title).sort()).toEqual([
      "1850 Census",
      "1880 Census",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block D: name equivalence (spec §7.1)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — name equivalence", () => {
  function preferred(p: { names?: { preferred?: boolean }[] }) {
    return (p.names ?? []).filter((n) => n.preferred === true);
  }

  it("merges an initials/subset name into the fuller one and marks it preferred", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", names: [{ id: "N1", preferred: true, given: "J", surname: "Flynn" }] }] },
      { persons: [{ id: "I1", names: [{ id: "N1", given: "James", surname: "Flynn" }] }] },
      [["I1", "I1"]],
    );

    const p = out.persons![0];
    expect(p.names).toHaveLength(1);
    expect(p.names![0]).toMatchObject({ given: "James", surname: "Flynn", preferred: true });
  });

  it("keeps a genuinely different name as a distinct entry, with exactly one preferred", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", names: [{ id: "N1", preferred: true, given: "James", surname: "Flynn" }] }] },
      { persons: [{ id: "I1", names: [{ id: "N1", given: "Patrick", surname: "Murphy" }] }] },
      [["I1", "I1"]],
    );

    const p = out.persons![0];
    expect(p.names).toHaveLength(2);
    expect((p.names ?? []).map((n) => n.given).sort()).toEqual(["James", "Patrick"]);
    expect(preferred(p)).toHaveLength(1);
  });

  it("marks the most frequent name as preferred when one repeats across inputs", () => {
    const out = mergeGedcomx(
      {
        persons: [
          {
            id: "I1",
            names: [
              { id: "N1", given: "James", surname: "Flynn" },
              { id: "N2", given: "Jim", surname: "Flynn" },
            ],
          },
        ],
      },
      { persons: [{ id: "I1", names: [{ id: "N1", given: "James", surname: "Flynn" }] }] },
      [["I1", "I1"]],
    );

    const p = out.persons![0];
    expect(p.names).toHaveLength(2); // {James Flynn} ×2 collapse to one; {Jim Flynn} distinct
    const pref = preferred(p);
    expect(pref).toHaveLength(1);
    expect(pref[0].given).toBe("James");
  });
});

// ────────────────────────────────────────────────────────────────────
// Block E: fact equivalence + primary marking (spec §7.2)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — fact equivalence", () => {
  it("merges a less-specific birth into the more specific one, taking date+place, marked primary", () => {
    const out = mergeGedcomx(
      {
        persons: [
          {
            id: "I1",
            facts: [
              {
                id: "F1",
                type: "Birth",
                date: "1900",
                standard_date: "1900",
                place: "Utah",
                standard_place: "Utah, United States",
              },
            ],
          },
        ],
      },
      {
        persons: [
          {
            id: "I1",
            facts: [
              {
                id: "F1",
                type: "Birth",
                date: "10 Jan 1900",
                standard_date: "10 Jan 1900",
                place: "Provo, Utah",
                standard_place: "Provo, Utah, United States",
              },
            ],
          },
        ],
      },
      [["I1", "I1"]],
    );

    const births = (out.persons![0].facts ?? []).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(1);
    expect(births[0].standard_date).toBe("10 Jan 1900"); // most complete date
    expect(births[0].standard_place).toBe("Provo, Utah, United States"); // most specific place
    expect(births[0].primary).toBe(true);
  });

  it("keeps two conflicting births and marks exactly one (the better) as primary", () => {
    const out = mergeGedcomx(
      {
        persons: [
          { id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1900", standard_place: "Utah, United States" }] },
        ],
      },
      {
        persons: [
          { id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1888", standard_place: "Ohio, United States" }] },
        ],
      },
      [["I1", "I1"]],
    );

    const births = (out.persons![0].facts ?? []).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(2);
    expect(births.filter((f) => f.primary === true)).toHaveLength(1);
  });

  it("merges compatible residences, keeps distinct ones, and marks none primary (non-vital type)", () => {
    const out = mergeGedcomx(
      {
        persons: [
          { id: "I1", facts: [{ id: "F1", type: "Residence", standard_date: "1880", standard_place: "New York, United States" }] },
        ],
      },
      {
        persons: [
          {
            id: "I1",
            facts: [
              { id: "F1", type: "Residence", standard_date: "1880", standard_place: "Manhattan, New York, United States" },
              { id: "F2", type: "Residence", standard_date: "1900", standard_place: "Boston, Massachusetts, United States" },
            ],
          },
        ],
      },
      [["I1", "I1"]],
    );

    const res = (out.persons![0].facts ?? []).filter((f) => f.type === "Residence");
    expect(res).toHaveLength(2); // 1880 (merged, more specific place) + distinct 1900
    expect(res.some((f) => f.standard_place === "Manhattan, New York, United States")).toBe(true);
    expect(res.every((f) => f.primary !== true)).toBe(true);
  });

  it("preserves an existing primary when merging a non-vital group", () => {
    const out = mergeGedcomx(
      {
        persons: [
          { id: "I1", facts: [{ id: "F1", type: "Census", primary: true, standard_date: "1880", standard_place: "New York, United States" }] },
        ],
      },
      {
        persons: [
          { id: "I1", facts: [{ id: "F1", type: "Census", standard_date: "1880", standard_place: "Manhattan, New York, United States" }] },
        ],
      },
      [["I1", "I1"]],
    );

    const census = (out.persons![0].facts ?? []).filter((f) => f.type === "Census");
    expect(census).toHaveLength(1);
    expect(census[0].primary).toBe(true);
    expect(census[0].standard_place).toBe("Manhattan, New York, United States");
  });
});

// ────────────────────────────────────────────────────────────────────
// Block F: mode 2 — same-document merge (candidate = null)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — mode 2 (same document)", () => {
  it("folds one target person into another, removes it, and repoints relationships", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        { id: "I1", names: [{ id: "N1", given: "John", surname: "Doe" }], facts: [{ id: "F1", type: "Birth", standard_date: "1900" }] },
        { id: "I2", names: [{ id: "N2", given: "J", surname: "Doe" }], facts: [{ id: "F2", type: "Residence", standard_date: "1920" }] },
        { id: "I3" },
      ],
      relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I3" }],
    };

    const out = mergeGedcomx(target, null, [["I1", "I2"]]);

    expect(out.persons).toHaveLength(2);
    expect(out.persons!.some((p) => p.id === "I2")).toBe(false);
    const i1 = out.persons!.find((p) => p.id === "I1")!;
    expect((i1.facts ?? []).map((f) => f.type).sort()).toEqual(["Birth", "Residence"]);
    expect(i1.names).toHaveLength(1); // "J Doe" merged into "John Doe"
    const pc = out.relationships!.find((r) => r.type === "ParentChild")!;
    expect(pc.parent).toBe("I1");
    expect(pc.child).toBe("I3");
    assertIntegrity(out);
  });

  it("drops a relationship that becomes self-referential after the collapse", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }],
      relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }],
    };

    const out = mergeGedcomx(target, null, [["I1", "I2"]]);

    expect(out.persons).toHaveLength(1);
    expect(out.relationships ?? []).toHaveLength(0);
    assertIntegrity(out);
  });

  it("does not mutate the input document (mode 2 purity)", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        { id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1900" }] },
        { id: "I2", facts: [{ id: "F2", type: "Death", standard_date: "1970" }] },
      ],
      relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }],
    };
    const before = structuredClone(target);

    mergeGedcomx(target, null, [["I1", "I2"]]);

    expect(target).toEqual(before);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block G: robustness — source-ref dedup, rel-fact merge, places, disjoint ids
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — robustness", () => {
  it("does not fold candidate person-level source refs — they are not tree format (spec §6.3)", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }],
      sources: [{ id: "S1", title: "Census" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1", sources: [{ ref: "S1" }] }],
      sources: [{ id: "S1", title: "Census" }], // same title → same source
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I1"]]);

    // The tool layer strips person-level sources before merging; the core
    // must not re-introduce them from an unsanitized candidate either.
    expect(out.persons![0].sources).toBeUndefined();
    assertIntegrity(out);
  });

  it("merges a duplicate couple's marriage fact into the kept relationship (never drops facts)", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }],
      relationships: [{ id: "R1", type: "Couple", person1: "I1", person2: "I2" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }],
      relationships: [
        {
          id: "R1",
          type: "Couple",
          person1: "I1",
          person2: "I2",
          facts: [{ id: "F1", type: "Marriage", standard_date: "1870" }],
        },
      ],
    };

    const out = mergeGedcomx(target, candidate, [
      ["I1", "I1"],
      ["I2", "I2"],
    ]);

    const couples = (out.relationships ?? []).filter((r) => r.type === "Couple");
    expect(couples).toHaveLength(1);
    expect((couples[0].facts ?? []).some((f) => f.type === "Marriage")).toBe(true);
    assertIntegrity(out);
  });

  it("does not carry candidate places — the tree format has no places[] section (spec §6.7)", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }],
      places: [{ id: "PL1", name: "Ireland" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [{ id: "I1" }],
      places: [{ id: "PL1", name: "New York" }],
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I1"]]);

    // A legacy target's own places pass through untouched; the candidate's
    // never enter (the tool layer also strips them before the merge).
    expect((out.places ?? []).map((p) => p.name)).toEqual(["Ireland"]);
  });

  it("handles disjoint ids (no collision) with full referential integrity (spec §9)", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        {
          id: "I1",
          names: [{ id: "N1", given: "Pat", surname: "Flynn" }],
          facts: [{ id: "F1", type: "Birth", standard_date: "1845" }],
          sources: [{ ref: "S1" }],
        },
      ],
      sources: [{ id: "S1", title: "A" }],
    };
    const candidate: SimplifiedGedcomX = {
      persons: [
        {
          id: "I5",
          facts: [{ id: "F5", type: "Death", standard_date: "1910", sources: [{ ref: "S5" }] }],
          sources: [{ ref: "S5" }],
        },
      ],
      sources: [{ id: "S5", title: "B" }],
    };

    const out = mergeGedcomx(target, candidate, [["I1", "I5"]]);

    assertIntegrity(out);
    expect(out.persons).toHaveLength(1);
    expect((out.persons![0].facts ?? []).map((f) => f.type).sort()).toEqual(["Birth", "Death"]);
    expect((out.sources ?? []).map((s) => s.title).sort()).toEqual(["A", "B"]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block H: adversarial edge cases (probe the riskiest paths)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — adversarial edge cases", () => {
  it("merges focus + father + mother in one call (3 pairs, spec §9 multi-pair)", () => {
    const tree = (): SimplifiedGedcomX => ({
      persons: [
        { id: "I1", names: [{ id: "N1", given: "Pat", surname: "Flynn" }] },
        { id: "I2", gender: "Male", names: [{ id: "N2", given: "Mike", surname: "Flynn" }] },
        { id: "I3", gender: "Female", names: [{ id: "N3", given: "Mary", surname: "Flynn" }] },
      ],
      relationships: [
        { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
        { id: "R2", type: "ParentChild", parent: "I3", child: "I1" },
        { id: "R3", type: "Couple", person1: "I2", person2: "I3" },
      ],
    });

    const out = mergeGedcomx(tree(), tree(), [
      ["I1", "I1"],
      ["I2", "I2"],
      ["I3", "I3"],
    ]);

    expect(out.persons).toHaveLength(3); // nobody carried — all three paired
    expect(out.relationships).toHaveLength(3); // duplicates collapsed
    assertIntegrity(out);
  });

  it("never leaves two primaries of the same vital type, even when both inputs were primary", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", primary: true, standard_date: "1900" }] }] },
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", primary: true, standard_date: "1888" }] }] },
      [["I1", "I1"]],
    );
    const births = (out.persons![0].facts ?? []).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(2); // distinct → both kept
    expect(births.filter((f) => f.primary === true)).toHaveLength(1); // exactly one
  });

  it("marks a lone vital fact primary even when nothing was merged into it", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1900" }] }] },
      { persons: [{ id: "I1", names: [{ id: "N1", given: "Pat", surname: "Flynn" }] }] },
      [["I1", "I1"]],
    );
    const births = (out.persons![0].facts ?? []).filter((f) => f.type === "Birth");
    expect(births).toHaveLength(1);
    expect(births[0].primary).toBe(true);
  });

  it("does NOT merge births that differ at month precision (Jan vs Feb)", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "Jan 1900" }] }] },
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "Feb 1900" }] }] },
      [["I1", "I1"]],
    );
    expect((out.persons![0].facts ?? []).filter((f) => f.type === "Birth")).toHaveLength(2);
  });

  it("does NOT merge facts whose places share only the country", () => {
    const out = mergeGedcomx(
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Residence", standard_date: "1880", standard_place: "Ohio, United States" }] }] },
      { persons: [{ id: "I1", facts: [{ id: "F1", type: "Residence", standard_date: "1880", standard_place: "Utah, United States" }] }] },
      [["I1", "I1"]],
    );
    expect((out.persons![0].facts ?? []).filter((f) => f.type === "Residence")).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────
// Block I: id uniqueness when source arrays reuse ids ("unique within
// their array" → two arrays can both hold F1/N1; merging must not collide)
// ────────────────────────────────────────────────────────────────────

describe("mergeGedcomx — id uniqueness under same-id arrays", () => {
  it("mode 2: collapsing two persons that each have a fact 'F1' yields unique fact ids", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        { id: "I1", facts: [{ id: "F1", type: "Birth", standard_date: "1900" }] },
        { id: "I2", facts: [{ id: "F1", type: "Death", standard_date: "1970" }] },
      ],
    };

    const out = mergeGedcomx(target, null, [["I1", "I2"]]);

    expect((out.persons![0].facts ?? []).map((f) => f.type).sort()).toEqual(["Birth", "Death"]);
    assertIntegrity(out); // would fail if both kept id "F1"
  });

  it("mode 2: collapsing two persons that each have a name 'N1' yields unique name ids", () => {
    const target: SimplifiedGedcomX = {
      persons: [
        { id: "I1", names: [{ id: "N1", given: "John", surname: "Doe" }] },
        { id: "I2", names: [{ id: "N1", given: "Jane", surname: "Roe" }] },
      ],
    };

    const out = mergeGedcomx(target, null, [["I1", "I2"]]);

    expect(out.persons![0].names).toHaveLength(2);
    assertIntegrity(out); // would fail if both kept id "N1"
  });

  it("dedup fold: two duplicate couples whose marriage facts share id 'F9' stay unique", () => {
    const target: SimplifiedGedcomX = {
      persons: [{ id: "I1" }, { id: "I2" }, { id: "I3" }],
      relationships: [
        { id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [{ id: "F9", type: "Marriage", standard_date: "1870", standard_place: "Utah, United States" }] },
        { id: "R2", type: "Couple", person1: "I1", person2: "I3", facts: [{ id: "F9", type: "Marriage", standard_date: "1888", standard_place: "Ohio, United States" }] },
      ],
    };

    // collapse I3 into I2 → R2 becomes Couple(I1,I2) == R1 → its marriage fact folds in
    const out = mergeGedcomx(target, null, [["I2", "I3"]]);

    const couples = (out.relationships ?? []).filter((r) => r.type === "Couple");
    expect(couples).toHaveLength(1);
    expect((couples[0].facts ?? []).filter((f) => f.type === "Marriage")).toHaveLength(2); // non-equivalent → both kept
    assertIntegrity(out); // would fail if both kept id "F9"
  });
});
