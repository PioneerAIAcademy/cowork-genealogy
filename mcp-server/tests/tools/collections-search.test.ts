import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  collectionsSearchTool,
  filterByQuery,
  standardPlaceToCollectionsQuery,
  fetchAllCollections,
  clearCollectionsCache,
} from "../../src/tools/collections-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  FSCollectionEntry,
  FSCollectionsResponse,
} from "../../src/types/collection.js";

const mockedGetValidToken = vi.mocked(getValidToken);

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Keep filterByQuery / fetchAllCollections referenced (exported for reuse/tests).
void filterByQuery;
void fetchAllCollections;

// Helper to build a GEDCOMX-wrapped entry matching the real API shape
function makeEntry(opts: {
  id: string;
  title: string;
  placeIds: number[];
  recordCount?: number;
  personCount?: number;
  imageCount?: number;
  startYear?: number;
  endYear?: number;
}): FSCollectionEntry {
  return {
    content: {
      gedcomx: {
        collections: [
          {
            id: opts.id,
            title: opts.title,
            content: [
              { count: opts.recordCount ?? 0, resourceType: "http://gedcomx.org/Record" },
              { count: opts.personCount ?? 0, resourceType: "http://gedcomx.org/Person" },
              { count: opts.imageCount ?? 0, resourceType: "http://gedcomx.org/DigitalArtifact#FamilySearch" },
            ],
            searchMetadata: [
              {
                imageCount: opts.imageCount ?? 0,
                recordCount: opts.recordCount ?? 0,
                startYear: opts.startYear,
                endYear: opts.endYear,
                placeIds: opts.placeIds,
              },
            ],
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  clearCollectionsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Test fixtures
const mockApiResponse: FSCollectionsResponse = {
  results: 3,
  entries: [
    makeEntry({
      id: "1234",
      title: "Alabama, County Marriages, 1809-1950",
      placeIds: [1, 33],
      recordCount: 524000,
      personCount: 1048000,
      imageCount: 120000,
      startYear: 1809,
      endYear: 1950,
    }),
    makeEntry({
      id: "5678",
      title: "England, Births and Christenings, 1538-1975",
      placeIds: [1, 325],
      recordCount: 300000,
      personCount: 300000,
      imageCount: 0,
      startYear: 1538,
      endYear: 1975,
    }),
    makeEntry({
      id: "9999",
      title: "United States Federal Census, 1790-1950",
      placeIds: [1],
      recordCount: 1000000,
      personCount: 2000000,
      imageCount: 500000,
      startYear: 1790,
      endYear: 1950,
    }),
  ],
};

describe("collectionsSearchTool with standardPlace", () => {
  it("returns collections matching a place name query", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "Alabama" });

    expect(result.query).toEqual({ standardPlace: "Alabama" });
    expect(result.scope).toBe("Alabama");
    expect(result.totalForPlace).toBe(1);
    expect(result.results[0].id).toBe("1234");
  });

  it("converts a US standardPlace to its state before matching titles", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({
      standardPlace: "Birmingham, Jefferson, Alabama, United States",
    });

    // The tool derived "Alabama" (the state) from the full standardPlace and
    // matched the Alabama collection; the input is echoed in query, the derived
    // jurisdiction in scope.
    expect(result.query).toEqual({
      standardPlace: "Birmingham, Jefferson, Alabama, United States",
    });
    expect(result.scope).toBe("Alabama");
    expect(result.totalForPlace).toBe(1);
    expect(result.results[0].id).toBe("1234");
  });

  it("query matching is case-insensitive", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "alabama" });

    expect(result.totalForPlace).toBe(1);
    expect(result.results[0].id).toBe("1234");
  });

  it("returns empty array when query matches no titles", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "Narnia" });

    expect(result.totalForPlace).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("query matches anywhere in the title", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "Census" });

    expect(result.totalForPlace).toBe(1);
    expect(result.results[0].id).toBe("9999");
  });
});

