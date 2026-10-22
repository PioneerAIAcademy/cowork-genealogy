import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetPlaceCandidateNames = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/place-search.js", () => ({
  getPlaceCandidateNames: mockGetPlaceCandidateNames,
  getPlaceByPrimaryId: vi.fn(),
  getPlaceById: vi.fn(),
  searchPlace: vi.fn(),
  getWikipediaSummary: vi.fn(),
  placeSearchTool: vi.fn(),
}));

const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
const mockStandardPlaceToRepId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
  standardPlaceToRepId: mockStandardPlaceToRepId,
}));

const mockGetPlaceById = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-api.js", () => ({
  getPlaceById: mockGetPlaceById,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockGetWikiApiUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiApiUrl: mockGetWikiApiUrl,
}));

import {
  __clearResolvedPagesForTests,
  wikiPlacePageTool,
  wikiPlacePageSchema,
} from "../../src/tools/wiki-place-page.js";
import { WIKI_PAGE_MAX_CHARS, WIKI_PAGE_SECTIONS } from "../../src/types/wikiPage.js";
import { VALIDATOR_ENUMS } from "../../src/validation/validator.js";
import { CLI_SPILL_CHARS } from "../helpers/cli-spill.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";
import { headingPage, oneLinePage, quotePage, walkParts } from "../helpers/wiki-pages.js";

const API_BASE = "http://localhost:8000";

// Helper: build a mock-fetch response. ok=200 returns a page; ok=404
// triggers "try the next candidate"; ok=500 throws an upstream error.
function pageResponse(slug: string, content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      title: slug,
      content,
      source_url: `https://www.familysearch.org/en/wiki/${slug}`,
    }),
  };
}

const NOT_FOUND = { ok: false, status: 404, json: async () => ({ detail: "missing" }) };

// A wiki-query-api /search response ranking these page titles.
function searchResponse(titles: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      query: "q",
      total_chunks_searched: 1,
      query_time_ms: 1,
      timing: { embed_ms: 0, search_ms: 0, rerank_ms: 0 },
      results: titles.map((page_title, i) => ({
        rank: i + 1,
        relevance_score: 1,
        chunk_text: "",
        page_title,
        section_heading: "",
        source_url: "",
      })),
    }),
  };
}

const placeOfType = (type: string) => ({ placeId: "1", placeRepId: "rep-1", name: "x", fullName: "x", type });

beforeEach(() => {
  // The memo of resolved pages is module state: without this one case's entry is the next one's.
  __clearResolvedPagesForTests();
  mockGetPlaceCandidateNames.mockReset();
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue(null); // default: rely on the leaf name
  mockStandardPlaceToRepId.mockReset();
  mockStandardPlaceToRepId.mockResolvedValue("rep-1");
  mockGetPlaceById.mockReset();
  mockGetPlaceById.mockResolvedValue(null);
  mockFetch.mockReset();
  mockGetWikiApiUrl.mockReset();
  mockGetWikiApiUrl.mockResolvedValue(API_BASE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wikiPlacePageTool — home section", () => {
  it("GETs /page/Portugal_Genealogy from the standard place's leaf name", async () => {
    mockFetch.mockResolvedValueOnce(pageResponse("Portugal_Genealogy", "# Portugal"));

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.standardPlace).toBe("Portugal");
    expect(result.placeName).toBe("Portugal");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
  });

  it("derives the leaf from a fully-qualified standard place", async () => {
    mockFetch.mockResolvedValueOnce(pageResponse("Minnesota_Genealogy", "# Minnesota"));

    const result = await wikiPlacePageTool({
      standardPlace: "Minnesota, United States",
      section: "home",
    }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Minnesota_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.placeName).toBe("Minnesota");
  });

  it("falls back to Manitoba,_Canada_Genealogy when plain _Genealogy is 404", async () => {
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND) // Manitoba_Genealogy → 404
      .mockResolvedValueOnce(pageResponse("Manitoba,_Canada_Genealogy", "# Manitoba"));

    const result = await wikiPlacePageTool({
      standardPlace: "Manitoba, Canada",
      section: "home",
    }, LOCAL);

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/page/Manitoba_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/page/Manitoba,_Canada_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.url).toBe(
      "https://www.familysearch.org/en/wiki/Manitoba,_Canada_Genealogy"
    );
  });

  it("handles multi-word place names by underscoring them in the slug", async () => {
    mockFetch.mockResolvedValueOnce(pageResponse("British_Columbia_Genealogy", "# BC"));

    await wikiPlacePageTool({ standardPlace: "British Columbia, Canada", section: "home" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/British_Columbia_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("tries additional name variants from the places API when the leaf misses", async () => {
    mockStandardPlaceToPlaceId.mockResolvedValueOnce("1927089");
    mockGetPlaceCandidateNames.mockResolvedValueOnce(["Czechia"]);
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND) // Old_Name_Genealogy
      .mockResolvedValueOnce(NOT_FOUND) // Old_Name,_Canada_Genealogy
      .mockResolvedValueOnce(NOT_FOUND) // Old_Name,_United_States_Genealogy
      .mockResolvedValueOnce(pageResponse("Czechia_Genealogy", "# Czechia"));

    const result = await wikiPlacePageTool({ standardPlace: "Old Name", section: "home" }, LOCAL);

    expect(result.placeName).toBe("Czechia");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Czechia_Genealogy");
  });

  it("throws when every candidate 404s", async () => {
    mockFetch.mockResolvedValue(NOT_FOUND);

    await expect(
      wikiPlacePageTool({ standardPlace: "Nowhere", section: "home" }, LOCAL)
    ).rejects.toThrow(/No wiki page found for "Nowhere"/);
  });

  it("rejects an empty/whitespace standardPlace without touching the server", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: "  ", section: "home" }, LOCAL)
    ).rejects.toThrow(/standardPlace is required/);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });

  it("surfaces a 5xx as an upstream error (does NOT treat it as page-not-found)", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error", headers: new Headers() });

    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "home" }, LOCAL)
    ).rejects.toThrow(/wiki-query-api error: 500/);
  });

  it("surfaces a network failure as a friendly server-unreachable error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "home" }, LOCAL)
    ).rejects.toThrow(/Could not reach wiki-query-api/);
  });

  it("names the socket cause, not just \"fetch failed\"", async () => {
    mockFetch.mockRejectedValue(socketFetchFailure());

    const err = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" }, LOCAL).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toMatch(/Could not reach wiki-query-api.*ETIMEDOUT/s);
    expect((err as Error).message).toContain(API_BASE);
    expect((err as Error).message).not.toMatch(/Is the server running/);
  });
});

