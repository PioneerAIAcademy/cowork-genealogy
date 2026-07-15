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
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockGetWikiApiUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiApiUrl: mockGetWikiApiUrl,
}));

import { wikiPlacePageTool } from "../../src/tools/wiki-place-page.js";

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

beforeEach(() => {
  mockGetPlaceCandidateNames.mockReset();
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue(null); // default: rely on the leaf name
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

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" });

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
    });

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
    });

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

    await wikiPlacePageTool({ standardPlace: "British Columbia, Canada", section: "home" });

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

    const result = await wikiPlacePageTool({ standardPlace: "Old Name", section: "home" });

    expect(result.placeName).toBe("Czechia");
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Czechia_Genealogy");
  });

  it("throws when every candidate 404s", async () => {
    mockFetch.mockResolvedValue(NOT_FOUND);

    await expect(
      wikiPlacePageTool({ standardPlace: "Nowhere", section: "home" })
    ).rejects.toThrow(/No wiki page found for "Nowhere"/);
  });

  it("rejects an empty/whitespace standardPlace without touching the server", async () => {
    await expect(
      wikiPlacePageTool({ standardPlace: "  ", section: "home" })
    ).rejects.toThrow(/standardPlace is required/);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });

  it("surfaces a 5xx as an upstream error (does NOT treat it as page-not-found)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "home" })
    ).rejects.toThrow(/wiki-query-api error: 500/);
  });

  it("surfaces a network failure as a friendly server-unreachable error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      wikiPlacePageTool({ standardPlace: "Portugal", section: "home" })
    ).rejects.toThrow(/Could not reach wiki-query-api/);
  });
});

describe("wikiPlacePageTool — getting_started section", () => {
  it("GETs the correct _Getting_Started slug", async () => {
    mockFetch.mockResolvedValueOnce(
      pageResponse("Portugal_Getting_Started", "# Getting Started")
    );

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "getting_started" });

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Getting_Started`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not try a Canada variant (no fallback for non-home sections)", async () => {
    mockFetch.mockResolvedValueOnce(NOT_FOUND);

    await expect(
      wikiPlacePageTool({ standardPlace: "Manitoba, Canada", section: "getting_started" })
    ).rejects.toThrow(/No wiki page found for "Manitoba, Canada"/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("wikiPlacePageTool — online_records section", () => {
  it("GETs the correct _Online_Genealogy_Records slug", async () => {
    mockFetch.mockResolvedValueOnce(
      pageResponse("Portugal_Online_Genealogy_Records", "# Records")
    );

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "online_records" });

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

    await wikiPlacePageTool({ standardPlace: "Portugal", section: "research_tips" });

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Research_Tips_and_Strategies`,
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("wikiPlacePageTool — shared behaviour", () => {
  it("includes standardPlace and placeName in the result", async () => {
    mockFetch.mockResolvedValueOnce(pageResponse("Portugal_Genealogy", "# Portugal"));

    const result = await wikiPlacePageTool({ standardPlace: "Portugal", section: "home" });

    expect(result.standardPlace).toBe("Portugal");
    expect(result.placeName).toBe("Portugal");
    expect(result.content).toBe("# Portugal");
  });
});
