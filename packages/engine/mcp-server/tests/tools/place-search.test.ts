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
import { getPlaceReps } from "../../src/utils/place-api.js";
import type {
  FSPlaceSearchResponse,
  FSPlaceDescriptionResponse,
} from "../../src/types/place.js";
import { __clearPlaceResolverCachesForTests } from "../../src/utils/place-resolver.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// A 500 the retry layer can read: fetchWithRetry checks Retry-After on it.
const serverError = () => ({
  ok: false,
  status: 500,
  statusText: "Internal Server Error",
  headers: new Headers(),
});

beforeEach(() => {
  mockFetch.mockReset();
  __clearPlaceSearchCacheForTests();
  __clearPlaceResolverCachesForTests();
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

// ---------------------------------------------------------------------------
// Bristol fixtures — #609: a bare name search ranks Bristol, Virginia above
// Bristol, England. Deriving "England" from the comma-qualified placeName must
// narrow to the England hit even though Virginia scores higher.
// ---------------------------------------------------------------------------

const bristolSearchResponse: FSPlaceSearchResponse = {
  entries: [
    {
      id: "400",
      score: 100.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "400",
              display: {
                name: "Bristol",
                fullName: "Bristol, Virginia, United States",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/8400",
                ],
              },
            },
          ],
        },
      },
    },
    {
      id: "300",
      score: 80.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "300",
              display: {
                name: "Bristol",
                fullName: "Bristol, England, United Kingdom",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/8300",
                ],
              },
            },
          ],
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Sierkopas fixtures — the fuzzy fallback (misspelling of Sierokopaß). The
// exact query returns nothing; the unquoted fuzzy query returns BOTH East
// Prussia's Sierokopaß and West Prussia's Scherokopaß, and both match a
// "Germany" context — so tests assert the Neidenburg entry is present and the
// response flagged, never that it is the only result.
// ---------------------------------------------------------------------------

const sierkopasFuzzyResponse: FSPlaceSearchResponse = {
  entries: [
    {
      id: "500",
      score: 85.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "500",
              display: {
                name: "Sierokopaß",
                fullName:
                  "Sierokopaß, Neidenburg, East Prussia, Prussia, Germany",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/8500",
                ],
              },
            },
          ],
        },
      },
    },
    {
      id: "600",
      score: 80.0,
      content: {
        gedcomx: {
          places: [
            {
              id: "600",
              display: {
                name: "Scherokopaß",
                fullName: "Scherokopaß, Culm, West Prussia, Germany",
                type: "City",
              },
              identifiers: {
                "http://gedcomx.org/Primary": [
                  "https://api.familysearch.org/platform/places/8600",
                ],
              },
            },
          ],
        },
      },
    },
  ],
};

