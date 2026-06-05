import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchPlace,
  getPlaceById,
  getPlaceRepIds,
  getPlaceWikipediaUrl,
  placeSearch,
  placeSearchTool,
  placeSearchAllTool,
  __clearPlaceSearchCacheForTests,
} from "../../src/tools/place-search.js";
import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
} from "../../src/types/place.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  __clearPlaceSearchCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Shared fixtures
//
// Real FamilySearch responses carry both a rep ID (echoed at `entry.id` and
// `place.id`) and a Primary identifier (under
// `identifiers["http://gedcomx.org/Primary"]` as a URL). The Primary IDs below
// are illustrative — the real values come from the live API.
// ---------------------------------------------------------------------------

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
              temporalDescription: { formal: "+1801/" },
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
      temporalDescription: { formal: "+1801/" },
      jurisdiction: { resourceId: "10" },
      identifiers: {
        "http://gedcomx.org/Primary": [
          "https://api.familysearch.org/platform/places/10026773",
        ],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Paris fixtures — used by the multi-call placeSearch / placeSearchAll tests.
// Routed by URL substring (see `routeByUrl`) so call ordering doesn't matter.
// ---------------------------------------------------------------------------

const parisSearchResponse: FSPlaceSearchResponse = {
  entries: [
    {
      id: "100",
      score: 100.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "100",
              display: {
                name: "Paris",
                fullName: "Paris, Bear Lake, Idaho, United States",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/9001",
                ],
              },
            },
          ],
        },
      },
    },
    {
      id: "200",
      score: 90.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "200",
              display: {
                name: "Paris",
                fullName: "Paris, Île-de-France, France",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/9002",
                ],
              },
            },
          ],
        },
      },
    },
  ],
};

function description(
  id: string,
  fullName: string,
  primaryId: string
): FSPlaceDescriptionResponse {
  return {
    places: [
      {
        id,
        display: { name: "Paris", fullName, type: "City" },
        latitude: 1.0,
        longitude: 2.0,
        temporalDescription: { formal: "+1900/" },
        identifiers: {
          "http://gedcomx.org/Primary": [
            `https://api.familysearch.org/platform/places/${primaryId}`,
          ],
        },
      },
    ],
  };
}

/** FamilySearch place attributes response carrying a WIKIPEDIA_LINK attribute. */
function attributes(wikipediaUrl: string) {
  return {
    attributes: [
      {
        type: { code: "FS_WIKI_LINK" },
        url: "https://www.familysearch.org/wiki/en/Idaho,_United_States_Genealogy",
      },
      { type: { code: "WIKIPEDIA_LINK" }, url: wikipediaUrl },
    ],
  };
}

interface Route {
  match: string;
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

/** Route fetch calls by URL substring so test order is call-order-independent. */
function routeByUrl(routes: Route[]): void {
  mockFetch.mockImplementation(async (url: string) => {
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      throw new Error(`Unexpected fetch in test: ${url}`);
    }
    if (route.ok === false) {
      return { ok: false, status: route.status ?? 500, statusText: "Error" };
    }
    return {
      ok: true,
      json: async () => route.json,
      text: async () => route.text ?? JSON.stringify(route.json),
    };
  });
}

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

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

  it("returns empty array when no results found (empty entries)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ entries: [] }),
    });
    expect(await searchPlace("NonexistentPlace12345")).toEqual([]);
  });

  it("returns empty array when response body is empty", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "" });
    expect(await searchPlace("NonexistentPlace12345")).toEqual([]);
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
        headers: expect.objectContaining({ Accept: "application/json" }),
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
    expect(await getPlaceById("invalid-id")).toBeNull();
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

describe("getPlaceWikipediaUrl", () => {
  it("returns the WIKIPEDIA_LINK attribute url (ignoring FS_WIKI_LINK)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => attributes("https://en.wikipedia.org/wiki/Paris,_Idaho"),
    });

    const result = await getPlaceWikipediaUrl("3988097");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://www.familysearch.org/service/standards/place/ws-ui/places/reps/3988097/attributes/",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      })
    );
    expect(result).toBe("https://en.wikipedia.org/wiki/Paris,_Idaho");
  });

  it("returns null when the place has no WIKIPEDIA_LINK attribute", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        attributes: [
          {
            type: { code: "FS_WIKI_LINK" },
            url: "https://www.familysearch.org/wiki/en/Whatever",
          },
        ],
      }),
    });

    expect(await getPlaceWikipediaUrl("3988097")).toBeNull();
  });

  it("returns null on a non-OK response (graceful degradation)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
    expect(await getPlaceWikipediaUrl("0000")).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    expect(await getPlaceWikipediaUrl("3988097")).toBeNull();
  });
});

