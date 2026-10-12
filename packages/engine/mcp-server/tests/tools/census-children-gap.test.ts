import { describe, it, expect } from "vitest";
import { censusChildrenGap } from "../../src/tools/census-children-gap.js";
import type {
  CensusChildrenGapInput,
  CensusChildrenGapResult,
  KnownChild,
} from "../../src/types/census-children-gap.js";

function ok(r: CensusChildrenGapResult) {
  if (!r.ok) throw new Error(`expected ok, got errors: ${r.errors.join("; ")}`);
  return r;
}

function kinds(r: ReturnType<typeof ok>) {
  return Object.fromEntries(r.missing.map((g) => [g.kind, g.count]));
}

// ut_init_project_q4v's family: five children born before 1900, all living,
// plus William b. 1906.
const MERCER: CensusChildrenGapInput = {
  censuses: [
    { year: 1900, childrenBorn: 6, childrenLiving: 5 },
    { year: 1910, childrenBorn: 8, childrenLiving: 7 },
  ],
  knownChildren: [
    { name: "Child 1", birthDate: "1886" },
    { name: "Child 2", birthDate: "1888" },
    { name: "Child 3", birthDate: "1891" },
    { name: "Child 4", birthDate: "1894" },
    { name: "Child 5", birthDate: "1897" },
    { name: "William", birthDate: "1906" },
  ],
};

// ut_init_project_wm7's family.
const BRANNON: CensusChildrenGapInput = {
  censuses: [
    { year: 1900, childrenBorn: 3, childrenLiving: 3 },
    { year: 1910, childrenBorn: 4, childrenLiving: 4 },
  ],
  knownChildren: [
    { name: "James", birthDate: "1892" },
    { name: "Catherine", birthDate: "1895" },
    { name: "Thomas", birthDate: "1904" },
  ],
};

