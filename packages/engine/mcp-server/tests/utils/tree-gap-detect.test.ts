import { describe, it, expect } from "vitest";
import {
  addAncestry,
  addDescendancy,
  detectGaps,
  emptyModel,
  selectGaps,
  yearOf,
} from "../../src/utils/tree-gap-detect.js";
import type { FSGapPerson } from "../../src/types/tree-gaps.js";

function dp(
  id: string,
  num: string,
  name: string,
  gender: "Male" | "Female",
  birth: number | null,
  death: number | null,
  extra: Partial<NonNullable<FSGapPerson["display"]>> = {},
  living = false,
): FSGapPerson {
  return {
    id,
    living,
    display: {
      descendancyNumber: num,
      name,
      gender,
      lifespan: `${birth ?? ""}-${death ?? (living ? "Living" : "")}`,
      ...(birth ? { birthDate: `1 May ${birth}`, birthPlace: "Dayton, Ohio, United States" } : {}),
      ...(death ? { deathDate: `1 May ${death}` } : {}),
      ...extra,
    },
  };
}

function ap(
  id: string,
  asc: string,
  birth: number | null,
  death: number | null,
  living = false,
): FSGapPerson {
  return {
    id,
    living,
    display: {
      ascendancyNumber: asc,
      name: id,
      gender: Number(asc) % 2 === 0 ? "Male" : "Female",
      birthDate: birth ? `1 May ${birth}` : undefined,
      deathDate: death ? `1 May ${death}` : undefined,
      lifespan: `${birth ?? ""}-${death ?? ""}`,
    },
  };
}

const types = (m: ReturnType<typeof emptyModel>) => detectGaps(m).map((g) => g.type);

describe("yearOf", () => {
  it("reads the first four-digit year", () => {
    expect(yearOf("12 February 1809")).toBe(1809);
    expect(yearOf("about 1850")).toBe(1850);
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf("Living")).toBeNull();
  });
});

describe("missing_parents", () => {
  it("flags an ancestor short of the cap with no parents, not one at the cap", () => {
    const m = emptyModel(2);
    addAncestry(m, [
      ap("R", "1", 1900, 1970),
      ap("F", "2", 1870, 1940),
      ap("M", "3", 1875, 1950),
      ap("FF", "4", 1840, 1900),
    ]);
    const g = detectGaps(m).filter((x) => x.type === "missing_parents");
    // F has a father (4) but no mother (5); M has neither; FF is at the cap.
    expect(g.map((x) => x.personId).sort()).toEqual(["F", "M"]);
    expect(g.find((x) => x.personId === "F")!.detail).toMatch(/mother is missing/);
    expect(g.find((x) => x.personId === "M")!.yearRange).toEqual({ start: 1874, end: 1878 });
  });

  it("never flags a living person", () => {
    const m = emptyModel(3);
    addAncestry(m, [ap("R", "1", 1990, null, true)]);
    expect(types(m)).toEqual([]);
  });
});

function family(
  kids: [number | null, number | null][],
  opts: { motherBirth?: number; motherDeath?: number | null; fatherDeath?: number } = {},
) {
  const m = emptyModel(1);
  const persons = [
    dp("DAD", "1", "Dad", "Male", 1850, opts.fatherDeath ?? 1920, { marriageDate: "1 May 1875" }),
    dp(
      "MOM",
      "1-S1",
      "Mom",
      "Female",
      opts.motherBirth ?? 1855,
      opts.motherDeath === undefined ? 1930 : opts.motherDeath,
    ),
    ...kids.map(([b, d], i) => dp(`K${i}`, `1.${i + 1}`, `Kid${i}`, "Male", b, d)),
  ];
  addDescendancy(m, persons, 1, 4);
  return m;
}