describe("wikiPlacePageTool — getting_started section", () => {
  it("GETs the correct _Getting_Started slug", async () => {
    mockFetch.mockResolvedValueOnce(
      pageResponse("Portugal_Getting_Started", "# Getting Started")
    );

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "getting_started" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Getting_Started`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not try a Canada variant (no fallback for non-home sections)", async () => {
    mockFetch.mockResolvedValueOnce(NOT_FOUND);

    await expect(
      wikiPlacePageTool({ standardPlace: "Manitoba, Canada", section: "getting_started" }, LOCAL)
    ).rejects.toThrow(/No wiki page found for "Manitoba, Canada"/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("wikiPlacePageTool — online_records section", () => {
  it("GETs the correct _Online_Genealogy_Records slug", async () => {
    mockFetch.mockResolvedValueOnce(
      pageResponse("Portugal_Online_Genealogy_Records", "# Records")
    );

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "online_records" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Online_Genealogy_Records`,
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("wikiPlacePageTool — research_tips section", () => {
  it("GETs the correct _Research_Tips_and_Strategies slug", async () => {
    mockFetch.mockResolvedValueOnce(
      pageResponse("Portugal_Research_Tips_and_Strategies", "# Research Tips")
    );

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "research_tips" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Research_Tips_and_Strategies`,
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("wikiPlacePageTool — shared behaviour", () => {
  it("includes standardPlace and placeName in the result", async () => {
    mockFetch.mockResolvedValueOnce(pageResponse("Portugal_Genealogy", "# Portugal"));

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" }, LOCAL);

    expect(result.standardPlace).toBe("Portugal");
    expect(result.placeName).toBe("Portugal");
    expect(result.content).toBe("# Portugal");
  });
});

// #1270 — `section` is the `locality_page_section` closed enum. The engine
// keeps one hand-written literal copy (WIKI_PAGE_SECTIONS, so WikiPageSection
// stays a literal union and candidateSlugsFor's switch stays exhaustive); these
// bind it and the advertised input schema to the validator's set, both ways.
describe("wikiPlacePageTool — section is the locality_page_section enum (#1270)", () => {
  it("WIKI_PAGE_SECTIONS matches the locality_page_section enum", () => {
    expect(new Set(WIKI_PAGE_SECTIONS)).toEqual(VALIDATOR_ENUMS.locality_page_section);
  });

  it("the advertised input schema enum is the validator's set", () => {
    expect(new Set(wikiPlacePageSchema.inputSchema.properties.section.enum)).toEqual(
      VALIDATOR_ENUMS.locality_page_section
    );
  });

  it("rejects a missing section before any network call, naming every valid value", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal" } as any, LOCAL)
    ).rejects.toThrow(
      "section is required and must be one of 'home', 'getting_started', 'online_records', 'research_tips'."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects an out-of-set section before any network call (was a TypeError from candidateSlugsFor)", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "typo" } as any, LOCAL)
    ).rejects.toThrow(/section is required and must be one of/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("wikiPlacePageTool — a sub-national home page (issue #2486 item B)", () => {
  it("resolves a two-part sub-national place by its title once the leaf grammar misses", async () => {
    mockGetPlaceById.mockResolvedValueOnce(placeOfType("County"));
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(searchResponse(["Malm%C3%B6hus County, Sweden Genealogy"]))
      .mockResolvedValueOnce(pageResponse("Malmöhus_County,_Sweden_Genealogy", "# M"));
    const result = await wikiPlacePageTool({ standardPlace: "Malmöhus, Sweden", section: "home" }, LOCAL);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Malmöhus_County,_Sweden_Genealogy");
  });

  it("resolves a province the wiki titles by its local name, never a sibling's page", async () => {
    mockStandardPlaceToPlaceId.mockResolvedValue("1928477");
    mockGetPlaceCandidateNames.mockResolvedValue(["South Holland", "Zuid-Holland"]);
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(searchResponse(["Noord-Holland, Netherlands Genealogy", "Zuid-Holland, Netherlands Genealogy"]))
      .mockResolvedValueOnce(pageResponse("Zuid-Holland,_Netherlands_Genealogy", "# ZH"));
    const result = await wikiPlacePageTool({ standardPlace: "South Holland, Netherlands", section: "home" }, LOCAL);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Zuid-Holland,_Netherlands_Genealogy");
    expect(mockGetPlaceCandidateNames).toHaveBeenCalledWith("1928477", {}, { anyLanguage: true });
    expect(mockFetch.mock.calls.map((c) => String(c[0]))).not.toContain(
      `${API_BASE}/page/Noord-Holland,_Netherlands_Genealogy`,
    );
  });

  it("reads a parenthetical that is the place's own local name as a name, not a type word", async () => {
    mockGetPlaceById.mockResolvedValueOnce(placeOfType("State"));
    mockStandardPlaceToPlaceId.mockResolvedValue("1927060");
    mockGetPlaceCandidateNames.mockResolvedValue(["Bavaria", "Bayern"]);
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(searchResponse(["Bavaria (Bayern), German Empire Genealogy", "Bavaria (Bayern), Germany Genealogy"]))
      .mockResolvedValueOnce(pageResponse("Bavaria_(Bayern),_Germany_Genealogy", "# BY"));
    const result = await wikiPlacePageTool({ standardPlace: "Bavaria, Germany", section: "home" }, LOCAL);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Bavaria_(Bayern),_Germany_Genealogy");
  });

  it("still rejects a parenthetical type word that does not fit, even with names available", async () => {
    mockGetPlaceById.mockResolvedValueOnce(placeOfType("County"));
    mockStandardPlaceToPlaceId.mockResolvedValue("99");
    mockGetPlaceCandidateNames.mockResolvedValue(["Baltimore"]);
    mockFetch
      .mockResolvedValueOnce(searchResponse(["Baltimore (Independent City), Maryland Genealogy"]));
    await expect(
      wikiPlacePageTool({ standardPlace: "Baltimore, Maryland, United States", section: "home" }, LOCAL),
    ).rejects.toThrow(/No wiki page found/);
  });

  it("resolves a Northern Ireland county from its Ireland title", async () => {
    mockFetch
      .mockResolvedValueOnce(searchResponse([
        "Antrim Civil Parish, County Antrim, Northern Ireland Genealogy",
        "County Antrim, Ireland Genealogy",
      ]))
      .mockResolvedValueOnce(pageResponse("County_Antrim,_Ireland_Genealogy", "# CA"));
    const result = await wikiPlacePageTool(
      { standardPlace: "County Antrim, Northern Ireland, United Kingdom", section: "home" }, LOCAL);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/County_Antrim,_Ireland_Genealogy");
  });

  const SCHUYLKILL = "Schuylkill, Pennsylvania, United States";

  it("resolves a county's own page from its wiki title, never trying the leaf grammar", async () => {
    mockGetPlaceById.mockResolvedValueOnce(placeOfType("County"));
    mockFetch
      .mockResolvedValueOnce(searchResponse(["Schuylkill County, Pennsylvania Genealogy"]))
      .mockResolvedValueOnce(pageResponse("Schuylkill_County,_Pennsylvania_Genealogy", "# Schuylkill"));

    const result = await wikiPlacePageTool({ standardPlace: SCHUYLKILL, section: "home" }, LOCAL);

    expect(mockFetch).toHaveBeenNthCalledWith(1, `${API_BASE}/search`, expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ query: "Schuylkill Pennsylvania genealogy" });
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/page/Schuylkill_County,_Pennsylvania_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Schuylkill_County,_Pennsylvania_Genealogy");
    expect(result.placeName).toBe("Schuylkill County, Pennsylvania");
  });

  it("picks the city, not the same-named county, for an independent city", async () => {
    mockGetPlaceById.mockResolvedValue(placeOfType("Independent City"));
    mockFetch
      .mockResolvedValueOnce(searchResponse(["St. Louis County, Missouri Genealogy", "St. Louis City, Missouri Genealogy"]))
      .mockResolvedValueOnce(pageResponse("St._Louis_City,_Missouri_Genealogy", "# City"));

    const result = await wikiPlacePageTool({ standardPlace: "St. Louis, Missouri, United States", section: "home" }, LOCAL);

    expect(result.url).toBe("https://www.familysearch.org/en/wiki/St._Louis_City,_Missouri_Genealogy");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns no page rather than guess when the place type is unknown", async () => {
    mockStandardPlaceToRepId.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(
      searchResponse(["St. Louis County, Missouri Genealogy", "St. Louis City, Missouri Genealogy"])
    );

    await expect(
      wikiPlacePageTool({ standardPlace: "St. Louis, Missouri, United States", section: "home" }, LOCAL)
    ).rejects.toThrow(/No wiki page found/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a failed type lookup as unknown, never as a match", async () => {
    mockGetPlaceById.mockRejectedValueOnce(new Error("FamilySearch API error: 503"));
    mockFetch.mockResolvedValueOnce(searchResponse(["Schuylkill County, Pennsylvania Genealogy"]));

    await expect(wikiPlacePageTool({ standardPlace: SCHUYLKILL, section: "home" }, LOCAL)).rejects.toThrow(
      /No wiki page found/
    );
  });

  it("keeps diacritics in the slug", async () => {
    mockGetPlaceById.mockResolvedValueOnce(placeOfType("Lutheran Parish"));
    mockFetch
      .mockResolvedValueOnce(searchResponse(["Barseb%C3%A4ck Parish, Malm%C3%B6hus, Sweden Genealogy"]))
      .mockResolvedValueOnce(pageResponse("Barsebäck_Parish,_Malmöhus,_Sweden_Genealogy", "# B"));

    const result = await wikiPlacePageTool({ standardPlace: "Barsebäck, Malmöhus, Sweden", section: "home" }, LOCAL);

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${API_BASE}/page/Barsebäck_Parish,_Malmöhus,_Sweden_Genealogy`,
      expect.anything()
    );
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Barsebäck_Parish,_Malmöhus,_Sweden_Genealogy");
  });

  it("moves to the next ranked title when an accepted one 404s", async () => {
    mockGetPlaceById.mockResolvedValue(placeOfType("County"));
    mockFetch
      .mockResolvedValueOnce(
        searchResponse(["Schuylkill County, Pennsylvania Genealogy", "Schuylkill, Pennsylvania Genealogy"])
      )
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(pageResponse("Schuylkill,_Pennsylvania_Genealogy", "# S"));

    const result = await wikiPlacePageTool({ standardPlace: SCHUYLKILL, section: "home" }, LOCAL);
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Schuylkill,_Pennsylvania_Genealogy");
  });

  it("surfaces a search outage as an error, never as no page", async () => {
    // Sustained: fetchWithRetry retries a transient 5xx before giving it back.
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable", headers: new Headers() });

    await expect(wikiPlacePageTool({ standardPlace: SCHUYLKILL, section: "home" }, LOCAL)).rejects.toThrow(
      /wiki-query-api error: 503/
    );
  });

  it("asks nothing for a sub-state place's section pages, which exist only at state level", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: SCHUYLKILL, section: "getting_started" }, LOCAL)
    ).rejects.toThrow(/No wiki page found for "Schuylkill, Pennsylvania, United States"/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still uses the leaf grammar first for a state", async () => {
    mockFetch
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(pageResponse("Pennsylvania,_United_States_Genealogy", "# PA"));

    const result = await wikiPlacePageTool({ standardPlace: "Pennsylvania, United States", section: "home" }, LOCAL);

    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Pennsylvania,_United_States_Genealogy");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
  });
});

