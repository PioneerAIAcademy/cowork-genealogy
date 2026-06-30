import { describe, it, expect } from "vitest";
import {
  gatherRelatives,
  pairRole,
  preScore,
  selectRelativePairs,
  PRE_SCORE_FLOOR,
  MAX_PAIR_CALLS,
} from "../../src/utils/relatives.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../../src/types/gedcomx.js";

// ─── Builders ────────────────────────────────────────────────────────────────

function person(
  id: string,
  given: string,
  opts: { surname?: string; gender?: string; birthYear?: string } = {},
): SimplifiedPerson {
  const p: SimplifiedPerson = {
    id,
    names: [{ preferred: true, given, surname: opts.surname ?? "Smith" }],
  };
  if (opts.gender) p.gender = opts.gender;
  if (opts.birthYear !== undefined) {
    p.facts = [{ type: "Birth", standard_date: opts.birthYear }];
  }
  return p;
}

// ─── preScore ────────────────────────────────────────────────────────────────

describe("preScore", () => {
  it("hard-gates to 0 on a gender mismatch", () => {
    const t = person("t", "Mary", { gender: "Female", birthYear: "1812" });
    const c = person("c", "Mary", { gender: "Male", birthYear: "1812" });
    expect(preScore(t, c)).toBe(0);
  });

  it("does not gate when one side's gender is missing", () => {
    const t = person("t", "Mary", { gender: "Female", birthYear: "1812" });
    const c = person("c", "Mary", { birthYear: "1812" });
    expect(preScore(t, c)).toBeGreaterThan(PRE_SCORE_FLOOR);
  });

  it("scores an identical name + year near 1", () => {
    const t = person("t", "John", { birthYear: "1815" });
    const c = person("c", "John", { birthYear: "1815" });
    expect(preScore(t, c)).toBeCloseTo(1.0);
  });

  it("uses neutral 0.5 year score when a birth year is missing on either side", () => {
    // Identical names → nameScore 1; one side missing year → yearScore 0.5.
    // preScore = 0.6*1 + 0.4*0.5 = 0.8
    const t = person("t", "John", { birthYear: "1815" });
    const c = person("c", "John");
    expect(preScore(t, c)).toBeCloseTo(0.8);
  });

  it("decays the year score with distance and floors it at YEAR_TOLERANCE", () => {
    const t = person("t", "John", { birthYear: "1800" });
    const near = person("c", "John", { birthYear: "1805" }); // 5 yrs → yearScore 0.5
    const far = person("c", "John", { birthYear: "1820" }); // 20 yrs → yearScore 0
    expect(preScore(t, near)).toBeCloseTo(0.6 * 1 + 0.4 * 0.5);
    expect(preScore(t, far)).toBeCloseTo(0.6 * 1 + 0.4 * 0);
  });

  it("parses the year from a full standard_date string", () => {
    const t = person("t", "John", { birthYear: "+1815-06-15" });
    const c = person("c", "John", { birthYear: "15 Jun 1815" });
    expect(preScore(t, c)).toBeCloseTo(1.0);
  });
});

// ─── Greedy per-role pairing ─────────────────────────────────────────────────

describe("pairRole", () => {
  it("reproduces the issue's Bob/Robert example: 3 pairs, not 9", () => {
    const targets = [
      person("t-bob", "Bob", { birthYear: "1810" }),
      person("t-mary", "Mary", { birthYear: "1812" }),
      person("t-john", "John", { birthYear: "1815" }),
    ];
    const candidates = [
      person("c-robert", "Robert", { birthYear: "1810" }),
      person("c-mary", "Mary", { birthYear: "1813" }),
      person("c-john", "John", { birthYear: "1816" }),
    ];
    const pairs = pairRole("child", targets, candidates);
    const ids = pairs.map((p) => [p.target.id, p.candidate.id]).sort();
    expect(ids).toEqual(
      [
        ["t-bob", "c-robert"],
        ["t-john", "c-john"],
        ["t-mary", "c-mary"],
      ].sort(),
    );
  });

  it("assigns at most min(N, M) pairs on unequal counts", () => {
    const targets = [
      person("t1", "Bob", { birthYear: "1810" }),
      person("t2", "Mary", { birthYear: "1812" }),
      person("t3", "John", { birthYear: "1815" }),
    ];
    const candidates = [
      person("c1", "Bob", { birthYear: "1810" }),
      person("c2", "Mary", { birthYear: "1812" }),
    ];
    const pairs = pairRole("child", targets, candidates);
    expect(pairs).toHaveLength(2);
    // Each target/candidate used at most once.
    expect(new Set(pairs.map((p) => p.target.id)).size).toBe(2);
    expect(new Set(pairs.map((p) => p.candidate.id)).size).toBe(2);
  });

  it("drops a pair that falls below the floor", () => {
    const targets = [person("t", "Bob", { surname: "Aaaa", birthYear: "1700" })];
    const candidates = [person("c", "Mary", { surname: "Zzzz", birthYear: "1899" })];
    expect(pairRole("child", targets, candidates)).toHaveLength(0);
  });

  it("never pairs across a gender conflict", () => {
    const targets = [person("t", "Frances", { gender: "Female", birthYear: "1812" })];
    const candidates = [person("c", "Francis", { gender: "Male", birthYear: "1812" })];
    expect(pairRole("spouse", targets, candidates)).toHaveLength(0);
  });

  it("returns nothing when a role has relatives on only one side", () => {
    const targets = [person("t", "Bob", { birthYear: "1810" })];
    expect(pairRole("parent", targets, [])).toHaveLength(0);
    expect(pairRole("parent", [], targets)).toHaveLength(0);
  });

  it("produces deterministic output regardless of input order", () => {
    const a = pairRole(
      "child",
      [person("t1", "Bob", { birthYear: "1810" }), person("t2", "Bob", { birthYear: "1810" })],
      [person("c1", "Bob", { birthYear: "1810" }), person("c2", "Bob", { birthYear: "1810" })],
    );
    const b = pairRole(
      "child",
      [person("t2", "Bob", { birthYear: "1810" }), person("t1", "Bob", { birthYear: "1810" })],
      [person("c2", "Bob", { birthYear: "1810" }), person("c1", "Bob", { birthYear: "1810" })],
    );
    expect(a.map((p) => [p.target.id, p.candidate.id])).toEqual(
      b.map((p) => [p.target.id, p.candidate.id]),
    );
  });
});