describe("getPlaceRepIds", () => {
  it("returns distinct rep IDs whose place.resourceId points back to the pid", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        places: [
          { id: "9001", display: undefined },
          { id: "100", place: { resourceId: "9001" } },
          { id: "101", place: { resourceId: "9001" } },
          { id: "999", place: { resourceId: "9999" } },
          { id: "100", place: { resourceId: "9001" } },
        ],
      }),
    });

    const result = await getPlaceRepIds("9001");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.familysearch.org/platform/places/9001",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      })
    );
    expect(result).toEqual(["100", "101"]);
  });

  it("returns empty array on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });
    expect(await getPlaceRepIds("0000")).toEqual([]);
  });

  it("throws on other non-OK status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(getPlaceRepIds("9001")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
  });
});

// ---------------------------------------------------------------------------
// Internal placeSearch
// ---------------------------------------------------------------------------

describe("placeSearch (internal)", () => {
  it("narrows to matches whose fullName contains the context name", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Paris", "Idaho");

    expect(result).toHaveLength(1);
    expect(result[0].placeId).toBe("9001");
    expect(result[0].fullName).toBe("Paris, Bear Lake, Idaho, United States");
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("description/200"),
      expect.anything()
    );
  });

  it("keeps the unfiltered list when nothing matches the context name", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      {
        match: "description/200",
        json: description("200", "Paris, Île-de-France, France", "9002"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Paris", "Nowhereland");

    expect(result.map((r) => r.placeId).sort()).toEqual(["9001", "9002"]);
  });

  it("caches results so a repeat call does not re-fetch", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    await placeSearch("Paris", "Idaho");
    const callsAfterFirst = mockFetch.mock.calls.length;
    const second = await placeSearch("Paris", "Idaho");

    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
    expect(second[0].placeId).toBe("9001");
  });

  it("falls back to search-entry data when a description 404s", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      { match: "description/100", ok: false, status: 404 },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Paris", "Idaho");

    expect(result).toHaveLength(1);
    expect(result[0].placeId).toBe("9001");
    expect(result[0].fullName).toBe("Paris, Bear Lake, Idaho, United States");
  });
});

// ---------------------------------------------------------------------------
// place_search tool — simplified, ID-free output
// ---------------------------------------------------------------------------

describe("placeSearchTool", () => {
  it("returns simplified fields with the FamilySearch WIKIPEDIA_LINK and no identifiers", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      {
        match: "attributes",
        json: attributes("https://en.wikipedia.org/wiki/Paris,_Idaho"),
      },
    ]);

    const result = await placeSearchTool({
      placeName: "Paris",
      contextName: "Idaho",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      standardPlace: "Paris, Bear Lake, Idaho, United States",
      type: "City",
      dateRange: "+1900/",
      latitude: 1.0,
      longitude: 2.0,
      familysearchUrl:
        "https://www.familysearch.org/en/research/places/?text=Paris&focusedId=100",
      wikipediaUrl: "https://en.wikipedia.org/wiki/Paris,_Idaho",
    });

    const keys = Object.keys(result.results[0]);
    for (const banned of [
      "placeId",
      "placeRepId",
      "score",
      "name",
      "parentPlaceRepId",
      "wikipedia",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("omits wikipediaUrl when the place has no WIKIPEDIA_LINK attribute", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearchTool({
      placeName: "Paris",
      contextName: "Idaho",
    });

    expect(result.results[0].wikipediaUrl).toBeUndefined();
  });

  it("returns an empty results array when the search has no matches", async () => {
    routeByUrl([{ match: "search?q=name:", json: { entries: [] } }]);

    const result = await placeSearchTool({ placeName: "NonexistentPlace12345" });

    expect(result).toEqual({ results: [] });
  });
});

// ---------------------------------------------------------------------------
// place_search_all tool — all jurisdictions over time
// ---------------------------------------------------------------------------

describe("placeSearchAllTool", () => {
  it("expands each pid to all rep IDs and returns simplified, ID-free results", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      {
        match: "places/9001",
        json: {
          places: [
            { id: "9001" },
            { id: "100", place: { resourceId: "9001" } },
            { id: "150", place: { resourceId: "9001" } },
          ],
        },
      },
      {
        match: "description/150",
        json: description("150", "Paris, Oneida, Idaho Territory", "9001"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearchAllTool({
      placeName: "Paris",
      contextName: "Idaho",
    });

    expect(result.results.map((r) => r.standardPlace).sort()).toEqual([
      "Paris, Bear Lake, Idaho, United States",
      "Paris, Oneida, Idaho Territory",
    ]);
    for (const r of result.results) {
      expect(Object.keys(r)).not.toContain("placeId");
      expect(Object.keys(r)).not.toContain("placeRepId");
    }
  });

  it("drops rep IDs whose description lookup 404s", async () => {
    routeByUrl([
      { match: "search?q=name:Paris", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      {
        match: "places/9001",
        json: {
          places: [
            { id: "9001" },
            { id: "100", place: { resourceId: "9001" } },
            { id: "150", place: { resourceId: "9001" } },
          ],
        },
      },
      { match: "description/150", ok: false, status: 404 },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearchAllTool({
      placeName: "Paris",
      contextName: "Idaho",
    });

    expect(result.results.map((r) => r.standardPlace)).toEqual([
      "Paris, Bear Lake, Idaho, United States",
    ]);
  });
});