/** Routes for the Sierkopas fuzzy-fallback flow: empty exact, 2-hit fuzzy. */
function sierkopasRoutes(): Route[] {
  return [
    { match: "search?q=name:%22Sierkopas%22", json: { entries: [] } },
    { match: "search?q=name:Sierkopas~", json: sierkopasFuzzyResponse },
    {
      match: "description/500",
      json: description(
        "500",
        "Sierokopaß, Neidenburg, East Prussia, Prussia, Germany",
        "8500"
      ),
    },
    {
      match: "description/600",
      json: description("600", "Scherokopaß, Culm, West Prussia, Germany", "8600"),
    },
    { match: "attributes", ok: false, status: 404 },
  ];
}

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
      "https://api.familysearch.org/platform/places/search?q=name:%22England%22",
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

  it("retries a server error, then throws once the retries are spent", async () => {
    mockFetch.mockResolvedValue(serverError());
    await expect(searchPlace("England")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not retry a 400", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request", headers: new Headers() });
    await expect(searchPlace("England")).rejects.toThrow("FamilySearch API error: 400 Bad Request");
    expect(mockFetch).toHaveBeenCalledTimes(1);
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

  it("retries a server error, then throws once the retries are spent", async () => {
    mockFetch.mockResolvedValue(serverError());
    await expect(getPlaceById("267")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
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

  it("getPlaceReps gives each representation's English name, date range and names from the same listing (Olne, live 2026-10-26)", async () => {
    const rep = (
      id: string,
      fullName: string | undefined,
      formal: string | undefined,
      names: { lang?: string; value?: string }[] | undefined,
      pid = "1959431",
    ) => ({
      id,
      ...(fullName ? { display: { fullName, name: "Olne", type: "Municipality" } } : {}),
      ...(formal ? { temporalDescription: { formal } } : {}),
      ...(names ? { names } : {}),
      place: { resource: `https://api.familysearch.org/platform/places/${pid}`, resourceId: pid },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        places: [
          { id: "1959431", names: [{ lang: "wa", value: "ône" }, { lang: "fr", value: "Olne" }, { lang: "fr", value: "Aulne" }] },
          rep("12441861", "Olne, Liège, Belgium", "+1830/", [{ lang: "fr", value: "Olne" }]),
          // Constructed: a second language, and a name with no value.
          rep("418460", "Olne, Prince-Bishopric of Liège, Holy Roman Empire", "/+1795", [
            { lang: "fr", value: "Olne" },
            { lang: "wa" },
            { lang: "de", value: "Olne-Lüttich" },
          ]),
          rep("418460", "Olne, Duplicate", "+1900/", [{ lang: "fr", value: "Duplicate" }]),
          rep("7", undefined, undefined, undefined),
          rep("999", "Elsewhere", "+1800/", [{ lang: "en", value: "Elsewhere" }], "9999"),
        ],
      }),
    });
    expect(await getPlaceReps("1959431")).toEqual([
      { placeRepId: "12441861", fullName: "Olne, Liège, Belgium", dateRange: "+1830/", names: ["Olne"] },
      {
        placeRepId: "418460",
        fullName: "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
        dateRange: "/+1795",
        names: ["Olne", "Olne-Lüttich"],
      },
      { placeRepId: "7", names: [] },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.familysearch.org/platform/places/1959431",
      expect.objectContaining({ headers: expect.objectContaining({ "Accept-Language": "en" }) }),
    );
  });

  it("reads past a names list that is not a list, or holds a null entry, so place_search_all's getPlaceRepIds does not throw", async () => {
    // Constructed: no live listing has these shapes.
    const listing = {
      ok: true,
      json: async () => ({
        places: [
          { id: "100", place: { resourceId: "9001" }, names: "Olne" },
          { id: "101", place: { resourceId: "9001" }, names: [null, { lang: "fr", value: "Olne" }] },
          { id: "102", place: { resourceId: "9001" }, names: { lang: "fr", value: "Olne" } },
        ],
      }),
    };
    mockFetch.mockResolvedValueOnce(listing);
    expect(await getPlaceReps("9001")).toEqual([
      { placeRepId: "100", names: [] },
      { placeRepId: "101", names: ["Olne"] },
      { placeRepId: "102", names: [] },
    ]);
    mockFetch.mockResolvedValueOnce(listing);
    expect(await getPlaceRepIds("9001")).toEqual(["100", "101", "102"]);
  });

  it("retries a server error, then throws once the retries are spent", async () => {
    mockFetch.mockResolvedValue(serverError());
    await expect(getPlaceRepIds("9001")).rejects.toThrow(
      "FamilySearch API error: 500 Internal Server Error"
    );
    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Internal placeSearch
// ---------------------------------------------------------------------------

describe("placeSearch (internal)", () => {
  it("throws when placeName is missing", async () => {
    await expect(placeSearch("" as any)).rejects.toThrow("placeName is required");
    await expect(placeSearch(undefined as any)).rejects.toThrow("placeName is required");
    await expect(placeSearch("   " as any)).rejects.toThrow("placeName is required");
  });

  it("narrows to matches whose fullName contains the context name", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
      {
        match: "description/100",
        json: description("100", "Paris, Bear Lake, Idaho, United States", "9001"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Paris", "Idaho");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].placeId).toBe("9001");
    expect(result.results[0].fullName).toBe("Paris, Bear Lake, Idaho, United States");
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("description/200"),
      expect.anything()
    );
  });

  it("keeps the unfiltered list when nothing matches the context name", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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

    expect(result.results.map((r) => r.placeId).sort()).toEqual(["9001", "9002"]);
  });

  it("caches results so a repeat call does not re-fetch", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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
    expect(second.results[0].placeId).toBe("9001");
  });

  it("falls back to search-entry data when a description 404s", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
      { match: "description/100", ok: false, status: 404 },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Paris", "Idaho");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].placeId).toBe("9001");
    expect(result.results[0].fullName).toBe("Paris, Bear Lake, Idaho, United States");
  });

  // #609: with no explicit contextName, derive one from a comma-qualified
  // placeName so the wrong same-name jurisdiction (the higher-scored hit) is
  // dropped rather than returned first.
  it("derives context from a comma-qualified placeName (Bristol, England not Virginia)", async () => {
    routeByUrl([
      { match: "search?q=name:", json: bristolSearchResponse },
      {
        match: "description/300",
        json: description("300", "Bristol, England, United Kingdom", "8300"),
      },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearch("Bristol, England");

    expect(result.results).toHaveLength(1);
    expect(result.results[0].fullName).toBe("Bristol, England, United Kingdom");
    // The higher-scored Virginia hit must never be fetched or returned.
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("description/400"),
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Fuzzy fallback — a misspelled single-token name retries as name:<leaf>~
// ---------------------------------------------------------------------------

describe("fuzzy fallback", () => {
  it("falls back to the fuzzy query on zero exact hits and flags the response", async () => {
    routeByUrl(sierkopasRoutes());

    const result = await placeSearchTool({
      placeName: "Sierkopas",
      contextName: "Germany",
    });

    expect(result.matchType).toBe("fuzzy");
    // Present and flagged — NOT the only result: Scherokopaß, Culm also
    // matches under a Germany context.
    expect(result.results.map((r) => r.standardPlace)).toContain(
      "Sierokopaß, Neidenburg, East Prussia, Prussia, Germany"
    );
  });

  it("applies the context filter to fuzzy entries (unmatched context keeps all)", async () => {
    routeByUrl(sierkopasRoutes());

    const filtered = await placeSearchTool({
      placeName: "Sierkopas",
      contextName: "Neidenburg",
    });
    expect(filtered.results.map((r) => r.standardPlace)).toEqual([
      "Sierokopaß, Neidenburg, East Prussia, Prussia, Germany",
    ]);
    expect(filtered.matchType).toBe("fuzzy");
  });

  it("has no matchType key on an exact hit", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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

    expect("matchType" in result).toBe(false);
  });

  it("returns the fuzzy flag again on a cache hit without re-fetching", async () => {
    routeByUrl(sierkopasRoutes());

    const first = await placeSearchTool({
      placeName: "Sierkopas",
      contextName: "Germany",
    });
    expect(first.matchType).toBe("fuzzy");

    const callsAfterFirst = mockFetch.mock.calls.length;
    const second = await placeSearchTool({
      placeName: "Sierkopas",
      contextName: "Germany",
    });

    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);
    expect(second.matchType).toBe("fuzzy");
  });

  it("makes no second fetch for a multi-word leaf with an empty exact result", async () => {
    // Unquoted multi-token fuzzy is an OR of tokens (live: name:Klein~ Kozlau~
    // returns 349 hits led by "Klin, Croatia") — so it must never be sent.
    routeByUrl([{ match: "search?q=name:", json: { entries: [] } }]);

    const result = await placeSearchTool({ placeName: "Klein Kozlau" });

    expect(result.results).toEqual([]);
    expect("matchType" in result).toBe(false);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("~"))).toHaveLength(0);
  });

  it("returns an unflagged empty response when the fuzzy query also matches nothing", async () => {
    routeByUrl([
      { match: "search?q=name:%22Blorp%22", json: { entries: [] } },
      { match: "search?q=name:Blorp~", json: { entries: [] } },
    ]);

    const result = await placeSearchTool({ placeName: "Blorp" });

    expect(result.results).toEqual([]);
    expect("matchType" in result).toBe(false);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("Blorp~"))).toHaveLength(1);
  });

  it("caps a fuzzy result set before the per-entry fetches", async () => {
    // Live, a bare "Brixtol" returns 319 fuzzy entries; uncapped, each costs a
    // description + Wikipedia fetch and place_search_all exceeds the 60s
    // bridge abort. Exact results are never capped.
    const manyFuzzy: FSPlaceSearchResponse = {
      entries: Array.from({ length: 12 }, (_, i) => ({
        id: `7${String(i).padStart(2, "0")}`,
        score: 100 - i,
        content: {
          gedcomx: {
            places: [
              {
                id: `7${String(i).padStart(2, "0")}`,
                display: {
                  name: `Brixtol${i}`,
                  fullName: `Brixtol${i}, Nowhere`,
                  type: "City",
                },
              },
            ],
          },
        },
      })),
    };
    routeByUrl([
      { match: "search?q=name:%22Brixtol%22", json: { entries: [] } },
      { match: "search?q=name:Brixtol~", json: manyFuzzy },
      { match: "description/", ok: false, status: 404 },
      { match: "attributes", ok: false, status: 404 },
    ]);

    const result = await placeSearchTool({ placeName: "Brixtol" });

    expect(result.matchType).toBe("fuzzy");
    expect(result.results).toHaveLength(10);
    const descriptionFetches = mockFetch.mock.calls.filter(([url]) =>
      (url as string).includes("description/")
    ).length;
    expect(descriptionFetches).toBe(10);
  });

  it("carries the flag through place_search_all", async () => {
    routeByUrl([
      ...sierkopasRoutes(),
      {
        match: "places/8500",
        json: {
          places: [{ id: "8500" }, { id: "500", place: { resourceId: "8500" } }],
        },
      },
      {
        match: "places/8600",
        json: {
          places: [{ id: "8600" }, { id: "600", place: { resourceId: "8600" } }],
        },
      },
    ]);

    const result = await placeSearchAllTool({
      placeName: "Sierkopas",
      contextName: "Germany",
    });

    expect(result.matchType).toBe("fuzzy");
    expect(result.results.map((r) => r.standardPlace)).toContain(
      "Sierokopaß, Neidenburg, East Prussia, Prussia, Germany"
    );
  });
});

// ---------------------------------------------------------------------------
// place_search tool — simplified, ID-free output
// ---------------------------------------------------------------------------

describe("placeSearchTool", () => {
  it("throws when placeName is missing", async () => {
    await expect(placeSearchTool({ placeName: "" } as any)).rejects.toThrow("placeName is required");
  });

  it("returns simplified fields with the FamilySearch WIKIPEDIA_LINK and no identifiers", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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

    expect(result.results).toEqual([]);
  });

  describe("verdict: what the writers store for the query text", () => {
    const ON_NONE = "on a fact that cites no record and has no standard_place supplied, with no other places";
    const STORES =
      `the writers store this standard_place for this place text ${ON_NONE}. A supplied standard_place is ` +
      "kept instead when it is a FamilySearch standard place, as each result is";
    const NONE = `the writers store no standard_place for this place text ${ON_NONE}: `;
    const ONE_PART =
      "the engine leaves a one-part place unstandardized unless it can tell which place it is; " +
      'write its parent jurisdictions into the place text (e.g. "Springfield, Illinois")';
    const shenandoah = (id: string, fullName: string, type: string): FSPlaceSearchResponse => ({
      entries: [{ id, score: 90.0, content: { gedcomx: { places: [{ id, display: { name: "Shenandoah", fullName, type } }] } } }],
    });

    it("names the standard_place the writers store", async () => {
      routeByUrl([
        { match: "search?q=name:", json: bristolSearchResponse },
        { match: "description/300", json: description("300", "Bristol, England, United Kingdom", "8300") },
        { match: "attributes", ok: false, status: 404 },
      ]);
      const result = await placeSearchTool({ placeName: "Bristol, England" });
      expect(result.verdict).toEqual({ standardPlace: "Bristol, England, United Kingdom", reason: STORES });
    });

    it("reads a one-part place against contextName as tree_edit reads it against the fact's other places", async () => {
      const SCHUYLKILL = "Shenandoah, Schuylkill, Pennsylvania, United States";
      routeByUrl([
        { match: "search?q=name:%22Shenandoah%2C%20Schuylkill", json: shenandoah("500", SCHUYLKILL, "Borough") },
        { match: "search?q=name:%22Shenandoah%22", json: shenandoah("600", "Shenandoah, Page, Virginia, United States", "Town") },
        { match: "description/600", json: description("600", "Shenandoah, Page, Virginia, United States", "8600") },
        { match: "attributes", ok: false, status: 404 },
      ]);
      const sibling = "Shenandoah, Schuylkill, Pennsylvania";
      const withContext = await placeSearchTool({ placeName: "Shenandoah", contextName: sibling });
      expect(withContext.verdict).toEqual({
        standardPlace: SCHUYLKILL,
        reason:
          "the writers store this standard_place for this place text on a fact that cites no record and has no " +
          `standard_place supplied, whose other places include '${sibling}'. A supplied standard_place is kept ` +
          "instead when it is a FamilySearch standard place, as each result is",
      });
      const bare = await placeSearchTool({ placeName: "Shenandoah" });
      expect(bare.verdict).toEqual({ standardPlace: null, reason: NONE + ONE_PART });
    });

    it("is none for a phrase that names no place, which is never looked up", async () => {
      routeByUrl([{ match: "search?q=name:", json: { entries: [] } }]);
      const result = await placeSearchTool({ placeName: "Same House" });
      expect(result.verdict).toEqual({ standardPlace: null, reason: NONE + "'Same House' names no place" });
      expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("name:%22Same"))).toHaveLength(1);
    });

    it("is none when the lookup's answer names a different country than the text", async () => {
      const cameroon: FSPlaceSearchResponse = {
        entries: [
          {
            id: "700",
            score: 90.0,
            content: { gedcomx: { places: [{ id: "700", display: { name: "West", fullName: "West, Cameroon", type: "City" } }] } },
          },
        ],
      };
      routeByUrl([
        { match: "search?q=name:", json: cameroon },
        { match: "description/700", json: description("700", "West, Cameroon", "8700") },
        { match: "attributes", ok: false, status: 404 },
      ]);
      const result = await placeSearchTool({ placeName: "West Bromwich, England" });
      expect(result.verdict).toEqual({
        standardPlace: null,
        reason: NONE + "'West, Cameroon' names a different country than the text",
      });
    });

    it("is none for a phrase whose lookup answer the text does not confirm, and names one the text does", async () => {
      const hit = (id: string, name: string, fullName: string): FSPlaceSearchResponse => ({
        entries: [{ id, score: 90.0, content: { gedcomx: { places: [{ id, display: { name, fullName, type: "City" } }] } } }],
      });
      routeByUrl([
        { match: "search?q=name:%22at%20the%20home", json: hit("800", "Of", "Of, Trabzon, Türkiye") },
        { match: "search?q=name:%22412%20Vine", json: hit("900", "Cincinnati", "Cincinnati, Hamilton, Ohio, United States") },
        { match: "description/800", json: description("800", "Of, Trabzon, Türkiye", "8800") },
        { match: "description/900", json: description("900", "Cincinnati, Hamilton, Ohio, United States", "8900") },
        { match: "attributes", ok: false, status: 404 },
      ]);
      const phrase = await placeSearchTool({ placeName: "at the home of her daughter, Mrs. John Smith" });
      expect(phrase.verdict).toEqual({
        standardPlace: null,
        reason:
          NONE +
          "the engine's place lookup answer 'Of, Trabzon, Türkiye' could not be confirmed, as the text names neither a " +
          "country nor that place",
      });
      const named = await placeSearchTool({ placeName: "412 Vine St, Cincinnati" });
      expect(named.verdict).toEqual({ standardPlace: "Cincinnati, Hamilton, Ohio, United States", reason: STORES });
    });

    it("is none when nothing is found for a text of several parts", async () => {
      routeByUrl([{ match: "search?q=name:", json: { entries: [] } }]);
      const result = await placeSearchTool({ placeName: "Nowhereville, Kansas" });
      expect(result.verdict).toEqual({
        standardPlace: null,
        reason: NONE + "the engine's place lookup found no place for this text, or failed",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// place_search_all tool — all jurisdictions over time
// ---------------------------------------------------------------------------

describe("placeSearchAllTool", () => {
  it("throws when placeName is missing", async () => {
    await expect(placeSearchAllTool({ placeName: "" } as any)).rejects.toThrow("placeName is required");
  });

  it("expands each pid to all rep IDs and returns simplified, ID-free results", async () => {
    routeByUrl([
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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
      { match: "search?q=name:%22Paris%22", json: parisSearchResponse },
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
