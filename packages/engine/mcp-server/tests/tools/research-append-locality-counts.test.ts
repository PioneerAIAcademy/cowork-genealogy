// research_append stamps each `localities` collection's person_count /
// record_count from FamilySearch's collection catalog (issue #4385; spec §5.12).
// The catalog is mocked in its real shape: `id` a string, counts under
// `content[].resourceType` ending `/Person` and `/Record`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { mkdtemp, copyFile, readFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  researchAppend,
  researchAppendFromCaller,
  CATALOG_READ_BUDGET_MS,
  LOCALITY_COLLECTIONS_FILL_MAX,
} from "../../src/tools/research-append.js";
import { markFsRefusal } from "../../src/utils/fs-budget.js";
import { clearCollectionsCache, collectionCatalogLoader } from "../../src/tools/collections-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { LOCAL } from "../../src/auth/principal.js";
import { callTool } from "../helpers/call-tool.js";
import type { FSCollectionsResponse } from "../../src/types/collection.js";

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/mid-research-flynn");
const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();

function catalogEntry(id: string, title: string, records: number, persons: number, startYear: number | null = 1855, endYear: number | null = startYear) {
  return {
    content: {
      gedcomx: {
        collections: [
          {
            id,
            title,
            content: [
              { count: records, resourceType: "http://gedcomx.org/Record" },
              { count: persons, resourceType: "http://gedcomx.org/Person" },
              { count: 7754, resourceType: "http://gedcomx.org/DigitalArtifact#FamilySearch" },
            ],
            searchMetadata: [{ imageCount: 7754, recordCount: records, ...(startYear === null ? {} : { startYear, endYear }) }],
          },
        ],
      },
    },
  };
}

const CATALOG: FSCollectionsResponse = {
  results: 2,
  index: 0,
  entries: [
    catalogEntry("1803969", "Illinois, State Census, 1855", 60123, 240768),
    catalogEntry("1803971", "Illinois, State Census, 1865", 95456, 380262),
  ],
};

function locality(collections: unknown[], place = "Ohio, United States") {
  return {
    place,
    collections,
    pages_read: [{ section: "home", url: "u1", found: true }],
    source: "locality-guide",
  };
}

const col = (id: unknown, person_count: unknown, record_count: unknown) => ({
  id,
  title: "Illinois, State Census",
  person_count,
  record_count,
});