// mulberry32: stays in 32-bit integers, so the sequence does not degrade.
function makeRand(initial: number) {
  let seed = initial;
  return (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

describe("census_children_gap", () => {
  it("Mercer: one child dead before 1900 and one living child born between the censuses", () => {
    const r = ok(censusChildrenGap(MERCER));
    expect(r.totalMissing).toBe(2);
    expect(r.conflicts).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(kinds(r)).toEqual({ died_before_1900: 1, born_between_living_1910: 1 });
    const dead = r.missing.find((g) => g.kind === "died_before_1900")!;
    expect(dead).toMatchObject({ bornAfter: null, bornOnOrBefore: "1900-06-01", status1900: "dead" });
    const living = r.missing.find((g) => g.kind === "born_between_living_1910")!;
    expect(living).toMatchObject({ bornAfter: "1900-06-01", bornOnOrBefore: "1910-04-15", status1910: "living" });
  });

  it("Brannon: one living child missing at both censuses is one child, not two", () => {
    const r = ok(censusChildrenGap(BRANNON));
    expect(r.totalMissing).toBe(1);
    expect(kinds(r)).toEqual({ living_1900_and_1910: 1 });
    expect(r.missing[0]).toMatchObject({ bornAfter: null, bornOnOrBefore: "1900-06-01" });
    expect(r.unresolved).toEqual([]);
  });

  it("never bounds a window by a sibling's birth", () => {
    const r = ok(censusChildrenGap(MERCER));
    const bounds = r.missing.flatMap((g) => [g.bornAfter, g.bornOnOrBefore]).filter(Boolean);
    for (const b of bounds) expect(["1900-06-01", "1910-04-15"]).toContain(b);
    for (const g of r.missing) expect(g.description).not.toMatch(/18[89]\d|190[1-9]/);
  });

  it("reports pairs the counts cannot settle as unresolved, with exact minimums", () => {
    // 1900: 1 living missing. 1910: 1 dead missing and 1 living missing. Either the
    // 1900 child died and a later child lives, or the 1900 child lives and a later
    // child died.
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 2, childrenLiving: 2 },
          { year: 1910, childrenBorn: 3, childrenLiving: 2 },
        ],
        knownChildren: [{ name: "A", birthDate: "1895" }],
      }),
    );
    expect(r.missing).toEqual([]);
    expect(r.unresolved.map((u) => u.count)).toEqual([1, 1]);
    expect(r.unresolved[0]).toMatchObject({ bornOnOrBefore: "1900-06-01", status1900: "living", status1910: "unknown" });
    expect(r.unresolved[1]).toMatchObject({ bornAfter: "1900-06-01", bornOnOrBefore: "1910-04-15", status1910: "unknown" });
    expect(r.totalMissing).toBe(2);
  });

  it("1900 only", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [{ year: 1900, childrenBorn: 5, childrenLiving: 3 }],
        knownChildren: [{ birthDate: "1890" }, { birthDate: "1893", deathDate: "1895-02" }],
      }),
    );
    expect(r.censusesUsed).toEqual([1900]);
    expect(kinds(r)).toEqual({ died_before_1900: 1, living_1900: 2 });
    expect(r.totalMissing).toBe(3);
  });

  it("1910 only", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [{ year: 1910, childrenBorn: 4, childrenLiving: 3 }],
        knownChildren: [{ birthDate: "1901" }, { birthDate: "1905" }],
      }),
    );
    expect(kinds(r)).toEqual({ dead_by_1910: 1, living_1910: 1 });
    expect(r.missing[0]).toMatchObject({ bornAfter: null, bornOnOrBefore: "1910-04-15", status1900: "unknown" });
  });

  it("known dead exceeding the census dead is a conflict, not an answer", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [{ year: 1900, childrenBorn: 3, childrenLiving: 3 }],
        knownChildren: [{ name: "A", birthDate: "1890", deathDate: "1892" }],
      }),
    );
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].census).toBe(1900);
    expect(r.missing).toEqual([]);
    expect(r.totalMissing).toBeNull();
  });

  it("a known child dying between the censuses can make the counts infeasible", () => {
    // None of the census-level checks fires here: the infeasibility only shows in
    // the missing counts (missing dead 1 in 1900, 0 in 1910).
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 2, childrenLiving: 1 },
          { year: 1910, childrenBorn: 2, childrenLiving: 1 },
        ],
        knownChildren: [{ name: "A", birthDate: "1890", deathDate: "1905" }],
      }),
    );
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.conflicts.some((c) => /still be dead in 1910/.test(c.message))).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.totalMissing).toBeNull();
  });

  it("a child counted in 1900 must still be counted in 1910", () => {
    // Census-level counts are consistent (born and dead both grow), but 1900 leaves
    // two missing children and 1910 leaves room for only one.
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 2, childrenLiving: 2 },
          { year: 1910, childrenBorn: 3, childrenLiving: 3 },
        ],
        knownChildren: [{ birthDate: "1905" }, { birthDate: "1907" }],
      }),
    );
    expect(r.conflicts.map((c) => c.message).join(" ")).toMatch(/still be counted in 1910/);
    expect(r.missing).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.totalMissing).toBeNull();
  });

  it("flags census-level contradictions", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 5, childrenLiving: 2 },
          { year: 1910, childrenBorn: 4, childrenLiving: 3 },
        ],
      }),
    );
    expect(r.conflicts.map((c) => c.message).join(" ")).toMatch(/fewer than the 5/);
    expect(r.conflicts.map((c) => c.message).join(" ")).toMatch(/dead count only grows/);
  });

  it("a year-only birth in the census year cannot be placed; a month can", () => {
    const coarse = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 2, childrenLiving: 2 },
          { year: 1910, childrenBorn: 2, childrenLiving: 2 },
        ],
        knownChildren: [{ name: "A", birthDate: "1895" }, { name: "B", birthDate: "1900" }],
      }),
    );
    expect(coarse.undetermined).toEqual([expect.objectContaining({ census: 1900, child: "B" })]);
    expect(coarse.censusesUsed).toEqual([1910]);
    expect(coarse.totalMissing).toBe(0);

    const fine = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 2, childrenLiving: 2 },
          { year: 1910, childrenBorn: 2, childrenLiving: 2 },
        ],
        knownChildren: [{ name: "A", birthDate: "1895" }, { name: "B", birthDate: "1900-03" }],
      }),
    );
    expect(fine.undetermined).toEqual([]);
    expect(fine.censusesUsed).toEqual([1900, 1910]);
  });

  it("a death before the census day places a year-only birth in the census year", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 0 }],
        knownChildren: [{ name: "Infant", birthDate: "1900", deathDate: "1900-03-10" }],
      }),
    );
    expect(r.undetermined).toEqual([]);
    expect(r.censusesUsed).toEqual([1900]);
    expect(r.totalMissing).toBe(0);
  });

  it("an undetermined census still reports what the placed children prove", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 1, childrenLiving: 1 },
          { year: 1910, childrenBorn: 2, childrenLiving: 1 },
        ],
        knownChildren: [
          { name: "A", birthDate: "1890", deathDate: "1895" },
          { name: "B", birthDate: "1900" },
        ],
      }),
    );
    expect(r.undetermined.map((u) => u.census)).toEqual([1900]);
    expect(r.conflicts).toEqual([
      expect.objectContaining({ census: 1900, message: expect.stringMatching(/at least 1 of her children dead/) }),
    ]);
    expect(r.totalMissing).toBeNull();
  });

  it("never quotes a negative count once a census has already conflicted", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [
          { year: 1900, childrenBorn: 3, childrenLiving: 3 },
          { year: 1910, childrenBorn: 3, childrenLiving: 3 },
        ],
        knownChildren: [
          { birthDate: "1890", deathDate: "1892" },
          { birthDate: "1891", deathDate: "1905" },
        ],
      }),
    );
    expect(r.conflicts.length).toBeGreaterThan(0);
    for (const c of r.conflicts) expect(c.message).not.toMatch(/(^|[^\d])-\d/);
    expect(r.conflicts.every((c) => c.census !== "both")).toBe(true);
  });

  it("in the census month a month is not enough; the day is", () => {
    const census = [{ year: 1910 as const, childrenBorn: 1, childrenLiving: 1 }];
    const month = ok(censusChildrenGap({ censuses: census, knownChildren: [{ birthDate: "1910-04" }] }));
    expect(month.undetermined).toHaveLength(1);
    const day = ok(censusChildrenGap({ censuses: census, knownChildren: [{ birthDate: "1910-04-10" }] }));
    expect(day.undetermined).toEqual([]);
    expect(day.totalMissing).toBe(0);
  });

  it("applies the Gregorian leap rule", () => {
    const census = [{ year: 1910 as const, childrenBorn: 1, childrenLiving: 1 }];
    expect(censusChildrenGap({ censuses: census, knownChildren: [{ birthDate: "1900-02-29" }] }).ok).toBe(false);
    expect(censusChildrenGap({ censuses: census, knownChildren: [{ birthDate: "1896-02-29" }] }).ok).toBe(true);
  });

  it("places the census day itself: born on it counts, died on it is living", () => {
    const r = ok(
      censusChildrenGap({
        censuses: [{ year: 1900, childrenBorn: 2, childrenLiving: 2 }],
        knownChildren: [
          { birthDate: "1900-06-01" },
          { birthDate: "1898", deathDate: "1900-06-01" },
        ],
      }),
    );
    expect(r.totalMissing).toBe(0);
    expect(r.conflicts).toEqual([]);
  });

  it("records the no-death-date assumption", () => {
    const r = ok(censusChildrenGap(BRANNON));
    expect(r.assumptions.some((a) => a.startsWith("James has no death date"))).toBe(true);
  });

  it("ignores an injected projectPath", () => {
    const r = censusChildrenGap({ ...BRANNON, projectPath: "/tmp/x" } as CensusChildrenGapInput);
    expect(r.ok).toBe(true);
  });

  describe("malformed input is ok:false", () => {
    const cases: Array<[string, unknown]> = [
      ["no censuses", {}],
      ["empty censuses", { censuses: [] }],
      ["three censuses", { censuses: [1, 2, 3].map(() => ({ year: 1900, childrenBorn: 1, childrenLiving: 1 })) }],
      ["wrong year", { censuses: [{ year: 1890, childrenBorn: 1, childrenLiving: 1 }] }],
      ["duplicate year", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }, { year: 1900, childrenBorn: 1, childrenLiving: 1 }] }],
      ["fractional count", { censuses: [{ year: 1900, childrenBorn: 1.5, childrenLiving: 1 }] }],
      ["negative count", { censuses: [{ year: 1900, childrenBorn: -1, childrenLiving: 0 }] }],
      ["string count", { censuses: [{ year: 1900, childrenBorn: "3", childrenLiving: 1 }] }],
      ["living exceeds born", { censuses: [{ year: 1900, childrenBorn: 2, childrenLiving: 3 }] }],
      ["knownChildren not array", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }], knownChildren: "x" }],
      ["missing birthDate", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }], knownChildren: [{ name: "A" }] }],
      ["bad date", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }], knownChildren: [{ birthDate: "1890-02-30" }] }],
      ["bad format", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }], knownChildren: [{ birthDate: "abt 1890" }] }],
      ["death before birth", { censuses: [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }], knownChildren: [{ birthDate: "1890", deathDate: "1889" }] }],
    ];
    for (const [label, input] of cases) {
      it(label, () => {
        const r = censusChildrenGap(input as CensusChildrenGapInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
      });
    }
  });

  it("property: counts derived from a real family are never a conflict", () => {
    const rand = makeRand(67890);
    // Includes census-day births and deaths, and a year-only birth placed by its death.
    const ARCH: KnownChild[] = [
      { birthDate: "1890", deathDate: "1895" }, { birthDate: "1890", deathDate: "1905" }, { birthDate: "1890" },
      { birthDate: "1905", deathDate: "1907" }, { birthDate: "1905" }, { birthDate: "1912" },
      { birthDate: "1900-06-01" }, { birthDate: "1898", deathDate: "1900-06-01" },
      { birthDate: "1910-04-15" }, { birthDate: "1902", deathDate: "1910-04-15" },
      { birthDate: "1900", deathDate: "1900-03-10" },
    ];
    const latest = (d: string) => d.padEnd(10, "-12-31");
    const earliest = (d: string) => d.padEnd(10, "-01-01");
    const diedBefore = (c: KnownChild, day: string) => !!c.deathDate && latest(c.deathDate) < day;
    const bornBy = (c: KnownChild, day: string) => latest(c.birthDate) <= day || diedBefore(c, day);
    const livingOn = (c: KnownChild, day: string) =>
      bornBy(c, day) && (!c.deathDate || earliest(c.deathDate) >= day);
    const count = (fam: KnownChild[], year: 1900 | 1910, day: string) => ({
      year,
      childrenBorn: fam.filter((c) => bornBy(c, day)).length,
      childrenLiving: fam.filter((c) => livingOn(c, day)).length,
    });
    let unresolvedSeen = 0;
    for (let i = 0; i < 3000; i++) {
      const fam = Array.from({ length: 1 + rand(5) }, () => ARCH[rand(ARCH.length)]);
      const known = fam.filter(() => rand(2) === 0);
      const r = ok(
        censusChildrenGap({
          censuses: [count(fam, 1900, "1900-06-01"), count(fam, 1910, "1910-04-15")],
          knownChildren: known,
        }),
      );
      expect(r.conflicts).toEqual([]);
      expect(r.undetermined).toEqual([]);
      expect(r.totalMissing).toBe(
        fam.filter((c) => bornBy(c, "1910-04-15")).length - known.filter((c) => bornBy(c, "1910-04-15")).length,
      );
      if (r.unresolved.length > 0) unresolvedSeen++;
    }
    expect(unresolvedSeen).toBeGreaterThan(10);
  });

  it("property: arbitrary valid input is either a conflict or a non-negative, summing answer", () => {
    const rand = makeRand(12345);
    let unresolvedSeen = 0;
    const years = [1885, 1890, 1895, 1899, 1902, 1905, 1909, 1912];
    let feasible = 0;
    for (let i = 0; i < 3000; i++) {
      const born0 = rand(6);
      const born1 = rand(8);
      const censuses = [
        { year: 1900 as const, childrenBorn: born0, childrenLiving: rand(born0 + 1) },
        { year: 1910 as const, childrenBorn: born1, childrenLiving: rand(born1 + 1) },
      ].filter(() => rand(5) !== 0);
      if (censuses.length === 0) continue;
      const knownChildren: KnownChild[] = Array.from({ length: rand(5) }, () => {
        const b = years[rand(years.length)];
        const dies = rand(3) === 0;
        return dies ? { birthDate: String(b), deathDate: String(b + 1 + rand(15)) } : { birthDate: String(b) };
      });
      const r = ok(censusChildrenGap({ censuses, knownChildren }));
      if (r.conflicts.length > 0) {
        expect(r.missing).toEqual([]);
        expect(r.totalMissing).toBeNull();
        continue;
      }
      if (r.censusesUsed.length === 0) {
        expect(r.undetermined.length).toBeGreaterThan(0);
        expect(r.totalMissing).toBeNull();
        continue;
      }
      feasible++;
      if (r.unresolved.length > 0) unresolvedSeen++;
      for (const g of [...r.missing, ...r.unresolved]) expect(g.count).toBeGreaterThan(0);
      const sum = r.missing.reduce((n, g) => n + g.count, 0) + r.unresolved.reduce((n, g) => n + g.count, 0);
      expect(sum).toBe(r.totalMissing);
      if (r.censusesUsed.length === 2) {
        // Total missing is children born by 1910 minus the known children born by then.
        const knownBy1910 = knownChildren.filter((c) => Number(c.birthDate) <= 1909).length;
        const c1910 = censuses.find((c) => c.year === 1910)!;
        expect(r.totalMissing).toBe(c1910.childrenBorn - knownBy1910);
      }
    }
    expect(feasible).toBeGreaterThan(100);
    expect(unresolvedSeen).toBeGreaterThan(10);
  });
});
