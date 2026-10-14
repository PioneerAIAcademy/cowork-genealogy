import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { censusChildrenGap, censusChildrenGapTool } from "../../src/tools/census-children-gap.js";
import type { CensusChildrenGapResult, KnownChild } from "../../src/types/census-children-gap.js";

// Tree mode (issue #3260 PR 2): with `motherId`, the tool reads the mother's
// children and their dates from tree.gedcomx.json instead of taking them as input.

function ok(r: CensusChildrenGapResult) {
  if (!r.ok) throw new Error(`expected ok, got errors: ${r.errors.join("; ")}`);
  return r;
}

function kinds(r: ReturnType<typeof ok>) {
  return Object.fromEntries(r.missing.map((g) => [g.kind, g.count]));
}

interface Kid {
  id: string;
  birth?: string;
  death?: string;
  christening?: string;
  burial?: string;
  subtype?: string;
}

function person(id: string, gender: string, facts: object[], ark?: string) {
  return {
    id,
    ...(ark ? { ark } : {}),
    gender,
    names: [{ id: `N-${id}`, given: id, surname: "Mercer" }],
    facts,
  };
}

function fact(type: string, date: string | undefined) {
  return date === undefined ? [] : [{ id: `F-${type}-${date}`, type, date, standard_date: date }];
}

/** A tree: mother M (and father D), with the given children of M. */
function tree(kids: Kid[], extra: { persons?: object[]; relationships?: object[] } = {}) {
  const persons = [
    person("M", "Female", fact("Birth", "1868"), "ark:/61903/4:1:MRCR-MOM"),
    person("D", "Male", fact("Birth", "1865")),
    ...kids.map((k) =>
      person(k.id, "Female", [
        ...fact("Birth", k.birth),
        ...fact("Christening", k.christening),
        ...fact("Death", k.death),
        ...fact("Burial", k.burial),
      ]),
    ),
    ...(extra.persons ?? []),
  ];
  const relationships = [
    { id: "R-C", type: "Couple", person1: "D", person2: "M" },
    ...kids.flatMap((k) => [
      { id: `R-D-${k.id}`, type: "ParentChild", parent: "D", child: k.id },
      { id: `R-M-${k.id}`, type: "ParentChild", parent: "M", child: k.id, ...(k.subtype ? { subtype: k.subtype } : {}) },
    ]),
    ...(extra.relationships ?? []),
  ];
  return { persons, relationships, sources: [] };
}

const MERCER_KIDS: Kid[] = [
  { id: "C1", birth: "1889" },
  { id: "C2", birth: "1891" },
  { id: "C3", birth: "1893" },
  { id: "C4", birth: "1896" },
  { id: "C5", birth: "1898" },
  { id: "W6", birth: "1906" },
];
const MERCER_COUNTS = [
  { year: 1900 as const, childrenBorn: 6, childrenLiving: 5 },
  { year: 1910 as const, childrenBorn: 8, childrenLiving: 7 },
];