// ── paging ───────────────────────────────────────────────────────────────────

const PORTUGAL_URL = "https://www.familysearch.org/en/wiki/Portugal_Genealogy";
const SCHUYLKILL_PLACE = "Schuylkill, Pennsylvania, United States";
const SCHUYLKILL_SLUG = "Schuylkill_County,_Pennsylvania_Genealogy";

/** Every GET answers with this page; Portugal resolves on its first candidate. */
function servePortugal(content: string | undefined): void {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () =>
    content === undefined
      ? { ok: true, status: 200, json: async () => ({ title: "Portugal_Genealogy", source_url: PORTUGAL_URL }) }
      : pageResponse("Portugal_Genealogy", content),
  );
}

/** A county page, found the long way: the wiki's own search ranks its title, then the page is fetched. */
function serveSchuylkill(content: string): void {
  mockGetPlaceById.mockResolvedValue(placeOfType("County"));
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) =>
    String(url).endsWith("/search")
      ? searchResponse(["Schuylkill County, Pennsylvania Genealogy"])
      : pageResponse(SCHUYLKILL_SLUG, content),
  );
}

/** "GET /page/Portugal_Genealogy": what a mocked request asked for, without the base URL. */
const route = (call: any[]): string => `${call[1].method} ${String(call[0]).replace(/^https?:\/\/[^/]+/, "")}`;

