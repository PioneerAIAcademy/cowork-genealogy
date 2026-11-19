import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dedupeCollections } from "../../src/utils/external-collections-store.js";
import {
  parentLevel,
  placeName,
  runLocalitySurvey,
  splitSections,
  surveyCallPlan,
} from "../../src/tools/locality-survey.js";
import type { SurveyDeps, SurveyPage } from "../../src/types/locality-survey.js";
import type { StoredCollectionRow } from "../../src/utils/external-collections-store.js";
import type { VolumeGroup, VolumeSearchResult } from "../../src/types/volume-search.js";
import { TOOL_RESULT_CHAR_BUDGET } from "../../src/constants.js";

const WIKI = "https://www.familysearch.org/en/wiki";

function volume(id: string): VolumeGroup {
  return {
    imageGroupNumber: id,
    imageCount: 100,
    recordSearchablePercent: 0,
    fulltextSearchable: false,
    title: `Volume ${id}`,
    languages: [],
    coverages: [],
  };
}

function volumes(place: string, ids: string[], total = ids.length): VolumeSearchResult {
  return {
    query: { standardPlace: place, pageSize: 10 },
    totalResults: total,
    results: ids.map(volume),
    summary: {
      totalVolumes: total,
      complete: true,
      byRecordType: [{ group: "Probate", volumes: total, browseOnly: total, fulltextOnly: 0 }],
      untyped: { volumes: 0, browseOnly: 0, fulltextOnly: 0 },
    },
  };
}

function linkRow(url: string, place: string, recordTypes: string[] = [], linkText = url): StoredCollectionRow {
  return {
    key: url,
    url,
    link_text: linkText,
    record_types: recordTypes,
    place,
    cost: "",
    content_type: "",
    start_year: "",
    end_year: "",
  };
}

const page = (slug: string, content: string): SurveyPage => ({ url: `${WIKI}/${slug}`, content });

/** Deps with an empty answer for every part; `over` replaces any of them. Records every call. */
function deps(over: Partial<SurveyDeps> = {}, calls: string[] = []): SurveyDeps {
  const log =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    (...a: A) => {
      calls.push(`${name} ${JSON.stringify(a[0])}${a[1] && typeof a[1] === "string" ? ` ${a[1]}` : ""}`);
      return fn(...a);
    };
  const base: SurveyDeps = {
    population: async () => ({ place: { place_id: "1", name: "x", level: "x" }, population: {} }),
    collections: async () => ({ collectionUrl: "https://www.familysearch.org/search/collection/{id}", scope: "x", totalForPlace: 0, results: [] }),
    volumes: async (a) => volumes(a.standardPlace, []),
    catalog: async () => ({ totalHits: 0, returned: 0, placeResolved: true, hydrationTimedOut: false, hydrateRequested: 10, hits: [] }),
    linkRows: async () => ({ rows: [] }),
    placePage: async () => null,
    page: async () => null,
    ...over,
  };
  return {
    ...base,
    population: log("population", base.population),
    collections: log("collections", base.collections),
    volumes: log("volumes", base.volumes),
    catalog: log("catalog", base.catalog),
    linkRows: log("linkRows", base.linkRows),
    placePage: log("placePage", base.placePage),
    page: log("page", base.page),
  };
}

describe("place names", () => {
  it("strips a trailing type and takes the parent below a country", () => {
    expect(placeName("Halifax, Nova Scotia, Canada (Independent City)")).toBe("Halifax, Nova Scotia, Canada");
    expect(parentLevel("Detroit, Wayne, Michigan, United States")).toBe("Wayne, Michigan, United States");
    expect(parentLevel("Halifax, Nova Scotia, Canada (Independent City)")).toBe("Nova Scotia, Canada");
    expect(parentLevel("Pennsylvania, United States")).toBeNull();
    expect(parentLevel("England")).toBeNull();
  });
});

