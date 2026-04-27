import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  collectionsTool,
  parsePlaceIdChain,
  filterByPlaceIds,
  fetchAllCollections,
  clearCollectionsCache,
} from "../../src/tools/collections.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type { FSCollectionEntry, FSCollectionsResponse } from "../../src/types/collection.js";

const mockedGetValidToken = vi.mocked(getValidToken);

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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
  collections: [
    {
      id: "1234",
      title: "Alabama, County Marriages, 1809-1950",
      recordCount: 524000,
      personCount: 1048000,
      imageCount: 120000,
      placeId: "1-33",
      coverageTemporal: "1809-1950",
    },
    {
      id: "5678",
      title: "England, Births and Christenings, 1538-1975",
      recordCount: 300000,
      personCount: 300000,
      imageCount: 0,
      placeId: "1-325",
      coverageTemporal: "1538-1975",
    },
    {
      id: "9999",
      title: "United States Federal Census, 1790-1950",
      recordCount: 1000000,
      personCount: 2000000,
      imageCount: 500000,
      placeId: "1",
      coverageTemporal: "1790-1950",
    },
  ],
  total: 3,
};

describe("parsePlaceIdChain", () => {
  it("parses a chain like '1-33' into [1, 33]", () => {
    expect(parsePlaceIdChain("1-33")).toEqual([1, 33]);
  });

  it("parses a single ID", () => {
    expect(parsePlaceIdChain("1")).toEqual([1]);
  });

  it("returns empty array for empty string", () => {
    expect(parsePlaceIdChain("")).toEqual([]);
  });
});

describe("collectionsTool", () => {
  it("returns collections matching a single place ID", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsTool({ placeIds: [33] });

    expect(result.placeIds).toEqual([33]);
    expect(result.matchingCollections).toBe(1);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].id).toBe("1234");
    expect(result.collections[0].title).toBe("Alabama, County Marriages, 1809-1950");
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
    expect(result.collections).toHaveLength(2);
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

    expect(result.placeIds).toEqual([999999]);
    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(collectionsTool({ placeIds: [33] })).rejects.toThrow(
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

    await expect(collectionsTool({ placeIds: [33] })).rejects.toThrow(
      "FamilySearch collections API error: 500 Internal Server Error"
    );
  });

  it("handles malformed API response gracefully", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await collectionsTool({ placeIds: [33] });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("filters correctly against placeId chains", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collections: [
          { id: "a", title: "A", placeId: "1-33-500", recordCount: 10 },
          { id: "b", title: "B", placeId: "1-44", recordCount: 20 },
          { id: "c", title: "C", placeId: "33", recordCount: 30 },
        ],
      }),
    });

    const result = await collectionsTool({ placeIds: [33] });

    // Should match "a" (chain contains 33) and "c" (chain is 33), but not "b"
    expect(result.matchingCollections).toBe(2);
    const ids = result.collections.map((c) => c.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("maps API response fields to Collection shape", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        collections: [
          {
            id: "1234",
            title: "Alabama, County Marriages, 1809-1950",
            recordCount: 524000,
            personCount: 1048000,
            imageCount: 120000,
            placeId: "1-33",
            coverageTemporal: "1809-1950",
          },
        ],
      }),
    });

    const result = await collectionsTool({ placeIds: [33] });

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