/** The Places API reads, across the four stubs that stand for it. */
const placeLookups = (): number =>
  mockStandardPlaceToRepId.mock.calls.length +
  mockGetPlaceById.mock.calls.length +
  mockStandardPlaceToPlaceId.mock.calls.length +
  mockGetPlaceCandidateNames.mock.calls.length;

const readPortugal = (offset?: number) =>
  wikiPlacePageTool({ standardPlace: "Portugal", section: "home", ...(offset === undefined ? {} : { offset }) }, LOCAL);
const readSchuylkill = (offset?: number) =>
  wikiPlacePageTool({ standardPlace: SCHUYLKILL_PLACE, section: "home", ...(offset === undefined ? {} : { offset }) }, LOCAL);

/** What the cap bounds: the JSON-escaped body of `content`. */
const escapedBody = (s: string): number => JSON.stringify(s).length - 2;

const SHAPES: Array<[string, () => string]> = [
  ["about 50 headings over 66,000 characters", () => headingPage()],
  ["one heading and one 46,000-character row", () => oneLinePage()],
  ["66,000 double quotes", () => quotePage()],
];

describe.each(SHAPES)("wikiPlacePageTool, a page of %s", (_label, make) => {
  const page = make();
  beforeEach(() => servePortugal(page));

  it("(a) every part serializes under the CLI spill line, with content inside the cap", async () => {
    expect(JSON.stringify({ url: PORTUGAL_URL, content: page, standardPlace: "Portugal", placeName: "Portugal" }).length).toBeGreaterThan(CLI_SPILL_CHARS);
    const parts = await walkParts(readPortugal);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThan(CLI_SPILL_CHARS);
      expect(escapedBody(part.content)).toBeLessThanOrEqual(WIKI_PAGE_MAX_CHARS);
    }
  });

  it("(b) joining content across the nextOffset chain rebuilds the page exactly", async () => {
    const parts = await walkParts(readPortugal);
    expect(parts.map((p) => p.content).join("")).toBe(page);
    let at = 0;
    for (const part of parts) {
      expect(part.offset ?? 0).toBe(at);
      at += part.content.length;
    }
  });

  it("(c) the chain ends: the last part says truncated: false and carries no nextOffset", async () => {
    const parts = await walkParts(readPortugal);
    const last = parts[parts.length - 1];
    expect(last.truncated).toBe(false);
    expect("nextOffset" in last).toBe(false);
    for (const part of parts.slice(0, -1)) {
      expect(part.truncated).toBe(true);
      expect(part.nextOffset).toBe((part.offset ?? 0) + part.content.length);
    }
  });

  it("keeps url, standardPlace and placeName on every part", async () => {
    for (const part of await walkParts(readPortugal)) {
      expect(part.url).toBe(PORTUGAL_URL);
      expect(part.standardPlace).toBe("Portugal");
      expect(part.placeName).toBe("Portugal");
    }
  });

  it("fetches the page again for each part", async () => {
    const parts = await walkParts(readPortugal);
    expect(mockFetch).toHaveBeenCalledTimes(parts.length);
  });
});

