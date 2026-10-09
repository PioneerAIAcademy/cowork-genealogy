import { describe, it, expect } from "vitest";
import {
  addAncestry,
  addDescendancy,
  detectGaps,
  emptyModel,
  placeLevel,
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
      birthPlace: birth ? "Dayton, Ohio, United States" : undefined,
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

describe("living flag", () => {
  it("treats a person with no `living` flag as living, so no hole is reported on them", () => {
    const m = emptyModel(1);
    addAncestry(m, [
      { id: "R", display: { ascendancyNumber: "1", name: "R", gender: "Male", birthDate: "1 May 1900", lifespan: "1900-" } },
    ]);
    expect(detectGaps(m)).toEqual([]);
  });
});

describe("a man with several spouses", () => {
  it("skips the interval-based holes, since the endpoint does not say which spouse bore which child", () => {
    const m = emptyModel(1);
    addDescendancy(
      m,
      [
        dp("DAD", "1", "Dad", "Male", 1850, 1920, { marriageDate: "1 May 1875" }),
        dp("W1", "1-S1", "W1", "Female", 1855, 1880),
        dp("W2", "1-S2", "W2", "Female", 1860, 1930),
        dp("K0", "1.1", "K0", "Male", 1876, 1950),
        dp("K1", "1.2", "K1", "Male", 1890, 1950),
      ],
      1,
      4,
    );
    const t = types(m);
    expect(t).not.toContain("child_gap");
    expect(t).not.toContain("early_last_child");
    expect(t).not.toContain("no_children");
  });
});


describe("a couple whose spouses are both line persons", () => {
  // DAD and MOM are each an anchor, so the couple is read twice, once from each side.
  const bothSides = (kidBirths: number[]) => {
    const m = emptyModel(1);
    const kids = (n: string) => kidBirths.map((b, i) => dp(`K${i}`, `${n}.${i + 1}`, `Kid${i}`, "Male", b, 1950));
    addDescendancy(
      m,
      [dp("DAD", "1", "Dad", "Male", 1850, 1920, { marriageDate: "1 May 1875" }), dp("MOM", "1-S1", "Mom", "Female", 1855, 1930), ...kids("1")],
      1,
      4,
    );
    addDescendancy(
      m,
      [dp("MOM", "1", "Mom", "Female", 1855, 1930), dp("DAD", "1-S1", "Dad", "Male", 1850, 1920, { marriageDate: "1 May 1875" }), ...kids("1")],
      1,
      4,
    );
    return detectGaps(m);
  };

  it("reports a couple's hole once, not once per spouse", () => {
    const g = bothSides([1880]);
    expect(g.filter((x) => x.type === "early_last_child")).toHaveLength(1);
  });

  it("keeps two different child gaps of the same couple", () => {
    const g = bothSides([1876, 1884, 1895]).filter((x) => x.type === "child_gap");
    expect(g.map((x) => x.yearRange)).toEqual([
      { start: 1877, end: 1883 },
      { start: 1885, end: 1894 },
    ]);
  });
});

describe("a mother with two husbands", () => {
  it("reports the same child gap once, though her own read names no single spouse", () => {
    const m = emptyModel(1);
    const kids = [dp("K0", "1.1", "Kid0", "Male", 1876, 1950), dp("K1", "1.2", "Kid1", "Male", 1890, 1950)];
    addDescendancy(m, [dp("DAD", "1", "Dad", "Male", 1850, 1920), dp("MOM", "1-S1", "Mom", "Female", 1855, 1930), ...kids], 1, 4);
    addDescendancy(
      m,
      [
        dp("MOM", "1", "Mom", "Female", 1855, 1930),
        dp("DAD", "1-S1", "Dad", "Male", 1850, 1920),
        dp("DAD2", "1-S2", "Dad Two", "Male", 1845, 1915),
        ...kids,
      ],
      1,
      4,
    );
    expect(detectGaps(m).filter((x) => x.type === "child_gap")).toHaveLength(1);
  });
});

describe("no_death_date window", () => {
  it("ends at this year, not at birth + 90, for someone born recently", () => {
    const year = new Date().getFullYear();
    const m = emptyModel(1);
    addAncestry(m, [ap("R", "1", year - 20, null, false)]);
    const g = detectGaps(m).find((x) => x.type === "no_death_date")!;
    expect(g.yearRange).toEqual({ start: year - 20, end: year });
  });

  it("still runs to birth + 90 for someone born long ago", () => {
    const m = emptyModel(1);
    addAncestry(m, [ap("R", "1", 1800, null, false)]);
    const g = detectGaps(m).find((x) => x.type === "no_death_date")!;
    expect(g.yearRange).toEqual({ start: 1800, end: 1890 });
  });
});

const named = (p: FSGapPerson, parts: { type: string; value: string }[]): FSGapPerson => ({
  ...p,
  names: [{ nameForms: [{ fullText: p.display?.name, parts }] }],
});
const GIVEN = { type: "http://gedcomx.org/Given", value: "Efua" };
const surname = (value: string) => ({ type: "http://gedcomx.org/Surname", value });

describe("missing_surname", () => {
  const wifeModel = (parts: { type: string; value: string }[] | null, marriage?: string, kids: number[] = []) => {
    const m = emptyModel(1);
    const mom = dp("MOM", "1-S1", "Efua", "Female", 1855, 1930);
    addDescendancy(
      m,
      [
        dp("DAD", "1", "Dad", "Male", 1850, 1920, marriage ? { marriageDate: marriage } : {}),
        parts ? named(mom, parts) : mom,
        ...kids.map((b, i) => dp(`K${i}`, `1.${i + 1}`, `Kid${i}`, "Male", b, 1950)),
      ],
      1,
      4,
    );
    return detectGaps(m).filter((x) => x.type === "missing_surname");
  };

  it("flags a deceased wife whose name has no surname part, windowed on the marriage", () => {
    const g = wifeModel([GIVEN], "1 May 1875");
    expect(g).toHaveLength(1);
    expect(g[0].personId).toBe("MOM");
    expect(g[0].spouseId).toBe("DAD");
    expect(g[0].yearRange).toEqual({ start: 1874, end: 1876 });
  });

  it("falls back to her first child's birth when no marriage year is known", () => {
    expect(wifeModel([GIVEN], undefined, [1880, 1884])[0].yearRange).toEqual({ start: 1879, end: 1881 });
  });

  it("flags a placeholder surname such as Unknown", () => {
    expect(wifeModel([GIVEN, surname("Unknown")], "1 May 1875")).toHaveLength(1);
    expect(wifeModel([GIVEN, surname("[unknown]")], "1 May 1875")).toHaveLength(1);
    expect(wifeModel([GIVEN, surname("")], "1 May 1875")).toHaveLength(1);
  });

  it("does not flag a wife who has a real surname", () => {
    expect(wifeModel([GIVEN, surname("Forson")], "1 May 1875")).toEqual([]);
  });

  it("does not flag a husband with no surname part, only a wife", () => {
    const m = emptyModel(1);
    addDescendancy(
      m,
      [
        named(dp("DAD", "1", "Kojo", "Male", 1850, 1920, { marriageDate: "1 May 1875" }), [{ type: "http://gedcomx.org/Given", value: "Kojo" }]),
        named(dp("MOM", "1-S1", "Efua Forson", "Female", 1855, 1930), [GIVEN, surname("Forson")]),
      ],
      1,
      4,
    );
    expect(detectGaps(m).filter((x) => x.type === "missing_surname")).toEqual([]);
  });

  it("does not flag someone recorded as male even in a mother's pedigree slot", () => {
    const m = emptyModel(2);
    const odd = named(ap("ODD", "3", 1875, 1950), [GIVEN]);
    odd.display = { ...odd.display, gender: "Male" };
    addAncestry(m, [ap("R", "1", 1900, 1970), odd]);
    expect(detectGaps(m).filter((x) => x.type === "missing_surname")).toEqual([]);
  });

  it("does not flag when the response carried no name parts at all", () => {
    expect(wifeModel(null, "1 May 1875")).toEqual([]);
  });

  it("flags a mother in the pedigree, and never a man or a living wife", () => {
    const m = emptyModel(2);
    const mother = named(ap("MOM", "3", 1875, 1950), [GIVEN]);
    const father = named(ap("DAD", "2", 1870, 1940), [{ type: "http://gedcomx.org/Given", value: "Kojo" }]);
    const livingMom = named(ap("LMOM", "5", 1900, null, true), [GIVEN]);
    addAncestry(m, [ap("R", "1", 1900, 1970), father, mother, livingMom]);
    const g = detectGaps(m).filter((x) => x.type === "missing_surname");
    expect(g.map((x) => x.personId)).toEqual(["MOM"]);
  });
});

describe("no_birth_info", () => {
  const one = (p: FSGapPerson, kids: number[] = []) => {
    const m = emptyModel(1);
    addDescendancy(
      m,
      [p, ...kids.map((b, i) => dp(`K${i}`, `1.${i + 1}`, `Kid${i}`, "Male", b, 1950))],
      1,
      4,
    );
    return detectGaps(m).filter((x) => x.type === "no_birth_info" && x.personId === p.id);
  };

  it("flags a person with no birth date or place, windowed on the death year", () => {
    const g = one(dp("DAD", "1", "Dad", "Male", null, 1920));
    expect(g).toHaveLength(1);
    expect(g[0].detail).toMatch(/no birth date or place/);
    expect(g[0].yearRange).toEqual({ start: 1830, end: 1920 });
  });

  it("does not guess a window from the children's births", () => {
    expect(one(dp("DAD", "1", "Dad", "Male", null, 1920), [1880, 1884])[0].yearRange).toEqual({ start: 1830, end: 1920 });
  });

  it("gives no window when neither a birth nor a death year is known", () => {
    expect(one(dp("DAD", "1", "Dad", "Male", null, null, { deathDate: undefined }, false))[0].yearRange).toBeNull();
  });

  it("says which half is missing", () => {
    const noPlace = dp("A", "1", "A", "Male", 1850, 1920, { birthPlace: undefined });
    const g = one(noPlace);
    expect(g[0].detail).toMatch(/no birth place/);
    expect(g[0].yearRange).toEqual({ start: 1849, end: 1853 });
    const noDate = dp("B", "1", "B", "Male", null, 1920, { birthPlace: "Cape Coast, Ghana" });
    expect(one(noDate)[0].detail).toMatch(/no birth date\./);
  });

  it("does not flag a person who has both, or a living person", () => {
    expect(one(dp("A", "1", "A", "Male", 1850, 1920))).toEqual([]);
    expect(one(dp("L", "1", "L", "Male", null, null, {}, true))).toEqual([]);
  });
});

describe("placeLevel", () => {
  it("reads the level from the number of place parts", () => {
    expect(placeLevel("Ghana")).toBe("country");
    expect(placeLevel("Central, Ghana")).toBe("region");
    expect(placeLevel("Cape Coast Metropolitan, Central, Ghana")).toBe("county");
    expect(placeLevel("Cape Coast, Cape Coast Metropolitan, Central, Ghana")).toBe("locality");
  });
});

describe("no_spouse at the bottom level of a read", () => {
  it("does not flag a leaf whose spouse the endpoint listed (measured: spouses come back on the last level)", () => {
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
    expect(detectGaps(m).filter((x) => x.type === "no_spouse" && x.personId === "B")).toEqual([]);
  });
});