describe("surveyCallPlan", () => {
  it("lists both volume and link levels for a city, the section pages at its state, and the vital-records ladder", () => {
    const plan = surveyCallPlan({ standardPlace: "Detroit, Wayne, Michigan, United States", startYear: 1870, endYear: 1930 });
    const of = (tool: string) => plan.filter((c) => c.tool === tool).map((c) => c.args);
    expect(of("volume_search").map((a: any) => a.standardPlace)).toEqual([
      "Detroit, Wayne, Michigan, United States",
      "Wayne, Michigan, United States",
    ]);
    expect(of("external_links_search").map((a: any) => a.standardPlace)).toEqual([
      "Detroit, Wayne, Michigan, United States",
      "Wayne, Michigan, United States",
    ]);
    expect(of("wiki_place_page").filter((a: any) => a.section === "getting_started").map((a: any) => a.standardPlace)).toEqual([
      "Michigan, United States",
      "United States",
    ]);
    expect(of("wiki_read").map((a: any) => a.url)).toEqual([
      `${WIKI}/Michigan_Vital_Records`,
      `${WIKI}/Michigan_Civil_Registration`,
      `${WIKI}/United_States_Vital_Records`,
      `${WIKI}/United_States_Civil_Registration`,
    ]);
  });

  it("makes no parent call for a state", () => {
    const plan = surveyCallPlan({ standardPlace: "Pennsylvania, United States" });
    expect(plan.filter((c) => c.tool === "volume_search")).toHaveLength(1);
    expect(plan.filter((c) => c.tool === "external_links_search")).toHaveLength(1);
  });
});

