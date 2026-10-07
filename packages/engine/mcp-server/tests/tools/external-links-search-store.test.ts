import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { externalLinksSearchTool } from "../../src/tools/external-links-search.js";
import { collectionKey, dedupeCollections } from "../../src/utils/external-collections-store.js";
import { researchQuery } from "../../src/tools/research-query.js";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import { runWithProjectStore, type ProjectStore } from "../../src/store/project-store.js";
import { projectContext } from "../../src/tools/project-context.js";

// The stored list (external-collections.json) through the real file store, on a
// real temp project. Only the network and the place resolver are mocked.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockResolve = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { resolveStandardPlaceToPlaceId: mockResolve, ambiguousPlaceError: real.ambiguousPlaceError };
});

const PA = "Pennsylvania, United States";
const SCHUYLKILL = "Schuylkill, Pennsylvania, United States";
const VENANGO = "Venango, Pennsylvania, United States";

function response(collections: unknown[], totalResults = collections.length): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ totalResults, collections }),
    headers: new Headers(),
  } as unknown as Response;
}

// Pennsylvania's list, shaped like the live one: the same URL more than once with
// different link text and years (84 of PA's 350 URLs do this), an Ancestry id with
// and without a trailing slash, and a MyHeritage URL with tracking parameters.
const paRows = [
  { url: "https://www.ancestry.com/search/collections/5164", linkText: "PA Wills", place: PA, record_type: "Probate", cost: "paid", content_type: "index", startYear: "1683", endYear: "1993" },
  { url: "https://www.ancestry.com/search/collections/5164/", linkText: "Pennsylvania Wills and Probate", place: PA, record_type: "Wills", cost: "paid", content_type: "index & images", startYear: "1700", endYear: "1800" },
  { url: "https://www.hsp.org/", linkText: "Historical Society of Pennsylvania", place: PA, record_type: "Societies", cost: "free", content_type: "unknown", startYear: "", endYear: "" },
  { url: "https://www.hsp.org/", linkText: "Subject Guide: Family History & Genealogy", place: PA, record_type: "Guides", cost: "free", content_type: "unknown", startYear: "1850", endYear: "1900" },
  { url: "https://www.myheritage.com/research/collection-10724/pa-deaths?utm_source=blog", linkText: "PA Deaths", place: PA, record_type: "Death", cost: "paid", content_type: "index", startYear: "1906", endYear: "1964" },
];
const schuylkillOnly = [
  { url: "https://example.org/schuylkill-churches", linkText: "Schuylkill churches", place: SCHUYLKILL, record_type: "Church Records", cost: "free", content_type: "index", startYear: "", endYear: "" },
  { url: "https://example.org/schuylkill-mines", linkText: "Schuylkill mine deaths", place: SCHUYLKILL, record_type: "Death", cost: "free", content_type: "index", startYear: "1870", endYear: "1930" },
];

let project: string;