describe("wikiPlacePageTool, a page found by its title", () => {
  it("(1) pages it the same way, and a continuation makes no search and no Places call", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const parts = [await readSchuylkill()];
    expect(parts[0].truncated).toBe(true);
    // Part 1 resolved the place in full: a search, the page, and the Places lookups that
    // decide whether a ranked title's type word fits.
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search", `GET /page/${SCHUYLKILL_SLUG}`]);
    expect(placeLookups()).toBeGreaterThan(0);
    const after1 = { requests: mockFetch.mock.calls.length, lookups: placeLookups() };

    while (parts[parts.length - 1].truncated) {
      parts.push(await readSchuylkill(parts[parts.length - 1].nextOffset));
    }
    expect(parts.length).toBeGreaterThan(1);
    // Every later part is one GET of the page. No search, no Places call.
    expect(mockFetch.mock.calls.slice(after1.requests).map(route)).toEqual(
      Array(parts.length - 1).fill(`GET /page/${SCHUYLKILL_SLUG}`),
    );
    expect(placeLookups()).toBe(after1.lookups);

    expect(parts.map((p) => p.content).join("")).toBe(page);
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThan(CLI_SPILL_CHARS);
      expect(part.url).toBe(`https://www.familysearch.org/en/wiki/${SCHUYLKILL_SLUG}`);
      expect(part.standardPlace).toBe(SCHUYLKILL_PLACE);
      expect(part.placeName).toBe("Schuylkill County, Pennsylvania");
    }
  });

  it("pages a page reached through an alternate name from the places API", async () => {
    const page = headingPage();
    mockStandardPlaceToPlaceId.mockResolvedValue("1927089");
    mockGetPlaceCandidateNames.mockResolvedValue(["Czechia"]);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/page/Czechia_Genealogy") ? pageResponse("Czechia_Genealogy", page) : NOT_FOUND,
    );
    const parts = await walkParts((offset) =>
      wikiPlacePageTool({ standardPlace: "Old Name", section: "home", ...(offset === undefined ? {} : { offset }) }, LOCAL),
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.content).join("")).toBe(page);
    // the continuation reuses the resolved name, not the name it was asked for
    expect(parts.map((p) => p.placeName)).toEqual(parts.map(() => "Czechia"));
  });
});