// ─── Relative gathering ──────────────────────────────────────────────────────

describe("gatherRelatives", () => {
  const gedcomx: SimplifiedGedcomX = {
    persons: [
      person("FOCUS", "Focus"),
      person("DAD", "Dad"),
      person("MOM", "Mom"),
      person("WIFE", "Wife"),
      person("KID1", "Kid1"),
      person("KID2", "Kid2"),
      person("GHOST", "Ghost"), // referenced but we'll point at a missing id
    ],
    relationships: [
      { type: "ParentChild", parent: "DAD", child: "FOCUS" },
      { type: "ParentChild", parent: "MOM", child: "FOCUS" },
      { type: "Couple", person1: "FOCUS", person2: "WIFE" },
      { type: "ParentChild", parent: "FOCUS", child: "KID1" },
      { type: "ParentChild", parent: "FOCUS", child: "KID2" },
      { type: "ParentChild", parent: "FOCUS", child: "MISSING" }, // not in persons[]
    ],
  };

  it("collects parents, spouses, and children of the focus person", () => {
    const r = gatherRelatives(gedcomx, "FOCUS");
    expect(r.parent.map((p) => p.id).sort()).toEqual(["DAD", "MOM"]);
    expect(r.spouse.map((p) => p.id)).toEqual(["WIFE"]);
    expect(r.child.map((p) => p.id).sort()).toEqual(["KID1", "KID2"]);
  });

  it("resolves the spouse regardless of person1/person2 ordering", () => {
    const flipped: SimplifiedGedcomX = {
      persons: gedcomx.persons,
      relationships: [{ type: "Couple", person1: "WIFE", person2: "FOCUS" }],
    };
    expect(gatherRelatives(flipped, "FOCUS").spouse.map((p) => p.id)).toEqual(["WIFE"]);
  });

  it("skips relationship ids absent from persons[]", () => {
    const r = gatherRelatives(gedcomx, "FOCUS");
    expect(r.child.map((p) => p.id)).not.toContain("MISSING");
  });
});

// ─── selectRelativePairs (cap behavior) ──────────────────────────────────────

describe("selectRelativePairs", () => {
  it("caps total pairs at MAX_PAIR_CALLS and reports the dropped count", () => {
    // 40 identical children on each side → 40 candidate pairs, capped to 30.
    const persons: SimplifiedPerson[] = [person("F1", "Focus"), person("F2", "Focus")];
    const rels1 = [];
    const rels2 = [];
    for (let i = 0; i < 40; i++) {
      const t = `T${i}`;
      const c = `C${i}`;
      persons.push(person(t, "Kid", { birthYear: "1850" }));
      persons.push(person(c, "Kid", { birthYear: "1850" }));
      rels1.push({ type: "ParentChild", parent: "F1", child: t });
      rels2.push({ type: "ParentChild", parent: "F2", child: c });
    }
    const g1: SimplifiedGedcomX = { persons, relationships: rels1 };
    const g2: SimplifiedGedcomX = { persons, relationships: rels2 };
    const { pairs, droppedForCap } = selectRelativePairs(g1, "F1", g2, "F2");
    expect(pairs).toHaveLength(MAX_PAIR_CALLS);
    expect(droppedForCap).toBe(40 - MAX_PAIR_CALLS);
  });

  it("reports droppedForCap 0 for a small household", () => {
    const g1: SimplifiedGedcomX = {
      persons: [person("F1", "Focus"), person("K1", "Bob", { birthYear: "1810" })],
      relationships: [{ type: "ParentChild", parent: "F1", child: "K1" }],
    };
    const g2: SimplifiedGedcomX = {
      persons: [person("F2", "Focus"), person("K2", "Bob", { birthYear: "1810" })],
      relationships: [{ type: "ParentChild", parent: "F2", child: "K2" }],
    };
    const { pairs, droppedForCap } = selectRelativePairs(g1, "F1", g2, "F2");
    expect(pairs).toHaveLength(1);
    expect(droppedForCap).toBe(0);
  });
});
