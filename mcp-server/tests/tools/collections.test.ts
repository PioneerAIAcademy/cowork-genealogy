import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  collectionsTool,
  filterByPlaceIds,
  filterByQuery,
  fetchAllCollections,
  clearCollectionsCache,
} from "../../src/tools/collections.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type { FSCollectionEntry, FSCollectionsResponse } from "../../src/types/collection.js";

const mockedGetValidToken = vi.mocked(getValidToken);

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

describe("collectionsTool with query", () => {
  it("returns collections matching a place name query", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ query: "Alabama" });

    expect(result.query).toBe("Alabama");
    expect(result.placeIds).toBeUndefined();
    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("1234");
  });

  it("query matching is case-insensitive", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ query: "alabama" });

    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("1234");
  });

  it("returns empty array when query matches no titles", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ query: "Narnia" });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("query matches anywhere in the title", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ query: "Census" });

    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("9999");
  });
});

describe("collectionsTool with placeIds", () => {
  it("returns collections matching a single place ID", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ placeIds: [33] });

    expect(result.placeIds).toEqual([33]);
    expect(result.query).toBeUndefined();
    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("1234");
  });

  it("returns collections matching multiple place IDs", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ placeIds: [33, 325] });

    expect(result.placeIds).toEqual([33, 325]);
    expect(result.matchingCollections).toBe(2);
    const ids = result.collections.map((c) => c.id);
    expect(ids).toContain("1234");
    expect(ids).toContain("5678");
  });

  it("returns empty array when no collections match", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ placeIds: [999999] });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("filters correctly against placeIds in searchMetadata", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: 3,
        entries: [
          makeEntry({ id: "a", title: "A", placeIds: [1, 33, 500] }),
          makeEntry({ id: "b", title: "B", placeIds: [1, 44] }),
          makeEntry({ id: "c", title: "C", placeIds: [33] }),
        ],
      }),
    });

    const result = await collectionsTool({ placeIds: [33] });

    expect(result.matchingCollections).toBe(2);
    const ids = result.collections.map((c) => c.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });
});

describe("collectionsTool error handling", () => {
  it("throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(collectionsTool({ query: "Alabama" })).rejects.toThrow(
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

    await expect(collectionsTool({ query: "Alabama" })).rejects.toThrow(
      "FamilySearch collections API error: 500 Internal Server Error"
    );
  });

  it("handles malformed API response gracefully", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await collectionsTool({ query: "Alabama" });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("throws when neither query nor placeIds provided", async () => {
    await expect(collectionsTool({})).rejects.toThrow(
      "Provide either a query"
    );
  });
});

describe("collectionsTool field mapping", () => {
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

    const result = await collectionsTool({ query: "Alabama" });

    expect(result.collections[0]).toEqual({
      id: "1234",
      title: "Alabama, County Marriages, 1809-1950",
      dateRange: "1809-1950",
      placeIds: [1, 33],
      recordCount: 524000,
      personCount: 1048000,
      imageCount: 120000,
      url: "https://www.familysearch.org/search/collection/1234",
    });
  });
});