describe("collectionsSearchTool date filter", () => {
  it("keeps only collections whose date range overlaps the window; totalForPlace stays pre-filter", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: 2,
        entries: [
          makeEntry({
            id: "old",
            title: "Census of 1800",
            placeIds: [1],
            startYear: 1800,
            endYear: 1810,
          }),
          makeEntry({
            id: "new",
            title: "Census of 1900",
            placeIds: [1],
            startYear: 1900,
            endYear: 1910,
          }),
        ],
      }),
    });

    const result = await collectionsSearchTool({
      standardPlace: "Census",
      startYear: 1890,
      endYear: 1920,
    });

    expect(result.query).toEqual({
      standardPlace: "Census",
      startYear: 1890,
      endYear: 1920,
    });
    // Both titles match "Census" (totalForPlace: 2); only the 1900 one survives
    // the 1890–1920 window.
    expect(result.totalForPlace).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("new");
  });

  it("rejects endYear < startYear", async () => {
    await expect(
      collectionsSearchTool({ standardPlace: "Census", startYear: 1920, endYear: 1890 })
    ).rejects.toThrow(/endYear must be greater than or equal to startYear/);
  });
});

describe("standardPlaceToCollectionsQuery", () => {
  it("US standardPlace -> state only (regardless of nesting depth)", () => {
    expect(standardPlaceToCollectionsQuery("Pennsylvania, United States")).toBe("Pennsylvania");
    expect(standardPlaceToCollectionsQuery("Schuylkill, Pennsylvania, United States")).toBe("Pennsylvania");
    expect(
      standardPlaceToCollectionsQuery("Pottsville, Schuylkill, Pennsylvania, United States")
    ).toBe("Pennsylvania");
  });

  it('Canada / Mexico -> "Country, State"', () => {
    expect(standardPlaceToCollectionsQuery("Ontario, Canada")).toBe("Canada, Ontario");
    expect(standardPlaceToCollectionsQuery("Toronto, Ontario, Canada")).toBe("Canada, Ontario");
    expect(standardPlaceToCollectionsQuery("Mérida, Yucatán, Mexico")).toBe("Mexico, Yucatán");
  });

  it("all other countries -> country only", () => {
    expect(standardPlaceToCollectionsQuery("Paris, France")).toBe("France");
    expect(standardPlaceToCollectionsQuery("London, England, United Kingdom")).toBe("United Kingdom");
    expect(standardPlaceToCollectionsQuery("France")).toBe("France");
  });

  it("free-text (non-standardPlace) passes through unchanged", () => {
    expect(standardPlaceToCollectionsQuery("Census")).toBe("Census");
    expect(standardPlaceToCollectionsQuery("Schuylkill County Pennsylvania")).toBe(
      "Schuylkill County Pennsylvania"
    );
  });

  it("country-only US / Canada falls back to the country", () => {
    expect(standardPlaceToCollectionsQuery("United States")).toBe("United States");
    expect(standardPlaceToCollectionsQuery("Canada")).toBe("Canada");
  });
});

describe("collectionsSearchTool error handling", () => {
  it("throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(collectionsSearchTool({ standardPlace: "Alabama" })).rejects.toThrow(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-OK API response", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(collectionsSearchTool({ standardPlace: "Alabama" })).rejects.toThrow(
      "FamilySearch collections API error: 500 Internal Server Error"
    );
  });

  it("handles malformed API response gracefully", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await collectionsSearchTool({ standardPlace: "Alabama" });

    expect(result.totalForPlace).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("throws when standardPlace is not provided", async () => {
    await expect(collectionsSearchTool({ standardPlace: "" })).rejects.toThrow(
      /collections_search requires a standardPlace/
    );
  });
});

describe("collectionsSearchTool field mapping", () => {
  it("maps API response fields to Collection shape", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: 1,
        entries: [
          makeEntry({
            id: "1234",
            title: "Alabama, County Marriages, 1809-1950",
            placeIds: [1, 33],
            recordCount: 524000,
            personCount: 1048000,
            imageCount: 120000,
            startYear: 1809,
            endYear: 1950,
          }),
        ],
      }),
    });

    const result = await collectionsSearchTool({ standardPlace: "Alabama" });

    expect(result.results[0]).toEqual({
      id: "1234",
      title: "Alabama, County Marriages, 1809-1950",
      dateRange: "1809-1950",
      recordCount: 524000,
      personCount: 1048000,
      imageCount: 120000,
      url: "https://www.familysearch.org/search/collection/1234",
    });
  });
});

describe("collectionsSearchTool — User-Agent contract", () => {
  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    await collectionsSearchTool({ standardPlace: "Alabama" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });
});