describe("research_append stamps locality collection counts from the catalog", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-locality-counts-"));
    for (const f of ["research.json", "tree.gedcomx.json"]) await copyFile(join(SCENARIO, f), join(dir, f));
    clearCollectionsCache();
    mockedGetValidToken.mockReset();
    mockedGetValidToken.mockResolvedValue("tok");
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(JSON.stringify(CATALOG), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const storedCollections = async (locId = "loc_001") =>
    JSON.parse(await readFile(join(dir, "research.json"), "utf-8")).localities.find((l: any) => l.id === locId)
      .collections;

  const appendLocality = (collections: unknown[]) =>
    researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry: locality(collections) } as never,
      collectionCatalogLoader(LOCAL),
    );

  const warningsOf = (r: Awaited<ReturnType<typeof researchAppendFromCaller>>) => {
    expect(r.ok).toBe(true);
    return r.ok ? r.validation.warnings.filter((w) => w.includes("localities collections")) : [];
  };

  it("replaces a wrong count with the catalog's, and warns naming the id and both values", async () => {
    const r = await appendLocality([col("1803969", 0, 60123)]);
    const warnings = warningsOf(r);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 60123 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'1803969'");
    expect(warnings[0]).toContain("person_count 0 -> 240768");
    expect(warnings[0]).not.toContain("record_count");
  });

  it("keeps a correct count with no warning", async () => {
    const r = await appendLocality([col("1803969", 240768, 60123)]);
    expect(warningsOf(r)).toEqual([]);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 60123 });
  });

  it("fills a count the caller left out, and says it was absent", async () => {
    const r = await appendLocality([{ id: "1803971", title: "Illinois, State Census, 1865" }]);
    expect(warningsOf(r)[0]).toContain("person_count absent -> 380262");
    expect((await storedCollections())[0]).toMatchObject({ person_count: 380262, record_count: 95456 });
  });

  it("fills record_count without a warning: collections_search no longer returns it, so locality-guide leaves it out", async () => {
    const r = await appendLocality([{ id: "1803971", title: "Illinois, State Census, 1865", person_count: 380262 }]);
    expect(warningsOf(r)).toEqual([]);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 380262, record_count: 95456 });
  });

  it("nulls both counts of an id the catalog lacks, and warns", async () => {
    const r = await appendLocality([col("9999999", 12, 34), col("1803971", 380262, 95456)]);
    const warnings = warningsOf(r);
    const [missing, known] = await storedCollections();
    expect(missing).toMatchObject({ id: "9999999", person_count: null, record_count: null });
    expect(known).toMatchObject({ person_count: 380262, record_count: 95456 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'9999999' is not in FamilySearch's collection catalog");
  });

  it("stamps a research_append call made through the MCP dispatch", async () => {
    const r = await callTool("research_append", { projectPath: dir, section: "localities", op: "append", entry: locality([col("1803969", 0, 0)]) });
    expect(r.isError).toBe(false);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 60123 });
  });

  it("stamps an entry the caller sent as a JSON string", async () => {
    const r = await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry: JSON.stringify(locality([col("1803969", 0, 0)])) } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(warningsOf(r)[0]).toContain("person_count 0 -> 240768");
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 60123 });
  });

  it("stamps an update whose fields the caller sent as a JSON string", async () => {
    await appendLocality([col("1803969", 240768, 60123)]);
    const r = await researchAppendFromCaller(
      {
        projectPath: dir,
        section: "localities",
        op: "update",
        entryId: "loc_001",
        fields: JSON.stringify({ collections: [col("1803971", 0, 0)] }),
      } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(warningsOf(r)[0]).toContain("'1803971': person_count 0 -> 380262");
    expect((await storedCollections())[0]).toMatchObject({ id: "1803971", person_count: 380262, record_count: 95456 });
  });

  it("does not throw on a collection item that is not an object", async () => {
    await expect(appendLocality([null, col("1803969", 0, 0)])).resolves.toBeDefined();
  });

  it("matches a numeric id and stores it as a string", async () => {
    const r = await appendLocality([col(1803969, 0, 0)]);
    warningsOf(r);
    expect((await storedCollections())[0]).toMatchObject({ id: "1803969", person_count: 240768, record_count: 60123 });
  });

  it("nulls the counts of a collection with no id, and warns", async () => {
    const r = await appendLocality([{ title: "Illinois, State Census, 1855", person_count: 0, record_count: 5 }, col(null, 0, 5)]);
    const warnings = warningsOf(r);
    for (const c of await storedCollections()) expect(c).toMatchObject({ person_count: null, record_count: null });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("a collection with no id cannot be checked");
  });

  it("stores a number id as a string when the catalog cannot be read", async () => {
    mockedGetValidToken.mockRejectedValue(new Error("no token"));
    const r = await appendLocality([col(9999999, 0, 0)]);
    warningsOf(r);
    expect((await storedCollections())[0]).toMatchObject({ id: "9999999", person_count: null });
  });

  it("fails the call on a spent FamilySearch budget, writing nothing", async () => {
    const before = await readFile(join(dir, "research.json"), "utf-8");
    mockedGetValidToken.mockRejectedValue(markFsRefusal(new Error("FamilySearch request budget spent; try again in 30s")));
    await expect(appendLocality([col("1803969", 240768, 240768)])).rejects.toThrow(/budget spent/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  const appendWithLoader = async (loader: () => Promise<ReadonlyMap<string, { personCount: number; recordCount: number }>>) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = researchAppendFromCaller(
        { projectPath: dir, section: "localities", op: "append", entry: locality([col("1803969", 0, 0)]) } as never,
        loader,
      );
      await vi.advanceTimersByTimeAsync(CATALOG_READ_BUDGET_MS);
      vi.useRealTimers();
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  };
  const catalogAfter = (ms: number) => () =>
    new Promise<ReadonlyMap<string, { personCount: number; recordCount: number }>>((done) =>
      setTimeout(() => done(new Map([["1803969", { personCount: 240768, recordCount: 60123 }]])), ms),
    );

  it("uses a catalog read that answers just inside the budget", async () => {
    const r = await appendWithLoader(catalogAfter(CATALOG_READ_BUDGET_MS - 1));
    expect(warningsOf(r)[0]).toContain("person_count 0 -> 240768");
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768 });
  });

  it("stops waiting on a catalog read that outlasts the budget, and nulls the counts", async () => {
    const r = await appendWithLoader(() => new Promise(() => {}));
    expect(warningsOf(r)[0]).toContain("catalog could not be read");
    expect((await storedCollections())[0]).toMatchObject({ person_count: null, record_count: null });
  });

  it("writes with every count null when the catalog cannot be read, and does not pass on the login error", async () => {
    mockedGetValidToken.mockRejectedValue(new Error("User is not logged in to FamilySearch. Call the login tool to authenticate."));
    const r = await appendLocality([col("1803969", 0, 60123), col("1803971", 380262, 95456)]);
    const warnings = warningsOf(r);
    for (const c of await storedCollections()) expect(c).toMatchObject({ person_count: null, record_count: null });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("catalog could not be read");
    expect(warnings[0]).not.toMatch(/login/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("nulls the counts when the catalog answers non-200", async () => {
    mockFetch.mockResolvedValue(new Response("down", { status: 503 }));
    const r = await appendLocality([col("1803969", 240768, 240768)]);
    expect(warningsOf(r)[0]).toContain("catalog could not be read");
    expect((await storedCollections())[0]).toMatchObject({ person_count: null, record_count: null });
  }, 20000);

  it("stamps an update that sets collections", async () => {
    await appendLocality([col("1803969", 240768, 240768)]);
    const r = await researchAppendFromCaller(
      {
        projectPath: dir,
        section: "localities",
        op: "update",
        entryId: "loc_001",
        fields: { collections: [col("1803971", 0, 95456)] },
      } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(warningsOf(r)[0]).toContain("'1803971': person_count 0 -> 380262");
    expect((await storedCollections())[0]).toMatchObject({ id: "1803971", person_count: 380262 });
  });

  it("reads the catalog once for a batch, and warns once per op on a failed read", async () => {
    mockedGetValidToken.mockRejectedValue(new Error("no token"));
    const r = await researchAppendFromCaller(
      {
        projectPath: dir,
        ops: [
          { section: "localities", op: "append", entry: locality([col("1803969", 1, 1)]) },
          { section: "localities", op: "append", entry: locality([col("1803971", 1, 1)]) },
        ],
      } as never,
      collectionCatalogLoader(LOCAL),
    );
    const warnings = warningsOf(r);
    expect(mockedGetValidToken).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^ops\[0\]/);
    expect(warnings[1]).toMatch(/^ops\[1\]/);
  });

  it("does not read the catalog for a call that touches no locality collections", async () => {
    await appendLocality([]);
    mockedGetValidToken.mockClear();
    mockFetch.mockClear();
    const r = await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "update", entryId: "loc_001", fields: { quirks: ["q"] } } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(r.ok).toBe(true);
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });

  // The whole list (spec 5.12): an append gains every catalog collection for its place.
  const ILLINOIS = "Illinois, United States";
  const appendIn = (place: string, collections: unknown, extra: Record<string, unknown> = {}) =>
    researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry: { ...locality([], place), collections, ...extra } } as never,
      collectionCatalogLoader(LOCAL),
    );
  const row1855 = { id: "1803969", title: "Illinois, State Census, 1855", date_range: "1855-1855", person_count: 240768, record_count: 60123 };
  const row1865 = { id: "1803971", title: "Illinois, State Census, 1865", date_range: "1855-1855", person_count: 380262, record_count: 95456 };

  it("an append that sends no collections gets every catalog collection for its place", async () => {
    const r = await appendIn(ILLINOIS, []);
    expect(await storedCollections()).toEqual([row1855, row1865]);
    expect(warningsOf(r)).toEqual([
      'localities collections: added the 2 other FamilySearch collections for "Illinois" from the catalog, after the 0 sent',
    ]);
  });

  it("an append with no collections key is filled the same way", async () => {
    const entry: Record<string, unknown> = locality([], ILLINOIS);
    delete entry.collections;
    const r = await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(r.ok).toBe(true);
    expect(await storedCollections()).toEqual([row1855, row1865]);
  });

  it("keeps what the entry sent first, as stamped, and adds only what it lacks", async () => {
    const r = await appendIn(ILLINOIS, [col("1803971", 0, 95456)]);
    const stored = await storedCollections();
    expect(stored.map((c: any) => c.id)).toEqual(["1803971", "1803969"]);
    expect(stored[0]).toMatchObject({ title: "Illinois, State Census", person_count: 380262 });
    expect(stored[1]).toEqual(row1855);
    const warnings = warningsOf(r);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("person_count 0 -> 380262");
    expect(warnings[1]).toContain("added the 1 other FamilySearch collections");
  });

  it("adds nothing and says nothing when the entry already holds them all", async () => {
    const r = await appendIn(ILLINOIS, [col("1803969", 240768, 60123), col("1803971", 380262, 95456)]);
    expect(await storedCollections()).toHaveLength(2);
    expect(warningsOf(r)).toEqual([]);
  });

  it("keeps a sent collection the catalog's list for the place does not hold", async () => {
    await appendIn(ILLINOIS, [col("9999999", 5, 5)]);
    expect((await storedCollections()).map((c: any) => c.id)).toEqual(["9999999", "1803969", "1803971"]);
  });

  it("takes the scope from a jurisdiction's name when the place names no collection", async () => {
    await appendIn("Illinois Country, New France", [], { jurisdictions: [{ name: "Sangamon, Illinois, United States", date_range: "1821-" }] });
    expect((await storedCollections()).map((c: any) => c.id)).toEqual(["1803969", "1803971"]);
  });

  it("adds nothing for a place whose scope names no collection", async () => {
    const r = await appendIn("Ohio, United States", []);
    expect(await storedCollections()).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });

  it("adds nothing when the catalog cannot be read", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const r = await appendIn(ILLINOIS, []);
    expect(r.ok).toBe(true);
    expect(await storedCollections()).toEqual([]);
  });

  it("adds nothing on an update", async () => {
    await appendIn("Ohio, United States", []);
    await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "update", entryId: "loc_001", fields: { place: ILLINOIS, collections: [col("1803969", 1, 1)] } } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect((await storedCollections()).map((c: any) => c.id)).toEqual(["1803969"]);
  });

  describe("a title that names another part of the scope is not added", () => {
    const PORTUGAL: FSCollectionsResponse = {
      results: 6,
      index: 0,
      entries: [
        catalogEntry("1", "Portugal, Madeira, Catholic Church Records, 1044-1990", 1, 1),
        catalogEntry("2", "Portugal, Aveiro, Catholic Church Records, 1550-1957", 1, 1),
        catalogEntry("3", "Portugal, Azores, Catholic Church Records, 1542-2019", 1, 1),
        catalogEntry("4", "Portugal Baptisms, 1570-1910", 1, 1),
        catalogEntry("5", "Portugal, Civil Records, 1437-2023", 1, 1),
        catalogEntry("6", "Portugal, Passport Registers and Passenger Lists, 1800-1946", 1, 1),
      ],
    };
    const madeira = (collections: unknown[]) =>
      appendIn("Madeira, Portugal", collections, { for_place: "Funchal, Madeira, Portugal", jurisdictions: [{ name: "Funchal, Madeira, Portugal", date_range: "1835-" }] });
    beforeEach(() => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify(PORTUGAL), { status: 200 }));
    });

    it("adds the place's own and the country-wide collections, and says how many it left out", async () => {
      const r = await madeira([]);
      expect((await storedCollections()).map((c: any) => c.id)).toEqual(["1", "4", "5", "6"]);
      expect(warningsOf(r)).toEqual([
        'localities collections: added the 4 other FamilySearch collections for "Portugal" from the catalog, after the 0 sent; ' +
          '2 that name another part of "Portugal" were left out',
      ]);
    });

    it("keeps a collection for another part when the entry itself sent it", async () => {
      await madeira([{ id: "3", title: "Portugal, Azores, Catholic Church Records, 1542-2019" }]);
      expect((await storedCollections()).map((c: any) => c.id)).toEqual(["3", "1", "4", "5", "6"]);
    });

    it("reads a place part with a type in brackets as the part alone", async () => {
      await appendIn("Portugal", [], { jurisdictions: [{ name: "Madeira, Portugal (Autonomous Region)", date_range: "1835-" }] });
      expect((await storedCollections()).map((c: any) => c.id)).toEqual(["1", "4", "5", "6"]);
    });

    it("with no part below the scope, adds only what names no part", async () => {
      await appendIn("Portugal", []);
      expect((await storedCollections()).map((c: any) => c.id)).toEqual(["4", "5", "6"]);
    });
  });

  describe("national collections (spec 5.12): the US, Canada and Mexico get their core country-wide rows", () => {
    const NATIONAL: FSCollectionsResponse = {
      results: 16,
      index: 0,
      entries: [
        catalogEntry("m1", "Michigan, Death Records, 1867-1952", 1, 1, 1867, 1952),
        catalogEntry("us1850", "United States, Census, 1850", 1, 1, 1850),
        catalogEntry("us1900", "United States, Census, 1900", 1, 1, 1900),
        catalogEntry("us1940", "United States, Census, 1940", 1, 1, 1940),
        catalogEntry("usmort", "United States Census (Mortality Schedule), 1850-1880", 1, 1, 1850, 1880),
        catalogEntry("usfb", "United States, Freedmen's Bureau Marriages, 1859-1873", 1, 1, 1859, 1873),
        catalogEntry("usky", "United States, Kentucky, Agricultural Schedules, 1850-1880", 1, 1, 1850, 1880),
        catalogEntry("usvi", "United States Virgin Islands, Census Records, 1841-1911", 1, 1, 1841, 1911),
        catalogEntry("ussdi", "United States, Social Security Death Index", 1, 1, null),
        catalogEntry("ca1901", "Canada, Census, 1901", 1, 1, 1901),
        catalogEntry("caon", "Canada, Ontario, Births, 1869-1912", 1, 1, 1869, 1912),
        catalogEntry("mx1930", "Mexico, National Census, 1930", 1, 1, 1929, 1931),
        catalogEntry("mxbap", "Mexico, Baptisms, 1560-1950", 1, 1, 1559, 1950),
        catalogEntry("mxja", "Mexico, Jalisco, Civil Registration, 1857-2000", 1, 1, 1857, 2000),
        catalogEntry("mxso", "Mexico, Sonora, Catholic Church Records, 1657-1994", 1, 1, 1657, 1994),
        catalogEntry("nm", "New Mexico, Deaths, 1889-1945", 1, 1, 1889, 1945),
      ],
    };
    beforeEach(() => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify(NATIONAL), { status: 200 }));
    });
    const ids = async () => (await storedCollections()).map((c: any) => c.id);
    const DETROIT = "Wayne, Michigan, United States";

    it("adds the core national rows that overlap the time period, after the place's own, and says so", async () => {
      const r = await appendIn(DETROIT, [], { time_period: "1870-1930" });
      expect(await ids()).toEqual(["m1", "us1900", "usmort", "ussdi"]);
      expect(warningsOf(r)).toEqual([
        'localities collections: added the 1 other FamilySearch collections for "Michigan" from the catalog, after the 0 sent',
        'localities collections: added the 3 core national FamilySearch collections for "United States" overlapping 1870-1930 from the catalog',
      ]);
    });

    it("gives a bare Mexico place its country-wide baptism index when no census falls in the period", async () => {
      await appendIn("Mexico", [], { time_period: "1880-1920" });
      expect(await ids()).toEqual(["mxbap"]);
    });

    it("leaves a national collection that depends on who the person was to the planner's own search", async () => {
      await appendIn(DETROIT, [], { time_period: "1859-1873" });
      expect(await ids()).not.toContain("usfb");
    });

    it("gives a bare country-level place the core rows only, not the country's whole list", async () => {
      await appendIn("United States", [], { time_period: "1870-1930" });
      expect(await ids()).toEqual(["us1900", "usmort", "ussdi"]);
    });

    it("keeps an undated national row, and cuts nothing for a time period with no year", async () => {
      await appendIn(DETROIT, [], { time_period: "the Detroit years" });
      expect(await ids()).toEqual(["m1", "us1850", "us1900", "us1940", "usmort", "ussdi"]);
    });

    it("still adds national rows to an entry that already sent every place row", async () => {
      const r = await appendIn(DETROIT, [{ id: "m1", title: "Michigan, Death Records, 1867-1952", person_count: 1, record_count: 1 }], { time_period: "1895-1905" });
      expect(await ids()).toEqual(["m1", "us1900", "ussdi"]);
      expect(warningsOf(r)).toEqual([
        'localities collections: added the 2 core national FamilySearch collections for "United States" overlapping 1895-1905 from the catalog',
      ]);
    });

    it("gives Canada its national census, not another province's rows", async () => {
      await appendIn("Halifax, Nova Scotia, Canada", [], { time_period: "1836-1910" });
      expect(await ids()).toEqual(["ca1901"]);
    });

    it("adds no duplicate for a country-level place the place fill already covered", async () => {
      await appendIn("Canada", [], { time_period: "1890-1910" });
      const stored = await ids();
      expect(stored.filter((id: string) => id === "ca1901")).toHaveLength(1);
    });

    it("gives Mexico its national census, not New Mexico's or another state's rows", async () => {
      await appendIn("Guadalajara, Jalisco, Mexico", [], { time_period: "1920-1940" });
      expect(await ids()).toEqual(["mxja", "mx1930", "mxbap"]);
    });

    it("adds nothing national for a place outside the three countries", async () => {
      const r = await appendIn("Funchal, Madeira, Portugal", [], { time_period: "1830-1910" });
      expect(r.ok).toBe(true);
      expect(warningsOf(r).some((w) => w.includes("national"))).toBe(false);
    });

    it("holds the whole list at the cap, and says how many of the national rows it added", async () => {
      const many: FSCollectionsResponse = {
        results: LOCALITY_COLLECTIONS_FILL_MAX + 5,
        index: 0,
        entries: Array.from({ length: LOCALITY_COLLECTIONS_FILL_MAX + 5 }, (_, j) =>
          catalogEntry(`n${j}`, "United States, Census, 1900", 1, 1, 1900),
        ),
      };
      mockFetch.mockResolvedValue(new Response(JSON.stringify(many), { status: 200 }));
      const r = await appendIn(DETROIT, [], { time_period: "1870-1930" });
      expect(await storedCollections()).toHaveLength(LOCALITY_COLLECTIONS_FILL_MAX);
      expect(warningsOf(r)).toEqual([
        `localities collections: added ${LOCALITY_COLLECTIONS_FILL_MAX} of the ${LOCALITY_COLLECTIONS_FILL_MAX + 5} core national FamilySearch collections for "United States" overlapping 1870-1930 from the catalog`,
      ]);
    });
  });

  it("leaves a collections value that is not a list for the validator to refuse", async () => {
    const r = await appendIn(ILLINOIS, "all of them");
    expect(r.ok).toBe(false);
  });

  it("does not stamp when the loader is null (the unit eval harness)", async () => {
    const r = await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry: locality([col("1803969", 0, 5)]) } as never,
      null,
    );
    expect(warningsOf(r)).toEqual([]);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 0, record_count: 5 });
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });

  it("does not stamp an internal researchAppend write", async () => {
    const r = await researchAppend({ projectPath: dir, section: "localities", op: "append", entry: locality([col("1803969", 0, 5)]) });
    expect(r.ok).toBe(true);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 0, record_count: 5 });
    expect(mockedGetValidToken).not.toHaveBeenCalled();
  });
});