describe("family holes", () => {
  it("no_children: a married couple with no children", () => {
    const g = detectGaps(family([])).find((x) => x.type === "no_children")!;
    expect(g.personId).toBe("DAD");
    expect(g.spouseId).toBe("MOM");
    expect(g.yearRange).toEqual({ start: 1875, end: 1900 });
  });

  it("child_gap: more than 4 years between births", () => {
    const g = detectGaps(family([[1876, 1950], [1884, 1950]])).filter((x) => x.type === "child_gap");
    expect(g).toHaveLength(1);
    expect(g[0].yearRange).toEqual({ start: 1877, end: 1883 });
  });

  it("child_gap: a 4-year spacing is not a gap", () => {
    expect(types(family([[1876, 1950], [1880, 1950]]))).not.toContain("child_gap");
  });

  it("early_last_child: last child when the mother was 25 and she lived to 75", () => {
    const g = detectGaps(family([[1880, 1950]])).find((x) => x.type === "early_last_child")!;
    expect(g.yearRange).toEqual({ start: 1881, end: 1900 });
  });

  it("early_last_child: not when the mother died soon after", () => {
    expect(types(family([[1880, 1950]], { motherDeath: 1890 }))).not.toContain("early_last_child");
  });

  it("no_children: not when the children were never read (a leaf)", () => {
    const m = emptyModel(1);
    addDescendancy(
      m,
      [
        dp("A", "1", "A", "Male", 1850, 1920),
        dp("B", "1.1", "B", "Male", 1880, 1950),
        dp("BW", "1.1-S1", "BW", "Female", 1882, 1960),
      ],
      1,
      1,
    );
    expect(detectGaps(m).filter((x) => x.personId === "B" && x.type === "no_children")).toEqual([]);
  });

  it("no_spouse: a deceased adult with no spouse", () => {
    const m = emptyModel(1);
    addDescendancy(m, [dp("U", "1", "Uncle", "Male", 1850, 1920)], 1, 4);
    const g = detectGaps(m).find((x) => x.type === "no_spouse")!;
    expect(g.yearRange).toEqual({ start: 1868, end: 1920 });
  });

  it("no_spouse: not for a child who died young", () => {
    const m = emptyModel(1);
    addDescendancy(m, [dp("U", "1", "Child", "Male", 1850, 1860)], 1, 4);
    expect(types(m)).not.toContain("no_spouse");
  });

  it("never reports a family hole when either spouse is living", () => {
    const m = emptyModel(1);
    addDescendancy(
      m,
      [
        dp("DAD", "1", "Dad", "Male", 1950, 2020),
        dp("MOM", "1-S1", "Mom", "Female", 1952, null, {}, true),
      ],
      1,
      4,
    );
    expect(types(m)).toEqual([]);
  });
});

describe("no_death_date", () => {
  it("flags a deceased person with no death date, not a living one", () => {
    const m = emptyModel(1);
    addAncestry(m, [ap("R", "1", 1900, null, false), ap("L", "2", 1990, null, true)]);
    const g = detectGaps(m).filter((x) => x.type === "no_death_date");
    expect(g.map((x) => x.personId)).toEqual(["R"]);
  });
});

describe("a tree with no holes", () => {
  it("returns nothing", () => {
    const m = emptyModel(1);
    addAncestry(m, [ap("R", "1", 1900, 1970), ap("F", "2", 1870, 1940), ap("M", "3", 1875, 1950)]);
    // F and M sit at the cap of 1, so their parents are not judged.
    expect(detectGaps(m)).toEqual([]);
  });
});

describe("selectGaps", () => {
  it("round-robins across types so one type cannot fill the answer", () => {
    const m = emptyModel(1);
    const persons: FSGapPerson[] = [];
    for (let i = 0; i < 6; i++) {
      persons.push(dp(`U${i}`, `1.${i + 1}`, `U${i}`, "Male", 1850, 1920));
    }
    persons.unshift(dp("R", "1", "R", "Male", 1800, 1870, { marriageDate: "1 May 1830" }));
    persons.push(dp("RW", "1-S1", "RW", "Female", 1805, 1880));
    persons.push(dp("NODEATH", "1.7", "NoDeath", "Male", 1851, null));
    addDescendancy(m, persons, 1, 4);
    const all = detectGaps(m);
    expect(all.filter((g) => g.type === "no_spouse").length).toBeGreaterThanOrEqual(6);
    const picked = selectGaps(all, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((g) => g.type)).size).toBeGreaterThan(1);
  });
});
