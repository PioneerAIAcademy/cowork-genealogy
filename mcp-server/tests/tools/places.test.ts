import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchPlace,
  getPlaceById,
  getWikipediaSummary,
  placesTool,
} from "../../src/tools/places.js";
import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
  WikipediaSummaryResponse,
} from "../../src/types/place.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Test fixtures
const mockSearchResponse: FSPlaceSearchResponse = {
  entries: [
    {
      id: "267",
      score: 100.0,
      content: {
        gedcomx: {
          places: [
            {
              display: {
                name: "England",
                fullName: "England, United Kingdom",
                type: "Country",
              },
              latitude: 52.0,
              longitude: -1.0,
              temporalDescription: {
                formal: "+1801/",
              },
            },
          ],
        },
      },
      links: {
        description: {
          href: "https://api.familysearch.org/platform/places/description/267",
        },
      },
    },
    {
      id: "12345",
      score: 64.0,
      content: {
        gedcomx: {
          places: [
            {
              display: {
                name: "New England",
                fullName: "New England, United States",
                type: "Region",
              },
              latitude: 43.0,
              longitude: -71.0,
            },
          ],
        },
      },
      links: {
        description: {
          href: "https://api.familysearch.org/platform/places/description/12345",
        },
      },
    },
  ],
};

const mockPlaceDescriptionResponse: FSPlaceDescriptionResponse = {
  places: [
    {
      id: "267",
      display: {
        name: "England",
        fullName: "England, United Kingdom",
        type: "Country",
      },
      latitude: 52.0,
      longitude: -1.0,
      temporalDescription: {
        formal: "+1801/",
      },
      jurisdiction: {
        resourceId: "10",
      },
    },
  ],
};

const mockWikipediaResponse: WikipediaSummaryResponse = {
  title: "England",
  description: "Country within the United Kingdom",
  extract:
    "England is a country that is part of the United Kingdom. It shares land borders with Wales and Scotland.",
  coordinates: {
    lat: 52.0,
    lon: -1.0,
  },
  thumbnail: {
    source: "https://upload.wikimedia.org/wikipedia/commons/thumb/england.png",
    width: 200,
    height: 200,
  },
  content_urls: {
    desktop: {
      page: "https://en.wikipedia.org/wiki/England",
    },
  },
};

describe("searchPlace", () => {
  it("returns all matching entries with scores preserved", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockSearchResponse),
    });

    const result = await searchPlace("England");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.familysearch.org/platform/places/search?q=name:England",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/x-gedcomx-atom+json",
        }),
      })
    );
    expect(result).toEqual([
      {
        placeId: "267",
        name: "England",
        fullName: "England, United Kingdom",
        type: "Country",
        latitude: 52.0,
        longitude: -1.0,
        dateRange: "+1801/",
        score: 100.0,
      },
      {
        placeId: "12345",
        name: "New England",
        fullName: "New England, United States",
        type: "Region",
        latitude: 43.0,
        longitude: -71.0,
        score: 64.0,
      },
    ]);
  });

  it("returns empty array when no results found (empty entries)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ entries: [] }),
    });

    const result = await searchPlace("NonexistentPlace12345");

    expect(result).toEqual([]);
  });

  it("returns empty array when response body is empty", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    const result = await searchPlace("NonexistentPlace12345");

    expect(result).toEqual([]);
  });

  it("throws an error on network failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(searchPlace("England")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
  });
});

describe("getPlaceById", () => {
  it("returns place data for valid ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlaceDescriptionResponse,
    });

    const result = await getPlaceById("267");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.familysearch.org/platform/places/description/267",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      })
    );
    expect(result).toEqual({
      placeId: "267",
      name: "England",
      fullName: "England, United Kingdom",
      type: "Country",
      latitude: 52.0,
      longitude: -1.0,
      dateRange: "+1801/",
      parentPlaceId: "10",
    });
  });

  it("returns null for invalid ID (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await getPlaceById("invalid-id");

    expect(result).toBeNull();
  });

  it("throws an error on server error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(getPlaceById("267")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
  });
});

describe("getWikipediaSummary", () => {
  it("returns Wikipedia summary data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWikipediaResponse,
    });

    const result = await getWikipediaSummary("England");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://en.wikipedia.org/api/rest_v1/page/summary/England",
      expect.any(Object)
    );
    expect(result).toEqual({
      title: "England",
      description: "Country within the United Kingdom",
      extract:
        "England is a country that is part of the United Kingdom. It shares land borders with Wales and Scotland.",
      thumbnailUrl:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/england.png",
      wikipediaUrl: "https://en.wikipedia.org/wiki/England",
    });
  });

  it("returns null when Wikipedia article not found (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await getWikipediaSummary("NonexistentPlace12345");

    expect(result).toBeNull();
  });

  it("returns null on Wikipedia API errors (graceful degradation)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const result = await getWikipediaSummary("England");

    expect(result).toBeNull();
  });
});

describe("placesTool", () => {
  it("returns all name-search matches wrapped in results, without Wikipedia enrichment", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockSearchResponse),
    });

    const result = await placesTool({ query: "England" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      results: [
        {
          placeId: "267",
          name: "England",
          fullName: "England, United Kingdom",
          type: "Country",
          latitude: 52.0,
          longitude: -1.0,
          dateRange: "+1801/",
          score: 100.0,
          familysearchUrl:
            "https://www.familysearch.org/search/catalog/place/267",
        },
        {
          placeId: "12345",
          name: "New England",
          fullName: "New England, United States",
          type: "Region",
          latitude: 43.0,
          longitude: -71.0,
          score: 64.0,
          familysearchUrl:
            "https://www.familysearch.org/search/catalog/place/12345",
        },
      ],
    });
  });

  it("returns a single wrapped result with Wikipedia enrichment for numeric ID input", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlaceDescriptionResponse,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockWikipediaResponse,
    });

    const result = await placesTool({ query: "267" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.familysearch.org/platform/places/description/267",
      expect.any(Object)
    );
    expect(result).toEqual({
      results: [
        {
          placeId: "267",
          name: "England",
          fullName: "England, United Kingdom",
          type: "Country",
          latitude: 52.0,
          longitude: -1.0,
          dateRange: "+1801/",
          parentPlaceId: "10",
          wikipedia: {
            title: "England",
            description: "Country within the United Kingdom",
            extract:
              "England is a country that is part of the United Kingdom. It shares land borders with Wales and Scotland.",
            thumbnailUrl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/england.png",
          },
          familysearchUrl:
            "https://www.familysearch.org/search/catalog/place/267",
          wikipediaUrl: "https://en.wikipedia.org/wiki/England",
        },
      ],
    });
  });

  it("returns ID result without Wikipedia when Wikipedia fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPlaceDescriptionResponse,
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await placesTool({ query: "267" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].placeId).toBe("267");
    expect(result.results[0].wikipedia).toBeUndefined();
    expect(result.results[0].wikipediaUrl).toBeUndefined();
  });

  it("returns empty results array for a name search with no matches (no throw)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });

    const result = await placesTool({ query: "NonexistentPlace12345" });

    expect(result).toEqual({ results: [] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws error when numeric ID is not found (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(placesTool({ query: "9999999" })).rejects.toThrow(
      "Place not found: 9999999"
    );
  });

  it("throws error on FamilySearch API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(placesTool({ query: "England" })).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
  });
});