beforeEach(async () => {
  mockFetch.mockReset();
  mockResolve.mockReset();
  mockResolve.mockResolvedValue({ kind: "resolved", placeId: "23" });
  project = await mkdtemp(join(tmpdir(), "ext-coll-"));
  await writeFile(join(project, "research.json"), "{}");
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const stored = async () => JSON.parse(await readFile(join(project, "external-collections.json"), "utf-8"));

describe("collection keys and dedupe", () => {
  it("keys an Ancestry id the same in every URL form, MyHeritage without its query, else the URL", () => {
    expect(collectionKey("https://www.ancestry.com/search/collections/5164")).toBe("ancestry:5164");
    expect(collectionKey("https://www.ancestry.com/search/collections/5164/")).toBe("ancestry:5164");
    expect(collectionKey("https://search.ancestry.com/cgi-bin/sse.dll?dbid=5164&h=1")).toBe("ancestry:5164");
    expect(collectionKey("https://www.myheritage.com/research/collection-10724/x?utm_source=b")).toBe(
      "https://www.myheritage.com/research/collection-10724/x",
    );
    expect(collectionKey("https://www.hsp.org/")).toBe("https://www.hsp.org/");
    expect(collectionKey("https://example.com/?dbid=5")).toBe("https://example.com/?dbid=5");
  });

  it("merges record types, spans the years, and stays undated when any variant is", () => {
    const rows = dedupeCollections(paRows);
    const wills = rows.find((r) => r.key === "ancestry:5164")!;
    expect(wills.record_types).toEqual(["Probate", "Wills"]);
    expect([wills.start_year, wills.end_year]).toEqual(["1683", "1993"]);
    // One hsp.org copy is undated, so the merged row is too: a year filter that
    // would have kept that copy keeps the row.
    const hsp = rows.find((r) => r.key === "https://www.hsp.org/")!;
    expect([hsp.start_year, hsp.end_year]).toEqual(["", ""]);
    expect(rows).toHaveLength(3);
  });

  it("counts a one-sided copy as that single year in the span", () => {
    const [row] = dedupeCollections([
      { url: "https://x.org/a", place: PA, startYear: "1900", endYear: "" },
      { url: "https://x.org/a", place: PA, startYear: "", endYear: "1850" },
    ]);
    expect([row.start_year, row.end_year]).toEqual(["1850", "1900"]);
  });

  it("does not treat a tracking or id query as place-scoping", () => {
    const [mh] = dedupeCollections([
      { url: "https://www.myheritage.com/research/collection-1/x", place: PA },
      { url: "https://www.myheritage.com/research/collection-1/x?s=218489221&utm_source=b", place: PA },
    ]);
    expect(mh.url).toBe("https://www.myheritage.com/research/collection-1/x");
  });

  it("keeps the URL that scopes the search to the place over a bare one", () => {
    const rows = dedupeCollections([
      { url: "https://www.ancestry.com/search/collections/7488", linkText: "Passenger lists", place: PA },
      { url: "https://www.ancestry.com/search/collections/7488?arrival=_pennsylvania-usa_41", linkText: "Passenger lists", place: PA },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://www.ancestry.com/search/collections/7488?arrival=_pennsylvania-usa_41");
  });

  it("is independent of the API's row order", () => {
    const a = JSON.stringify(dedupeCollections(paRows));
    const b = JSON.stringify(dedupeCollections([...paRows].reverse()));
    const c = JSON.stringify(dedupeCollections([paRows[3], paRows[1], paRows[4], paRows[0], paRows[2]]));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("external_links_search stores the full list in external-collections.json", () => {
  it("writes byte-identical files when the same place comes back in a different order", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    const first = await readFile(join(project, "external-collections.json"), "utf-8");

    mockFetch.mockResolvedValueOnce(response([...paRows].reverse()));
    await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    expect(await readFile(join(project, "external-collections.json"), "utf-8")).toBe(first);
  });

  it("files a county fetch by each link's own place: the state entry once, the county's own rows", async () => {
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    const r = await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const doc = await stored();
    expect(Object.keys(doc.places)).toEqual([PA, SCHUYLKILL]);
    expect(doc.places[PA].rows).toHaveLength(3);
    expect(doc.places[SCHUYLKILL].rows).toHaveLength(2);
    expect(r.stored).toEqual({ file: "external-collections.json", places: [PA, SCHUYLKILL] });
  });

  it("writes an empty entry for a county with nothing of its own, and research_query reaches its state's rows", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    await externalLinksSearchTool({ standardPlace: VENANGO, projectPath: project });
    const doc = await stored();
    expect(doc.places[VENANGO]).toEqual({ rows: [] });
    expect(doc.places[PA].rows).toHaveLength(3);

    const q = await researchQuery({ projectPath: project, section: "external_collections", place: VENANGO });
    expect(q.ok && q.count).toBe(3);
    expect(q.ok && q.items.every((i: { place: string }) => i.place === PA)).toBe(true);
  });

  it("keeps one copy of the state's list across two counties", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    await externalLinksSearchTool({ standardPlace: VENANGO, projectPath: project });
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const doc = await stored();
    expect(Object.keys(doc.places)).toEqual([PA, SCHUYLKILL, VENANGO]);
    expect(doc.places[PA].rows).toHaveLength(3);
    expect(doc.places[SCHUYLKILL].rows).toHaveLength(2);
    expect(doc.places[VENANGO].rows).toEqual([]);
  });

  it("stores every year even when the call filters the inline copy by year", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    const r = await externalLinksSearchTool({ standardPlace: PA, startYear: 1950, endYear: 1960, projectPath: project });
    expect(r.results.map((x) => x.url).sort()).toEqual([
      "https://www.ancestry.com/search/collections/5164",
      "https://www.hsp.org/",
      "https://www.myheritage.com/research/collection-10724/pa-deaths?utm_source=blog",
    ]);
    expect((await stored()).places[PA].rows).toHaveLength(3);
  });

  it("writes nothing when the list is refused as partial", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows, 510));
    await expect(externalLinksSearchTool({ standardPlace: PA, projectPath: project })).rejects.toThrow(/partial/);
    expect(await readdir(project)).not.toContain("external-collections.json");
  });

  it("writes nothing when totalResults is missing, or over the 1,000-row cap", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK", headers: new Headers(),
      json: async () => ({ collections: paRows }),
    } as unknown as Response);
    await expect(externalLinksSearchTool({ standardPlace: PA, projectPath: project })).rejects.toThrow(/no totalResults/);
    mockFetch.mockResolvedValueOnce(response(paRows, 1998));
    await expect(externalLinksSearchTool({ standardPlace: "United States", projectPath: project })).rejects.toThrow(/1998/);
    expect(await readdir(project)).not.toContain("external-collections.json");
  });

  it("never creates the file in a folder that is not a project", async () => {
    const plain = await mkdtemp(join(tmpdir(), "ext-coll-plain-"));
    try {
      mockFetch.mockResolvedValueOnce(response(paRows));
      const r = await externalLinksSearchTool({ standardPlace: PA, projectPath: plain });
      expect(r.stored).toBeUndefined();
      expect(r.collectionsError).toMatch(/Nothing was stored/);
      expect(await readdir(plain)).not.toContain("external-collections.json");
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("a stored list that cannot be read", () => {
  it("is rebuilt when it is not valid JSON, keeping this fetch's rows", async () => {
    await writeFile(join(project, "external-collections.json"), "{not json");
    mockFetch.mockResolvedValueOnce(response(paRows));
    const r = await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    expect(r.stored?.places).toEqual([PA]);
    expect((await stored()).places[PA].rows).toHaveLength(3);
  });

  it("fails the write rather than wiping other places when the read itself fails", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    const before = await readFile(join(project, "external-collections.json"), "utf-8");

    const real = new FsProjectStore();
    const failingRead = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      readText: async () => {
        throw new Error("store unavailable");
      },
    }) as ProjectStore;
    mockFetch.mockResolvedValueOnce(response(schuylkillOnly));
    const r = await runWithProjectStore(failingRead, () =>
      externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project }),
    );
    expect(typeof r.collectionsError).toBe("string");
    expect(r.stored).toBeUndefined();
    expect(await readFile(join(project, "external-collections.json"), "utf-8")).toBe(before);
  });
});