describe("runLocalitySurvey", () => {
  it("climbs the catalog once on no hits, and stops", async () => {
    const calls: string[] = [];
    await runLocalitySurvey(
      { standardPlace: "Javorje, Škofja Loka, Slovenia" },
      deps({}, calls),
    );
    expect(calls.filter((c) => c.startsWith("catalog"))).toEqual([
      'catalog {"standardPlace":"Javorje, Škofja Loka, Slovenia"}',
      'catalog {"standardPlace":"Škofja Loka, Slovenia"}',
    ]);
  });

  it("does not climb the catalog when the place has hits", async () => {
    const calls: string[] = [];
    await runLocalitySurvey(
      { standardPlace: "Schuylkill, Pennsylvania, United States" },
      deps({ catalog: async () => ({ totalHits: 3, returned: 0, placeResolved: true, hydrationTimedOut: false, hydrateRequested: 10, hits: [] }) }, calls),
    );
    expect(calls.filter((c) => c.startsWith("catalog"))).toHaveLength(1);
  });

  it("reads a four-part city's section pages at its state", async () => {
    const calls: string[] = [];
    const out: any = await runLocalitySurvey(
      { standardPlace: "Detroit, Wayne, Michigan, United States" },
      deps(
        {
          placePage: async (place, section) =>
            section !== "home" && place === "Michigan, United States"
              ? page(`Michigan_${section}`, "Text about Michigan.")
              : null,
        },
        calls,
      ),
    );
    expect(out.wikiPages.getting_started).toMatchObject({ found: true, url: `${WIKI}/Michigan_getting_started` });
    expect(calls.some((c) => c.includes('"Detroit, Wayne, Michigan, United States" getting_started'))).toBe(false);
  });

  it("reads England's civil-registration page after its vital-records page is missing", async () => {
    const out: any = await runLocalitySurvey(
      { standardPlace: "Yorkshire, England, United Kingdom" },
      deps({
        page: async (url) =>
          url === `${WIKI}/England_Civil_Registration` ? page("England_Civil_Registration", "Civil registration began in 1837.") : null,
      }),
    );
    expect(out.vitalRecords).toMatchObject({ found: true, url: `${WIKI}/England_Civil_Registration` });
    expect(out.vitalRecords.content).toContain("1837");
  });

  it("refuses a state-level topic page that belongs to another place", async () => {
    const georgia = "[Georgia](https://www.familysearch.org/en/wiki/Georgia,_United_States_Genealogy \"x\")\nStatewide 1919.";
    const out: any = await runLocalitySurvey(
      { standardPlace: "Tbilisi, Georgia" },
      deps({ page: async (url) => (url === `${WIKI}/Tbilisi_Vital_Records` ? page("Tbilisi_Vital_Records", georgia) : null) }),
    );
    expect(out.vitalRecords.found).toBe(false);
  });

  it("gives found: false and no outcome when no level has the page", async () => {
    const out: any = await runLocalitySurvey({ standardPlace: "Billy, County Antrim, Ireland" }, deps());
    expect(out.pagesRead).toEqual([
      { section: "home", url: null, found: false },
      { section: "getting_started", url: null, found: false },
      { section: "online_records", url: null, found: false },
      { section: "research_tips", url: null, found: false },
    ]);
  });

  it("marks a page whose read threw as unreachable", async () => {
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      deps({ placePage: async () => { throw new Error("Could not reach wiki-query-api at x."); } }),
    );
    expect(out.pagesRead[0]).toEqual({ section: "home", url: null, found: false, outcome: "unreachable" });
  });

  it("returns every other part when one outlives the deadline", async () => {
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      {
        ...deps({
          catalog: () => new Promise(() => {}),
          placePage: async (place, section) => (section === "home" ? page("Ohio,_United_States_Genealogy", "Ohio home.") : null),
        }),
        deadlineMs: 200,
      },
    );
    expect(out.catalog.levels[0]).toEqual({ place: "Ohio, United States", error: "timed out" });
    expect(out.wikiPages.home).toMatchObject({ found: true });
    expect(out.wikiPages.home.content).toContain("Ohio home.");
  });

  it("keeps the place's own volumes when the parent level throws or times out", async () => {
    for (const parentFails of [async () => { throw new Error("boom"); }, () => new Promise<never>(() => {})]) {
      const out: any = await runLocalitySurvey(
        { standardPlace: "Detroit, Wayne, Michigan, United States", startYear: 1870, endYear: 1930 },
        {
          ...deps({
            volumes: (a) =>
              a.standardPlace.startsWith("Detroit")
                ? Promise.resolve(volumes(a.standardPlace, ["1", "2"], 2))
                : (parentFails() as Promise<VolumeSearchResult>),
          }),
          deadlineMs: 200,
        },
      );
      expect(out.volumes.levels[0].results.map((v: any) => v.imageGroupNumber)).toEqual(["1", "2"]);
      expect(out.volumes.levels[1].error).toBeTruthy();
      expect(out.volumeSummary).toMatchObject({ start_year: 1870, end_year: 1930, total_volumes: 2 });
    }
  });

  it("runs volumes at the city and its county, the summary being the city's, a shared volume once", async () => {
    const out: any = await runLocalitySurvey(
      { standardPlace: "Detroit, Wayne, Michigan, United States" },
      deps({
        volumes: async (a) =>
          a.standardPlace.startsWith("Detroit") ? volumes(a.standardPlace, ["1", "2"], 2) : volumes(a.standardPlace, ["2", "3"], 9),
      }),
    );
    expect(out.volumes.levels.map((l: any) => l.place)).toEqual([
      "Detroit, Wayne, Michigan, United States",
      "Wayne, Michigan, United States",
    ]);
    expect(out.volumes.levels[1].results.map((v: any) => v.imageGroupNumber)).toEqual(["3"]);
    expect(out.volumeSummary.total_volumes).toBe(2);
  });

  it("searches the parent below county level only, and when the type is unknown", async () => {
    const parentCalls = async (type: string | null | "throws") => {
      const calls: string[] = [];
      await runLocalitySurvey(
        { standardPlace: "Schuylkill, Pennsylvania, United States" },
        {
          ...deps({}, calls),
          placeType: async () => {
            if (type === "throws") throw new Error("Places API down");
            return type;
          },
        },
      );
      return calls.filter((c) => c.includes('"Pennsylvania, United States"') && /^(volumes|linkRows)/.test(c)).length;
    };
    expect(await parentCalls("County")).toBe(0);
    expect(await parentCalls("Parish")).toBe(0);
    expect(await parentCalls("Civil Parish")).toBe(2);
    expect(await parentCalls("Town")).toBe(2);
    expect(await parentCalls(null)).toBe(2);
    expect(await parentCalls("throws")).toBe(2);
  });

  it("calls a typed place's volumes at its untyped parent and reads the untyped wiki pages", async () => {
    const calls: string[] = [];
    await runLocalitySurvey({ standardPlace: "Halifax, Nova Scotia, Canada (Independent City)" }, deps({}, calls));
    expect(calls).toContain('volumes {"standardPlace":"Nova Scotia, Canada","summary":true}');
    expect(calls.some((c) => c.includes('"Nova Scotia, Canada" getting_started'))).toBe(true);
    expect(calls.some((c) => c.includes("(Independent City)") && c.includes("getting_started"))).toBe(false);
  });

  it("calls external links at the town and its county, a shared url once, each level stored whole", async () => {
    const stored: Record<string, string[]> = {};
    const town = "Halifax, Yorkshire, England, United Kingdom (Town)";
    const shared = linkRow("https://shared.example", "England, United Kingdom");
    const out: any = await runLocalitySurvey(
      { standardPlace: town },
      {
        ...deps({
          linkRows: async (p) =>
            p === town
              ? { rows: [linkRow("https://halifax.example", "Halifax"), shared] }
              : { rows: [linkRow("http://www.yorkshirebmd.org.uk/", "Yorkshire, England, United Kingdom", ["Vital Records"]), shared] },
        }),
        recordLinks: async (place, rows) => {
          stored[place] = rows.map((r) => r.url);
        },
      },
    );
    expect(out.externalLinks.levels.map((l: any) => l.place)).toEqual([town, "Yorkshire, England, United Kingdom"]);
    const urls = out.externalLinks.results.map((r: any) => r.url);
    expect(urls.filter((u: string) => u === "https://shared.example")).toHaveLength(1);
    expect(urls).toContain("http://www.yorkshirebmd.org.uk/");
    expect(stored).toEqual({
      [town]: ["https://halifax.example", "https://shared.example"],
      "Yorkshire, England, United Kingdom": ["http://www.yorkshirebmd.org.uk/", "https://shared.example"],
    });
  });

  it("stays within the budget with five 40,000-character pages linking ten Legacy collections each", async () => {
    const notices = Array.from({ length: 10 }, (_, i) => ({
      title: `Collection ${i}`,
      url: `${WIKI}/C${i}_-_FamilySearch_Historical_Records`,
      notice: "This is a Legacy Collection ".repeat(16).slice(0, 450),
    }));
    const big = (label: string) => {
      const sections = Array.from({ length: 20 }, (_, i) => `## ${label} section ${i}\n${"Some \"quoted\" text.\n".repeat(95)}`);
      return `Opening of ${label}.\n${sections.join("\n")}`.slice(0, 40_000);
    };
    const out = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      deps({
        placePage: async (_p, section) => ({ ...page(`Ohio_${section}`, big(section)), collectionNotices: notices }),
        page: async (url) => (url.endsWith("Ohio_Vital_Records") ? { ...page("Ohio_Vital_Records", big("vital")), collectionNotices: notices } : null),
      }),
    );
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(TOOL_RESULT_CHAR_BUDGET);
  });

  it("ranks or names a section past 40,000 characters of a 66,000-character page", async () => {
    const sections = Array.from({ length: 30 }, (_, i) => `## Topic ${i}\n${"x".repeat(2_200)}\n`);
    sections.push("## Probate Records\nWills from 1811.\n");
    const content = `Home opening.\n${sections.join("")}`;
    expect(content.length).toBeGreaterThan(66_000);
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      deps({ placePage: async (_p, section) => (section === "home" ? page("Ohio,_United_States_Genealogy", content) : null) }),
    );
    const home = out.wikiPages.home;
    expect(home.totalChars).toBeGreaterThan(66_000);
    expect(home.content.includes("Wills from 1811") || (home.omitted ?? []).includes("Probate Records")).toBe(true);
  });

  it("cuts a 47,000-character one-row table page instead of losing it", async () => {
    const row = `| ${"Record set | link | ".repeat(2_400)}|`;
    const content = `# Ireland Online Genealogy Records\n${row}`;
    expect(content.length).toBeGreaterThan(47_000);
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ireland" },
      deps({ placePage: async (_p, section) => (section === "online_records" ? page("Ireland_Online_Genealogy_Records", content) : null) }),
    );
    const online = out.wikiPages.online_records;
    expect(online.found).toBe(true);
    expect(online.content.length).toBeGreaterThan(1_000);
    expect(online.content).toMatch(/cut at offset \d+ of https:\/\/www\.familysearch\.org\/en\/wiki\/Ireland_Online_Genealogy_Records/);
  });

  it("keeps a Vital Records section ahead of a References one", async () => {
    const filler = Array.from({ length: 12 }, (_, i) => `## Topic ${i}\n${"y".repeat(3_000)}\n`).join("");
    const content = `Opening.\n## References\n${"r".repeat(3_000)}\n${filler}## Vital Records\nBirths from 1867.\n`;
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      deps({ placePage: async (_p, section) => (section === "home" ? page("Ohio,_United_States_Genealogy", content) : null) }),
    );
    expect(out.wikiPages.home.content).toContain("Births from 1867");
    expect(out.wikiPages.home.content).not.toContain("rrrrrrrr");
    expect(out.wikiPages.home.omitted).toContain("References");
  });

  it("stages the whole answer and returns its ref", async () => {
    let staged: any = null;
    const out: any = await runLocalitySurvey(
      { standardPlace: "Ohio, United States" },
      { ...deps(), stage: async (answer) => ((staged = answer), "results/.staging/x.json") },
    );
    expect(out.staged).toEqual({ resultsRef: "results/.staging/x.json" });
    expect(staged.pagesRead).toHaveLength(4);
  });
});

