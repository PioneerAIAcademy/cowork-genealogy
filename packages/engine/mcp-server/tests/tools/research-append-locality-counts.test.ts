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
import { researchAppend, researchAppendFromCaller, CATALOG_READ_BUDGET_MS } from "../../src/tools/research-append.js";
import { markFsRefusal } from "../../src/utils/fs-budget.js";
import { clearCollectionsCache, collectionCatalogLoader } from "../../src/tools/collections-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { LOCAL } from "../../src/auth/principal.js";
import type { FSCollectionsResponse } from "../../src/types/collection.js";

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/mid-research-flynn");
const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();

function catalogEntry(id: string, title: string, records: number, persons: number) {
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
            searchMetadata: [{ imageCount: 7754, recordCount: records, startYear: 1855, endYear: 1855 }],
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
    catalogEntry("1803969", "Illinois, State Census, 1855", 240768, 240768),
    catalogEntry("1803971", "Illinois, State Census, 1865", 380262, 380262),
  ],
};

function locality(collections: unknown[]) {
  return {
    place: "Illinois, United States",
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
    const r = await appendLocality([col("1803969", 0, 240768)]);
    const warnings = warningsOf(r);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 240768 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'1803969'");
    expect(warnings[0]).toContain("person_count 0 -> 240768");
    expect(warnings[0]).not.toContain("record_count");
  });

  it("keeps a correct count with no warning", async () => {
    const r = await appendLocality([col("1803969", 240768, 240768)]);
    expect(warningsOf(r)).toEqual([]);
    expect((await storedCollections())[0]).toMatchObject({ person_count: 240768, record_count: 240768 });
  });

  it("fills a count the caller left out, and says it was absent", async () => {
    const r = await appendLocality([{ id: "1803971", title: "Illinois, State Census, 1865" }]);
    expect(warningsOf(r)[0]).toContain("person_count absent -> 380262");
    expect((await storedCollections())[0]).toMatchObject({ person_count: 380262, record_count: 380262 });
  });

  it("nulls both counts of an id the catalog lacks, and warns", async () => {
    const r = await appendLocality([col("9999999", 12, 34), col("1803971", 380262, 380262)]);
    const warnings = warningsOf(r);
    const [missing, known] = await storedCollections();
    expect(missing).toMatchObject({ id: "9999999", person_count: null, record_count: null });
    expect(known).toMatchObject({ person_count: 380262, record_count: 380262 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'9999999' is not in FamilySearch's collection catalog");
  });

  it("matches a numeric id and stores it as a string", async () => {
    const r = await appendLocality([col(1803969, 0, 0)]);
    warningsOf(r);
    expect((await storedCollections())[0]).toMatchObject({ id: "1803969", person_count: 240768, record_count: 240768 });
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
      setTimeout(() => done(new Map([["1803969", { personCount: 240768, recordCount: 240768 }]])), ms),
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
    const r = await appendLocality([col("1803969", 0, 240768), col("1803971", 380262, 380262)]);
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
        fields: { collections: [col("1803971", 0, 380262)] },
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

  it("does not read the catalog for a call with no locality collections", async () => {
    const r = await researchAppendFromCaller(
      { projectPath: dir, section: "localities", op: "append", entry: locality([]) } as never,
      collectionCatalogLoader(LOCAL),
    );
    expect(r.ok).toBe(true);
    expect(mockedGetValidToken).not.toHaveBeenCalled();
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
