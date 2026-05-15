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

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Test fixtures
//
// Real FamilySearch responses carry both a rep ID (echoed at `entry.id` and
// `place.id`) and a Primary identifier (under `identifiers["http://gedcomx.org/Primary"]`
// as a URL). The Primary IDs below are illustrative — the real values come
// from the live API.

const mockSearchResponse: FSPlaceSearchResponse = {
  entries: [
    {
      id: "267",
      score: 100.0,
      content: {
        gedcomx: {
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
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/10026773",
                ],
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
              id: "12345",
              display: {
                name: "New England",
                fullName: "New England, United States",
                type: "Region",
              },
              latitude: 43.0,
              longitude: -71.0,
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/10054321",
                ],
              },
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
      identifiers: {
        "http://gedcomx.org/Primary": [
          "https://api.familysearch.org/platform/places/10026773",
        ],
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
  it("returns Primary as placeId, rep as placeRepId, with all matches and scores preserved", async () => {
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
        placeId: "10026773",
        placeRepId: "267",
        name: "England",
        fullName: "England, United Kingdom",
        type: "Country",
        latitude: 52.0,
        longitude: -1.0,
        dateRange: "+1801/",
        score: 100.0,
      },
      {
        placeId: "10054321",
        placeRepId: "12345",
        name: "New England",
        fullName: "New England, United States",
        type: "Region",
        latitude: 43.0,
        longitude: -71.0,
        score: 64.0,
      },
    ]);
  });

  it("returns placeId as undefined when identifiers.Primary is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          entries: [
            {
              id: "999",
              score: 50,
              content: {
                gedcomx: {
                  places: [
                    {
                      id: "999",
                      display: {
                        name: "Mystery",
                        fullName: "Mystery",
                        type: "Town",
                      },
                    },
                  ],
                },
              },
            },
          ],
        }),
    });

    const result = await searchPlace("Mystery");
    expect(result[0].placeId).toBeUndefined();
    expect(result[0].placeRepId).toBe("999");
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
  it("returns Primary as placeId, rep as placeRepId, parent rep as parentPlaceRepId", async () => {
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
      placeId: "10026773",
      placeRepId: "267",
      name: "England",
      fullName: "England, United Kingdom",
      type: "Country",
      latitude: 52.0,
      longitude: -1.0,
      dateRange: "+1801/",
      parentPlaceRepId: "10",
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
  it("returns all name-search matches wrapped in results, without Wikipedia enrichment, with both ID fields and the new familysearchUrl", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(mockSearchResponse),
    });

    const result = await placesTool({ query: "England" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      results: [
        {
          placeId: "10026773",
          placeRepId: "267",
          name: "England",
          fullName: "England, United Kingdom",
          type: "Country",
          latitude: 52.0,
          longitude: -1.0,
          dateRange: "+1801/",
          score: 100.0,
          familysearchUrl:
            "https://www.familysearch.org/en/research/places/?text=England&focusedId=267",
        },
        {
          placeId: "10054321",
          placeRepId: "12345",
          name: "New England",
          fullName: "New England, United States",
          type: "Region",
          latitude: 43.0,
          longitude: -71.0,
          score: 64.0,
          familysearchUrl:
            "https://www.familysearch.org/en/research/places/?text=New%20England&focusedId=12345",
        },
      ],
    });
  });

  it("returns a single wrapped result with Wikipedia enrichment for numeric (rep) ID input", async () => {
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
          placeId: "10026773",
          placeRepId: "267",
          name: "England",
          fullName: "England, United Kingdom",
          type: "Country",
          latitude: 52.0,
          longitude: -1.0,
          dateRange: "+1801/",
          parentPlaceRepId: "10",
          wikipedia: {
            title: "England",
            description: "Country within the United Kingdom",
            extract:
              "England is a country that is part of the United Kingdom. It shares land borders with Wales and Scotland.",
            thumbnailUrl:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/england.png",
          },
          familysearchUrl:
            "https://www.familysearch.org/en/research/places/?text=England&focusedId=267",
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
    expect(result.results[0].placeId).toBe("10026773");
    expect(result.results[0].placeRepId).toBe("267");
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