// A call that continues a page (offset above 0) reuses the page an earlier call resolved; a call
// from the start resolves in full. The memo is the only thing between them, so each case below
// starts from an empty one (beforeEach) and builds the entry it needs with a real first call.
describe("wikiPlacePageTool, a continuation reuses the page the first call resolved", () => {
  const SCHUYLKILL_URL = `https://www.familysearch.org/en/wiki/${SCHUYLKILL_SLUG}`;
  const clearCalls = (): void => {
    mockFetch.mockClear();
    for (const m of [mockStandardPlaceToRepId, mockGetPlaceById, mockStandardPlaceToPlaceId, mockGetPlaceCandidateNames]) {
      m.mockClear();
    }
  };
  /** What a part that starts at `from` should hold, taken from the page itself. */
  const slice = (page: string, from: number, part: { content: string }): string =>
    page.slice(from, from + part.content.length);

  it("(2) still returns the next part when the Places lookup fails by then", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const first = await readSchuylkill();
    const at = first.nextOffset as number;
    // From here the Places API is down. placeTypeOf reads that as "type unknown", which rejects
    // every ranked title that carries a type word.
    mockStandardPlaceToRepId.mockRejectedValue(new Error("Places API unreachable"));
    mockGetPlaceById.mockRejectedValue(new Error("FamilySearch API error: 503"));

    const second = await readSchuylkill(at);
    expect(second.offset).toBe(at);
    expect(second.content).toBe(slice(page, at, second));
    expect(first.content + second.content).toBe(page);
    expect(second.url).toBe(SCHUYLKILL_URL);
    expect(second.placeName).toBe("Schuylkill County, Pennsylvania");

    // The same outage with nothing remembered is "no page": this is the failure the memo spares a
    // continuation, and the reason the case above proves something.
    __clearResolvedPagesForTests();
    await expect(readSchuylkill(at)).rejects.toThrow(/No wiki page found/);
  });

  it("(3) resolves in full when no earlier call left an entry", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const part = await readSchuylkill(5_000); // the first call this module has seen is a continuation
    expect(part.offset).toBe(5_000);
    expect(part.content).toBe(slice(page, 5_000, part));
    expect(part.url).toBe(SCHUYLKILL_URL);
    expect(part.placeName).toBe("Schuylkill County, Pennsylvania");
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search", `GET /page/${SCHUYLKILL_SLUG}`]);
    expect(placeLookups()).toBeGreaterThan(0);
  });

  it("(4) resolves in full again when the remembered page now 404s, and remembers what it finds", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const first = await readSchuylkill();
    const at = first.nextOffset as number;

    // The wiki now titles the page differently: the old slug 404s and the search ranks a new one.
    const RENAMED = "Schuylkill,_Pennsylvania_Genealogy";
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/search")) return searchResponse(["Schuylkill, Pennsylvania Genealogy"]);
      return u.endsWith(`/page/${RENAMED}`) ? pageResponse(RENAMED, page) : NOT_FOUND;
    });
    const second = await readSchuylkill(at);
    expect(mockFetch.mock.calls.map(route)).toEqual([
      `GET /page/${SCHUYLKILL_SLUG}`, // the remembered page: 404
      "POST /search",
      `GET /page/${RENAMED}`,
    ]);
    expect(second.url).toBe(`https://www.familysearch.org/en/wiki/${RENAMED}`);
    expect(second.placeName).toBe("Schuylkill, Pennsylvania");
    expect(second.content).toBe(slice(page, at, second));

    // What the fallback found is now the entry: the next continuation is one GET of it.
    mockFetch.mockClear();
    const third = await readSchuylkill(at);
    expect(mockFetch.mock.calls.map(route)).toEqual([`GET /page/${RENAMED}`]);
    expect(third.url).toBe(second.url);
  });

  it("(4) does not keep asking for a remembered page that is gone for good", async () => {
    serveSchuylkill(headingPage());
    const at = (await readSchuylkill()).nextOffset as number;

    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/search") ? searchResponse([]) : NOT_FOUND,
    );
    await expect(readSchuylkill(at)).rejects.toThrow(/No wiki page found/);
    expect(mockFetch.mock.calls.map(route)).toEqual([`GET /page/${SCHUYLKILL_SLUG}`, "POST /search"]);

    // The entry went with that 404: the next such call goes straight to the search.
    mockFetch.mockClear();
    await expect(readSchuylkill(at)).rejects.toThrow(/No wiki page found/);
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search"]);
  });

  it("(5) does not hand a page to another section of the same place", async () => {
    serveSchuylkill(headingPage());
    const at = (await readSchuylkill()).nextOffset as number; // remembers Schuylkill home
    clearCalls();
    // A county has a home page and no other section (the wiki has them from state level up), so
    // the answer for these is "no page" without a request, never the home page remembered above.
    for (const section of ["getting_started", "online_records", "research_tips"] as const) {
      await expect(
        wikiPlacePageTool({ standardPlace: SCHUYLKILL_PLACE, section, offset: at }, LOCAL),
      ).rejects.toThrow(/No wiki page found for "Schuylkill, Pennsylvania, United States"/);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("(5) does not hand a page to another place in the same section", async () => {
    serveSchuylkill(headingPage());
    const at = (await readSchuylkill()).nextOffset as number; // remembers Schuylkill home
    clearCalls();
    // The wiki ranks nothing for a neighbouring county, so there is no page for it.
    await expect(
      wikiPlacePageTool({ standardPlace: "Berks, Pennsylvania, United States", section: "home", offset: at }, LOCAL),
    ).rejects.toThrow(/No wiki page found for "Berks, Pennsylvania, United States"/);
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search"]);
  });

  it("(5) does not hand a page to a call that reaches another wiki server", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const at = (await readSchuylkill()).nextOffset as number; // remembers it for API_BASE
    clearCalls();
    // The other server (a user's own wiki URL) titles the page differently.
    const OTHER_BASE = "http://localhost:9000";
    const OTHER_SLUG = "Schuylkill,_Pennsylvania_Genealogy";
    mockGetWikiApiUrl.mockResolvedValue(OTHER_BASE);
    mockFetch.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u === `${OTHER_BASE}/search`) return searchResponse(["Schuylkill, Pennsylvania Genealogy"]);
      return u === `${OTHER_BASE}/page/${OTHER_SLUG}` ? pageResponse(OTHER_SLUG, page) : NOT_FOUND;
    });

    const part = await readSchuylkill(at);
    expect(part.url).toBe(`https://www.familysearch.org/en/wiki/${OTHER_SLUG}`);
    // It resolved at the other server from the start: the first request is the search, not a GET
    // of the slug remembered for the first server.
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search", `GET /page/${OTHER_SLUG}`]);
  });

  it("(6) resolves in full on a call from the start, with no offset or an offset of 0, even with an entry", async () => {
    serveSchuylkill(headingPage());
    await readSchuylkill(); // the entry
    clearCalls();
    await readSchuylkill();
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search", `GET /page/${SCHUYLKILL_SLUG}`]);
    clearCalls();
    await readSchuylkill(0);
    expect(mockFetch.mock.calls.map(route)).toEqual(["POST /search", `GET /page/${SCHUYLKILL_SLUG}`]);
    expect(placeLookups()).toBeGreaterThan(0);
    // and an offset of 1 is a continuation
    clearCalls();
    await readSchuylkill(1);
    expect(mockFetch.mock.calls.map(route)).toEqual([`GET /page/${SCHUYLKILL_SLUG}`]);
  });

  it("(7) replaces the remembered page with the one a call from the start resolves now", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    await readSchuylkill(); // remembers the County slug
    // The wiki now ranks another title first.
    const NEWER = "Schuylkill,_Pennsylvania_Genealogy";
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/search")
        ? searchResponse(["Schuylkill, Pennsylvania Genealogy", "Schuylkill County, Pennsylvania Genealogy"])
        : pageResponse(String(url).split("/page/")[1], page),
    );
    const fresh = await readSchuylkill();
    expect(fresh.url).toBe(`https://www.familysearch.org/en/wiki/${NEWER}`);

    mockFetch.mockClear();
    const next = await readSchuylkill(fresh.nextOffset);
    expect(mockFetch.mock.calls.map(route)).toEqual([`GET /page/${NEWER}`]);
    expect(next.url).toBe(fresh.url);
  });

  it("(8) throws a network failure on the continuation GET, and keeps the entry for the next try", async () => {
    const page = headingPage();
    serveSchuylkill(page);
    const at = (await readSchuylkill()).nextOffset as number;

    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(readSchuylkill(at)).rejects.toThrow(/Could not reach wiki-query-api/);
    // Only the remembered page was asked for (more than once: fetchWithRetry retries a network
    // failure). The call did not fall back to a search.
    expect(new Set(mockFetch.mock.calls.map(route))).toEqual(new Set([`GET /page/${SCHUYLKILL_SLUG}`]));

    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => pageResponse(SCHUYLKILL_SLUG, page));
    const part = await readSchuylkill(at);
    expect(mockFetch.mock.calls.map(route)).toEqual([`GET /page/${SCHUYLKILL_SLUG}`]);
    expect(part.content).toBe(slice(page, at, part));
  });
});