describe("census_children_gap tree mode", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccg-tree-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { id: "rp_001" } }), "utf-8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(t: object) {
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t), "utf-8");
  }

  async function run(motherId: string, censuses = MERCER_COUNTS) {
    return censusChildrenGapTool({ censuses, projectPath: dir, motherId });
  }

  it("Mercer: one child dead before 1900 and one living child born between the censuses", async () => {
    await seed(tree(MERCER_KIDS));
    const r = ok(await run("M"));
    expect(r.totalMissing).toBe(2);
    expect(kinds(r)).toEqual({ died_before_1900: 1, born_between_living_1910: 1 });
    expect(r.mother).toEqual({ personId: "M", name: expect.any(String) });
    expect(r.knownChildrenUsed?.map((c) => c.personId)).toEqual(["C1", "C2", "C3", "C4", "C5", "W6"]);
    expect(r.knownChildrenUsed?.[0].birth).toBe("1889");
  });

  it("Brannon: one living child missing at both censuses is one child", async () => {
    await seed(tree([
      { id: "J", birth: "1892" },
      { id: "C", birth: "1895" },
      { id: "T", birth: "1904" },
    ]));
    const r = ok(await run("M", [
      { year: 1900, childrenBorn: 3, childrenLiving: 3 },
      { year: 1910, childrenBorn: 4, childrenLiving: 4 },
    ]));
    expect(r.totalMissing).toBe(1);
    expect(kinds(r)).toEqual({ living_1900_and_1910: 1 });
  });

  it("finds the mother by the FamilySearch id her ark links to", async () => {
    await seed(tree(MERCER_KIDS));
    const r = ok(await run("MRCR-MOM"));
    expect(r.mother?.personId).toBe("M");
    expect(r.totalMissing).toBe(2);
  });

  it("counts a child by another husband, because the walk starts at the mother", async () => {
    await seed(tree(MERCER_KIDS, {
      persons: [person("H2", "Male", []), person("X", "Male", fact("Birth", "1887"))],
      relationships: [
        { id: "R-H2-X", type: "ParentChild", parent: "H2", child: "X" },
        { id: "R-M-X", type: "ParentChild", parent: "M", child: "X" },
      ],
    }));
    const r = ok(await run("M"));
    expect(r.knownChildrenUsed?.map((c) => c.personId)).toContain("X");
    // X fills the 1900 living slot, so the census and tree now conflict there.
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it("excludes an adoptive child and keeps a BiologicalParent one", async () => {
    await seed(tree([
      ...MERCER_KIDS,
      { id: "A", birth: "1895", subtype: "AdoptiveParent" },
      { id: "B", birth: "1 Mar 1900", subtype: "BiologicalParent" },
    ]));
    const r = ok(await run("M", [{ year: 1910, childrenBorn: 7, childrenLiving: 7 }]));
    const ids = r.knownChildrenUsed?.map((c) => c.personId);
    expect(ids).not.toContain("A");
    expect(ids).toContain("B");
    expect(r.totalMissing).toBe(0);
  });

  it("counts a child linked to the mother twice only once", async () => {
    await seed(tree(MERCER_KIDS, {
      relationships: [{ id: "R-M-C1-dup", type: "ParentChild", parent: "M", child: "C1" }],
    }));
    const r = ok(await run("M"));
    expect(r.knownChildrenUsed?.filter((c) => c.personId === "C1")).toHaveLength(1);
    expect(r.totalMissing).toBe(2);
  });

  it("places a christening-only child as born on or before the christening", async () => {
    await seed(tree([{ id: "K", christening: "12 Mar 1895" }]));
    const r = ok(await run("M", [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }]));
    expect(r.undetermined).toEqual([]);
    expect(r.totalMissing).toBe(0);
    expect(r.knownChildrenUsed?.[0].birth).toBe("on or before Christening 12 Mar 1895");
  });

  it("a child with no birth evidence is undetermined, not an error", async () => {
    await seed(tree([...MERCER_KIDS, { id: "N" }]));
    const r = ok(await run("M"));
    expect(r.undetermined.length).toBeGreaterThan(0);
    expect(r.undetermined.every((u) => /no birth or christening date/.test(u.reason))).toBe(true);
    expect(r.censusesUsed).toEqual([]);
  });

  it("a child whose death precedes its birth is undetermined, not an error", async () => {
    await seed(tree([...MERCER_KIDS, { id: "Z", birth: "1895", death: "1890" }]));
    const r = ok(await run("M"));
    expect(r.undetermined.some((u) => /death date in the tree is before its birth/.test(u.reason))).toBe(true);
  });

  it("a burial before the census day places the child as dead", async () => {
    await seed(tree([{ id: "Q", birth: "1891", burial: "3 Feb 1893" }]));
    const r = ok(await run("M", [{ year: 1900, childrenBorn: 1, childrenLiving: 0 }]));
    expect(r.undetermined).toEqual([]);
    expect(r.totalMissing).toBe(0);
  });

  it("reads GEDCOM forms: an About birth well before the census is placed", async () => {
    await seed(tree([{ id: "P", birth: "Abt 1880" }]));
    const r = ok(await run("M", [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }]));
    expect(r.undetermined).toEqual([]);
    expect(r.totalMissing).toBe(0);
  });

  it("an open-ended death (Aft) does not place the child as dead by a later census", async () => {
    // getDayRange caps `Aft 1890` near 1901; read as a hard bound it would count
    // the child dead by 1910. Known alive after 1890 is all the record says.
    await seed(tree([{ id: "A", birth: "1885", death: "Aft 1890" }]));
    const r = ok(await run("M", [{ year: 1910, childrenBorn: 1, childrenLiving: 1 }]));
    expect(r.conflicts).toEqual([]);
    expect(r.undetermined.map((u) => u.census)).toEqual([1910]);
  });

  it("an open-ended birth (Bef) still places a child well before the census", async () => {
    await seed(tree([{ id: "B", birth: "Bef 1895" }]));
    const r = ok(await run("M", [{ year: 1900, childrenBorn: 1, childrenLiving: 1 }]));
    expect(r.undetermined).toEqual([]);
    expect(r.totalMissing).toBe(0);
  });

  it("a funeral before the census day places the child as dead", async () => {
    await seed(tree([], {
      persons: [person("F1", "Female", [
        { id: "FB", type: "Birth", date: "1890", standard_date: "1890" },
        { id: "FF", type: "Funeral", date: "4 May 1897", standard_date: "4 May 1897" },
      ])],
      relationships: [{ id: "R-M-F1", type: "ParentChild", parent: "M", child: "F1" }],
    }));
    const r = ok(await run("M", [{ year: 1900, childrenBorn: 1, childrenLiving: 0 }]));
    expect(r.undetermined).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.totalMissing).toBe(0);
    expect(r.knownChildrenUsed?.[0].death).toBe("on or before Funeral 4 May 1897");
  });

  it("refuses a motherId that names a man", async () => {
    await seed(tree(MERCER_KIDS));
    const r = await run("D");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/recorded as male/);
  });

  it("treats knownChildren: null as absent in tree mode", async () => {
    await seed(tree(MERCER_KIDS));
    const r = await censusChildrenGapTool({
      censuses: MERCER_COUNTS,
      projectPath: dir,
      motherId: "M",
      knownChildren: null as unknown as undefined,
    });
    expect(ok(r).totalMissing).toBe(2);
  });

  it("rejects motherId together with knownChildren", async () => {
    await seed(tree(MERCER_KIDS));
    const r = await censusChildrenGapTool({
      censuses: MERCER_COUNTS,
      projectPath: dir,
      motherId: "M",
      knownChildren: [{ birthDate: "1890" }],
    });
    expect(r.ok).toBe(false);
  });

  it("a mother not in the tree is ok:false with the lookup's message", async () => {
    await seed(tree(MERCER_KIDS));
    const r = await run("NOPE");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not found/);
  });

  it("a folder that is not a project answers no_project, not an error", async () => {
    const empty = await mkdtemp(join(tmpdir(), "ccg-empty-"));
    try {
      const r = await censusChildrenGapTool({ censuses: MERCER_COUNTS, projectPath: empty, motherId: "M" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("no_project");
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("without motherId it is explicit mode and ignores projectPath", async () => {
    const input = {
      censuses: MERCER_COUNTS,
      knownChildren: ["1889", "1891", "1893", "1896", "1898", "1906"].map((birthDate) => ({ birthDate })),
      projectPath: dir,
    };
    expect(await censusChildrenGapTool(input)).toEqual(censusChildrenGap(input));
  });

  it("property: tree mode equals the equivalent explicit call", async () => {
    let seedN = 4242;
    const rand = (n: number) => {
      seedN = (seedN + 0x6d2b79f5) | 0;
      let t = Math.imul(seedN ^ (seedN >>> 15), 1 | seedN);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const years = [1885, 1890, 1895, 1899, 1902, 1905, 1909, 1912];
    for (let i = 0; i < 60; i++) {
      const kids: Kid[] = Array.from({ length: rand(5) }, (_, j) => {
        const b = years[rand(years.length)];
        return rand(3) === 0
          ? { id: `K${j}`, birth: String(b), death: String(b + 1 + rand(15)) }
          : { id: `K${j}`, birth: String(b) };
      });
      const born0 = rand(6);
      const born1 = rand(8);
      const censuses = [
        { year: 1900 as const, childrenBorn: born0, childrenLiving: rand(born0 + 1) },
        { year: 1910 as const, childrenBorn: born1, childrenLiving: rand(born1 + 1) },
      ];
      await seed(tree(kids));
      const viaTree = ok(await run("M", censuses));
      const knownChildren: KnownChild[] = kids.map((k) => ({
        name: `K`,
        birthDate: k.birth!,
        ...(k.death ? { deathDate: k.death } : {}),
      }));
      const viaInput = ok(censusChildrenGap({ censuses, knownChildren }));
      expect(viaTree.totalMissing).toBe(viaInput.totalMissing);
      expect(viaTree.missing.map((g) => [g.kind, g.count])).toEqual(viaInput.missing.map((g) => [g.kind, g.count]));
      expect(viaTree.unresolved.map((g) => g.count)).toEqual(viaInput.unresolved.map((g) => g.count));
      expect(viaTree.conflicts.length > 0).toBe(viaInput.conflicts.length > 0);
      expect(viaTree.censusesUsed).toEqual(viaInput.censusesUsed);
    }
  });
});