describe("research_query section external_collections", () => {
  it("answers count 0 when nothing has been stored yet", async () => {
    const q = await researchQuery({ projectPath: project, section: "external_collections" });
    expect(q).toEqual({ ok: true, section: "external_collections", count: 0, items: [], truncated: false });
  });

  it("filters by record type, case-insensitive substring over the merged types", async () => {
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const deaths = await researchQuery({ projectPath: project, section: "external_collections", recordType: "DEATH" });
    expect(deaths.ok && deaths.items.map((i: { key: string }) => i.key)).toEqual([
      "https://www.myheritage.com/research/collection-10724/pa-deaths",
      "https://example.org/schuylkill-mines",
    ]);
    const wills = await researchQuery({ projectPath: project, section: "external_collections", recordType: "will" });
    expect(wills.ok && wills.count).toBe(1);
  });

  it("does not let a place filter reach a sibling county", async () => {
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const q = await researchQuery({ projectPath: project, section: "external_collections", place: VENANGO });
    expect(q.ok && q.items.some((i: { place: string }) => i.place === SCHUYLKILL)).toBe(false);
    expect(q.ok && q.count).toBe(3);
  });

  it("is an error, not an empty answer, when the file is not this shape", async () => {
    await writeFile(join(project, "external-collections.json"), "[]");
    const q = await researchQuery({ projectPath: project, section: "external_collections" });
    expect(q.ok).toBe(false);
  });

  it("answers no_project for a folder that is not a project", async () => {
    const plain = await mkdtemp(join(tmpdir(), "ext-coll-plain-"));
    try {
      const q = await researchQuery({ projectPath: plain, section: "external_collections" });
      expect(q).toMatchObject({ ok: false, reason: "no_project" });
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("rejects its filters on other sections", async () => {
    const q = await researchQuery({ projectPath: project, section: "sources", place: PA });
    expect(q.ok).toBe(false);
  });
});

describe("project_context counts the stored lists", () => {
  beforeEach(async () => {
    await writeFile(join(project, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }));
  });

  it("reports per-place counts by record type, never rows", async () => {
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const ctx = await projectContext({ projectPath: project });
    expect(ctx.ok && ctx.externalCollections).toEqual({
      [PA]: { total: 3, byRecordType: { Death: 1, Guides: 1, Probate: 1, Societies: 1, Wills: 1 } },
      [SCHUYLKILL]: { total: 2, byRecordType: { "Church Records": 1, Death: 1 } },
    });
  });

  it("omits the field when nothing is stored, and never fails on an unreadable file", async () => {
    const none = await projectContext({ projectPath: project });
    expect(none.ok && "externalCollections" in none).toBe(false);
    await writeFile(join(project, "external-collections.json"), "{not json");
    const bad = await projectContext({ projectPath: project });
    expect(bad.ok).toBe(true);
    expect(bad.ok && "externalCollections" in bad).toBe(false);
  });
});

describe("stored-list edges", () => {
  const row = (key: string, place: string, extra: Record<string, unknown> = {}) => ({
    key, url: key, link_text: key, record_types: ["Census"], place, cost: "free",
    content_type: "index", start_year: "", end_year: "", ...extra,
  });

  it("research_query sorts places and rows itself, whatever order the file holds them in", async () => {
    await writeFile(join(project, "external-collections.json"), JSON.stringify({
      places: {
        [VENANGO]: { rows: [row("z", VENANGO), row("a", VENANGO)] },
        [PA]: { rows: [row("m", PA), row("b", PA)] },
      },
    }));
    const q = await researchQuery({ projectPath: project, section: "external_collections" });
    expect(q.ok && q.items.map((i: { place: string; key: string }) => `${i.place}|${i.key}`)).toEqual([
      `${PA}|b`, `${PA}|m`, `${VENANGO}|a`, `${VENANGO}|z`,
    ]);
  });

  it("pages the section 50 at a time", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`k${String(i).padStart(2, "0")}`, PA));
    await writeFile(join(project, "external-collections.json"), JSON.stringify({ places: { [PA]: { rows } } }));
    const p1 = await researchQuery({ projectPath: project, section: "external_collections" });
    expect(p1.ok && [p1.count, p1.items.length, p1.truncated]).toEqual([60, 50, true]);
    const p2 = await researchQuery({ projectPath: project, section: "external_collections", offset: 50 });
    expect(p2.ok && p2.items.map((i: { key: string }) => i.key)).toEqual(rows.slice(50).map((r) => r.key));
    expect(p2.ok && p2.truncated).toBe(false);
  });

  it("a state query does not return its counties' rows", async () => {
    mockFetch.mockResolvedValueOnce(response([...paRows, ...schuylkillOnly]));
    await externalLinksSearchTool({ standardPlace: SCHUYLKILL, projectPath: project });
    const q = await researchQuery({ projectPath: project, section: "external_collections", place: PA });
    expect(q.ok && q.items.every((i: { place: string }) => i.place === PA)).toBe(true);
  });

  it("rejects a file whose places is an array", async () => {
    await writeFile(join(project, "external-collections.json"), JSON.stringify({ places: [] }));
    const q = await researchQuery({ projectPath: project, section: "external_collections" });
    expect(q.ok).toBe(false);
  });

  it("keeps the search when the store write fails, and says why", async () => {
    await mkdir(join(project, "external-collections.json"));
    mockFetch.mockResolvedValueOnce(response(paRows));
    const r = await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    expect(r.results.length).toBeGreaterThan(0);
    expect(typeof r.collectionsError).toBe("string");
    expect(r.stored).toBeUndefined();
  });

  it("files a row with no place under the queried place", async () => {
    mockFetch.mockResolvedValueOnce(response([{ url: "https://example.org/x", linkText: "X" }]));
    await externalLinksSearchTool({ standardPlace: VENANGO, projectPath: project });
    const doc = await stored();
    expect(Object.keys(doc.places)).toEqual([VENANGO]);
    expect(doc.places[VENANGO].rows).toHaveLength(1);
  });

  it("a re-fetch replaces the place's rows, so a withdrawn collection leaves the list", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    mockFetch.mockResolvedValueOnce(response(paRows.slice(0, 2)));
    await externalLinksSearchTool({ standardPlace: PA, projectPath: project });
    expect((await stored()).places[PA].rows.map((r: { key: string }) => r.key)).toEqual(["ancestry:5164"]);
  });

  it("counts totalForPlace after dedupe, and takes text and cost from the first variant", async () => {
    mockFetch.mockResolvedValueOnce(response(paRows));
    const r = await externalLinksSearchTool({ standardPlace: PA });
    expect(r.totalForPlace).toBe(3);
    const wills = dedupeCollections(paRows).find((x) => x.key === "ancestry:5164")!;
    expect([wills.link_text, wills.cost, wills.content_type]).toEqual(["PA Wills", "paid", "index"]);
  });

  it("accepts exactly 1,000 rows as a complete list", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ url: `https://example.org/${i}`, place: PA }));
    mockFetch.mockResolvedValueOnce(response(rows));
    const r = await externalLinksSearchTool({ standardPlace: PA });
    expect(r.totalForPlace).toBe(1000);
  });

  it("puts the county's own rows first, so the cap never drops them", async () => {
    const state = Array.from({ length: 250 }, (_, i) => ({ url: `https://example.com/s${String(i).padStart(3, "0")}`, place: PA }));
    mockFetch.mockResolvedValueOnce(response([...state, ...schuylkillOnly]));
    const r = await externalLinksSearchTool({ standardPlace: SCHUYLKILL });
    expect(r.inlineCapped).toBe(true);
    expect(r.results.slice(0, 2).map((x) => x.url).sort()).toEqual(schuylkillOnly.map((x) => x.url).sort());
  });

  it("keeps the inline copy in place-then-key order, so the cap drops the end of it", async () => {
    const rows = Array.from({ length: 260 }, (_, i) => ({ url: `https://example.com/c${String(259 - i).padStart(3, "0")}`, place: PA }));
    mockFetch.mockResolvedValueOnce(response(rows));
    const r = await externalLinksSearchTool({ standardPlace: PA });
    expect(r.results[0].url).toBe("https://example.com/c000");
    expect(r.results[199].url).toBe("https://example.com/c199");
  });

  it("project_context sorts places and record types", async () => {
    await writeFile(join(project, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }));
    await writeFile(join(project, "external-collections.json"), JSON.stringify({
      places: {
        [VENANGO]: { rows: [] },
        [PA]: { rows: [row("a", PA, { record_types: ["Wills", "Census"] })] },
      },
    }));
    const ctx = await projectContext({ projectPath: project });
    const ec = ctx.ok ? ctx.externalCollections! : {};
    expect(Object.keys(ec)).toEqual([PA, VENANGO]);
    expect(Object.keys(ec[PA].byRecordType)).toEqual(["Census", "Wills"]);
  });
});