describe("wikiPlacePageTool, a page under the cap", () => {
  it("(d) returns exactly today's object for a 9,000-character page, with no extra keys", async () => {
    const head = "# Small page\n";
    const content = head + "x".repeat(9_000 - head.length);
    expect(content.length).toBe(9_000);
    servePortugal(content);
    const result = await readPortugal();
    expect(result).toStrictEqual({ url: PORTUGAL_URL, content, standardPlace: "Portugal", placeName: "Portugal" });
    expect(Object.keys(result).sort()).toEqual(["content", "placeName", "standardPlace", "url"]);
  });

  it("returns a page whose escaped body is exactly the cap whole, and pages one unit more", async () => {
    servePortugal("x".repeat(WIKI_PAGE_MAX_CHARS));
    expect("truncated" in (await readPortugal())).toBe(false);
    servePortugal("x".repeat(WIKI_PAGE_MAX_CHARS + 1));
    const parts = await walkParts(readPortugal);
    expect(parts.map((p) => p.content.length)).toEqual([WIKI_PAGE_MAX_CHARS, 1]);
  });

  it("adds the paging fields, and only those, when offset is passed on a page that fits", async () => {
    servePortugal("# Small");
    expect(await readPortugal(0)).toStrictEqual({
      url: PORTUGAL_URL,
      content: "# Small",
      standardPlace: "Portugal",
      placeName: "Portugal",
      totalChars: 7,
      offset: 0,
      truncated: false,
    });
  });

  it("starts at the offset it is given, and reads one past the end as an empty part", async () => {
    const page = headingPage();
    servePortugal(page);
    const part = await readPortugal(5_000);
    expect(part.offset).toBe(5_000);
    expect(part.content).toBe(page.slice(5_000, 5_000 + part.content.length));
    servePortugal("# Small");
    expect(await readPortugal(1_000_000)).toMatchObject({ content: "", totalChars: 7, offset: 7, truncated: false });
  });

  it("passes a body with no text through as it always did", async () => {
    servePortugal(undefined);
    expect(await readPortugal()).toStrictEqual({
      url: PORTUGAL_URL,
      content: undefined,
      standardPlace: "Portugal",
      placeName: "Portugal",
    });
  });
});

describe("wikiPlacePageTool, offset validation", () => {
  it.each([
    ["a string", "5", '"5"'],
    ["a negative number", -1, "-1"],
    ["a fraction", 1.5, "1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["null", null, "null"],
  ])("(e) rejects an offset of %s with the requireWholeNumber error, before any request or place lookup", async (_label, value, got) => {
    servePortugal("# Small");
    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "home", offset: value as unknown as number }, LOCAL),
    ).rejects.toThrow(`offset must be a whole number ≥ 0 (got ${got}). Send it as a number, not a string.`);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetWikiApiUrl).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });
});

describe("wikiPlacePageSchema, paging", () => {
  it("declares offset as a number and still requires standardPlace and section", () => {
    expect(wikiPlacePageSchema.inputSchema.properties.offset.type).toBe("number");
    expect(wikiPlacePageSchema.inputSchema.required).toEqual(["standardPlace", "section"]);
  });

  it("tells the agent how to continue", () => {
    expect(wikiPlacePageSchema.description).toContain(
      "when `truncated` is true, call again with `offset: nextOffset` until it is false",
    );
    expect(wikiPlacePageSchema.inputSchema.properties.offset.description).toContain("`nextOffset`");
  });
});
