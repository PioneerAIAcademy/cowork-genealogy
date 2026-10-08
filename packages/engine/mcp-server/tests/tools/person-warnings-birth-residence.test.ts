import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  lookupPlaceCoords,
  personWarningsTool,
  PLACE_LOOKUP_BUDGET_MS,
  type PlaceCoordsResolver,
} from "../../src/tools/person-warnings.js";

// hasBirthFarFromParentsResidence (issue #1962 item 3). Places sit on the
// equator, so `miles` east of the birthplace is miles / MILES_PER_DEGREE degrees
// of longitude; every distance is chosen well clear of its threshold because
// haversineDistance rounds to whole miles.
const TAG = "hasBirthFarFromParentsResidence";
const MILES_PER_DEGREE = 69.09;
const BIRTHPLACE = "Birthtown, Testshire, England";

function resolverFor(places: Record<string, number>) {
  const calls: string[] = [];
  const resolver: PlaceCoordsResolver = async (name) => {
    calls.push(name);
    if (name === BIRTHPLACE) return { latitude: 0, longitude: 0 };
    const miles = places[name];
    return miles === undefined ? null : { latitude: 0, longitude: miles / MILES_PER_DEGREE };
  };
  return { resolver, calls };
}

function fact(id: string, type: string, date: string | null, place: string | null) {
  return {
    id,
    type,
    ...(date !== null ? { date, standard_date: date } : {}),
    ...(place !== null ? { place, standard_place: place } : {}),
  };
}

function tree(childFacts: object[], fatherFacts: object[]) {
  return {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "Child", surname: "Test" }], facts: childFacts },
      { id: "I2", gender: "Male", names: [{ id: "N2", given: "Father", surname: "Test" }], facts: fatherFacts },
    ],
    relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    sources: [],
  };
}