describe("the Yorkshire fixtures (eval/fixtures/mcp, captured live)", () => {
  const fixture = (name: string) =>
    JSON.parse(readFileSync(join(__dirname, "../../../../../eval/fixtures/mcp", `${name}.json`), "utf-8"));

  it("keeps collection 2285341 and yorkshirebmd.org.uk inline", async () => {
    const collections = fixture("collections-search-yorkshire").response;
    const links = fixture("external-links-search-yorkshire").stored_rows;
    const out: any = await runLocalitySurvey(
      { standardPlace: "Yorkshire, England, United Kingdom", startYear: 1845, endYear: 1855 },
      deps({
        collections: async () => collections,
        linkRows: async (place) =>
          place.startsWith("Yorkshire") ? { rows: dedupeCollections(links, place) } : { rows: [] },
      }),
    );
    expect(out.collections.results.map((c: any) => c.id)).toContain("2285341");
    expect(out.externalLinks.results.map((l: any) => l.url)).toContain("http://www.yorkshirebmd.org.uk/");
  });
});

describe("splitSections", () => {
  it("ranks the opening with record types, and skip-list headings below zero", () => {
    const s = splitSections("Opening\n## References\nr\n## Church Records\nc\n## Odd\no\n");
    expect(s.map((x) => [x.heading, x.rank])).toEqual([
      [null, 2],
      ["References", -1],
      ["Church Records", 2],
      ["Odd", 1],
    ]);
  });

  it.each([
    ["Cemeteries", 2],
    ["Naturalization and Citizenship", 2],
    ["County Courthouse", 2],
    ["Newspapers", 2],
    ["Probate Records", 2],
    ["England", 1],
    ["Libraries", 1],
    ["References", -1],
    ["How to Research", -1],
    ["Step 1: Gather and Choose", -1],
    ["A", -1],
    ["Counties", -1],
    ["Counties and Parishes", -1],
    ["Language Helps", -1],
    ["Information in the Records", -1],
  ])("ranks the measured heading %j at %i", (heading, rank) => {
    expect(splitSections(`x\n## ${heading}\nbody\n`)[1].rank).toBe(rank);
  });
});