describe("hasBirthFarFromParentsResidence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-birth-res-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function run(t: object, places: Record<string, number>, budgetMs?: number) {
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { id: "rp_001" } }), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t), "utf-8");
    const { resolver, calls } = resolverFor(places);
    const r = await personWarningsTool(
      { projectPath: dir, personId: "I1" },
      { placeCoords: resolver, ...(budgetMs !== undefined ? { lookupBudgetMs: budgetMs } : {}) },
    );
    if (!("warnings" in r)) throw new Error("expected warnings");
    return { warning: r.warnings.find((w) => w.issueType === TAG), calls, all: r.warnings };
  }

  const near = "Near, Testshire, England";
  const far = "Far, Testshire, England";

  it.each([
    ["before 1850", "1840", "1845", 30, 20],
    ["1850 to 1949", "1900", "1905", 270, 230],
    ["1950 and later", "1960", "1965", 520, 480],
    ["a range straddling 1850 (the generous band)", "Bet 1840 and 1860", "1855", 270, 230],
  ])("%s: fires past the band's limit, silent within it", async (_era, born, resided, farMiles, nearMiles) => {
    const t = tree([fact("F1", "Birth", born, BIRTHPLACE)], [fact("F2", "Residence", resided, far)]);
    const fires = await run(t, { [far]: farMiles });
    expect(fires.warning?.relatedPersonId).toBe("I2");
    expect(fires.warning?.severity).toBe("implausible");
    expect(fires.warning?.facts?.map((f) => f.id)).toEqual(["F1", "F2"]);

    const t2 = tree([fact("F1", "Birth", born, BIRTHPLACE)], [fact("F2", "Residence", resided, near)]);
    expect((await run(t2, { [near]: nearMiles })).warning).toBeUndefined();
  });

  it("compares only a residence within 20 years of the birth, and never looks up the others", async () => {
    const outside = await run(
      tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Residence", "1865", far)]),
      { [far]: 30 },
    );
    expect(outside.warning).toBeUndefined();
    expect(outside.calls).toEqual([]);

    const inside = await run(
      tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Residence", "1855", far)]),
      { [far]: 30 },
    );
    expect(inside.warning).toBeDefined();
  });

  it("treats an open-ended residence date as outside the window", async () => {
    const r = await run(
      tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Residence", "Aft 1845", far)]),
      { [far]: 30 },
    );
    expect(r.warning).toBeUndefined();
    expect(r.calls).toEqual([]);
  });

  it("skips a birth with no date at all, without a lookup", async () => {
    const r = await run(
      tree([fact("F1", "Birth", null, BIRTHPLACE)], [fact("F2", "Residence", "1845", far)]),
      { [far]: 30 },
    );
    expect(r.warning).toBeUndefined();
    expect(r.calls).toEqual([]);
  });

  it("dates a placed birth from another birth-like fact when the birth itself is undated", async () => {
    const r = await run(
      tree(
        [fact("F1", "Birth", null, BIRTHPLACE), fact("F3", "Christening", "1840", null)],
        [fact("F2", "Residence", "1845", far)],
      ),
      { [far]: 30 },
    );
    expect(r.warning).toBeDefined();
  });

  it("uses the christening place when the birth has none", async () => {
    const r = await run(
      tree([fact("F1", "Christening", "1840", BIRTHPLACE)], [fact("F2", "Residence", "1845", far)]),
      { [far]: 30 },
    );
    expect(r.warning?.facts?.[0].id).toBe("F1");
  });

  it("skips a pair whose place cannot be resolved", async () => {
    const r = await run(
      tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Residence", "1845", far)]),
      {},
    );
    expect(r.warning).toBeUndefined();
    expect(r.calls.sort()).toEqual([BIRTHPLACE, far].sort());
  });

  it("skips the check when the resolver throws", async () => {
    await writeFile(join(dir, "research.json"), "{}", "utf-8");
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Residence", "1845", far)])),
      "utf-8",
    );
    const r = await personWarningsTool(
      { projectPath: dir, personId: "I1" },
      { placeCoords: async () => { throw new Error("Places API down"); } },
    );
    expect("warnings" in r && r.warnings.some((w) => w.issueType === TAG)).toBe(false);
  });

  it("gives up on lookups past the budget and still returns every other warning", async () => {
    // A 200-year lifespan makes a synchronous warning that must survive.
    const t = tree(
      [fact("F1", "Birth", "1840", BIRTHPLACE), fact("F4", "Death", "2040", null)],
      [fact("F2", "Residence", "1845", far)],
    );
    await writeFile(join(dir, "research.json"), "{}", "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t), "utf-8");
    const started = Date.now();
    const r = await personWarningsTool(
      { projectPath: dir, personId: "I1" },
      { placeCoords: () => new Promise(() => {}), lookupBudgetMs: 20 },
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    if (!("warnings" in r)) throw new Error("expected warnings");
    expect(r.warnings.some((w) => w.issueType === TAG)).toBe(false);
    expect(r.warnings.some((w) => w.issueType === "hasAgeRangeGreaterThan120")).toBe(true);
    expect(PLACE_LOOKUP_BUDGET_MS).toBe(30_000);
  });

  it("makes no lookup when there is no parent residence to compare", async () => {
    const r = await run(
      tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [fact("F2", "Death", "1890", far)]),
      { [far]: 30 },
    );
    expect(r.warning).toBeUndefined();
    expect(r.calls).toEqual([]);
  });

  it("runs with the default resolver when nothing needs a lookup (no network)", async () => {
    await writeFile(join(dir, "research.json"), "{}", "utf-8");
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(tree([fact("F1", "Birth", "1840", BIRTHPLACE)], [])),
      "utf-8",
    );
    const r = await personWarningsTool({ projectPath: dir, personId: "I1" });
    expect("warnings" in r && r.warnings.some((w) => w.issueType === TAG)).toBe(false);
  });
  it("starts no lookup and records no result once the budget has run out", async () => {
    const started: string[] = [];
    const slow: PlaceCoordsResolver = (name) => {
      started.push(name);
      return new Promise((r) => setTimeout(() => r({ latitude: 0, longitude: 0 }), 100));
    };
    const coords = await lookupPlaceCoords(["a", "b", "c", "d", "e", "f"], slow, 50);
    expect([...coords.values()].every((c) => c === null)).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(started).toEqual(["a", "b", "c", "d"]);
    expect([...coords.values()].every((c) => c === null)).toBe(true);
  });
});
