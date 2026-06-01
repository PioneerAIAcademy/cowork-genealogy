import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { placeCatalogTool } from "../../src/tools/place-catalog.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TOKEN = "test-token-abc";

// ---------- fixtures ----------

function makePlacesResponse(placeId: string, repIds: string[]) {
  return {
    places: [
      { id: placeId }, // Primary stub (no display block)
      ...repIds.map((id) => ({ id })),
    ],
  };
}

function makeSearchResponse(
  hits: Array<{ id: string; title?: string; score?: number }>,
  totalHits?: number
) {
  return {
    searchHits: hits.map((h) => ({
      metadataHit: {
        metadata: {
          creator: ["Author One"],
          identifier: {
            value: `https://www.familysearch.org/service/search/catalog/item/${h.id}`,
          },
          title: [{ value: h.title ?? "Test Title", lang: "en-US" }],
          repositoryCalls: [{ title: "FamilySearch Library" }],
        },
        score: h.score ?? 1.0,
      },
    })),
    facets: [],
    totalHits: totalHits ?? hits.length,
    offset: 0,
  };
}

function makeItemDetail(opts: {
  filmNotes?: Array<{ digital_film_no?: string; fs_indexed?: "Y" | "N" }>;
  noSource?: boolean;
}) {
  if (opts.noSource) return {};
  return {
    source: {
      film_note: opts.filmNotes ?? [],
    },
  };
}

function makeFulltextResponse(results: number) {
  return { results };
}

function makePermissionsResponse(allowed: boolean, dgn = "7937005") {
  return {
    sourceDescriptions: [
      {
        id: dgn,
        rights: allowed ? ["http://familysearch.org/v1/Allowed"] : [],
      },
    ],
  };
}

// Shorthand to mock fetch calls in order
function setFetchSequence(responses: Array<{ ok: boolean; body: unknown; status?: number }>) {
  let i = 0;
  mockFetch.mockImplementation(() => {
    const r = responses[i++] ?? { ok: true, body: {} };
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? "OK" : "Internal Server Error",
      json: () => Promise.resolve(r.body),
    });
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue(TOKEN);
});

// ---------- happy paths ----------

describe("happy path: placeId only", () => {
  it("resolves rep IDs, runs one search per rep, dedupes, enriches 3 flags", async () => {
    setFetchSequence([
      // 1. Places API (rep resolution)
      { ok: true, body: makePlacesResponse("33", ["351"]) },
      // 2. Catalog search for rep 351
      { ok: true, body: makeSearchResponse([{ id: "koha:1837843", title: "Alabama Civil War records", score: 1.0 }], 894) },
      // 3. Item-detail for koha:1837843
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005", fs_indexed: "N" }] }) },
      // 4. Fulltext search
      { ok: true, body: makeFulltextResponse(0) },
      // 5. Artifacts permissions
      { ok: true, body: makePermissionsResponse(false) },
    ]);

    const result = await placeCatalogTool({ placeId: "33" });

    expect(result.placeId).toBe("33");
    expect(result.totalHits).toBe(894);
    expect(result.returnedCount).toBe(1);
    expect(result.offset).toBe(0);
    expect(result.hits).toHaveLength(1);

    const hit = result.hits[0];
    expect(hit.id).toBe("koha:1837843");
    expect(hit.title).toBe("Alabama Civil War records");
    expect(hit.authors).toEqual(["Author One"]);
    expect(hit.holdings).toEqual(["FamilySearch Library"]);
    expect(hit.score).toBe(1.0);
    expect(hit.url).toBe("https://www.familysearch.org/search/catalog/koha:1837843");
    expect(hit.filmNotes).toHaveLength(1);
    expect(hit.filmNotes[0].imageGroupNumber).toBe("7937005");
    expect(hit.filmNotes[0].record_searchable).toBe(false);
    expect(hit.filmNotes[0].fulltext_searchable).toBe(false);
    expect(hit.filmNotes[0].image_searchable).toBe(false);
  });
});

describe("happy path: keywords only (no placeId)", () => {
  it("runs a single search with q.keywords, no Places API call", async () => {
    setFetchSequence([
      // 1. Catalog search (no rep lookup)
      { ok: true, body: makeSearchResponse([{ id: "koha:999", title: "Civil War Pensions" }], 42) },
      // 2. Item-detail
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    const result = await placeCatalogTool({ keywords: "civil war" });

    expect(result.placeId).toBeUndefined();
    expect(result.totalHits).toBe(42);
    expect(result.hits[0].id).toBe("koha:999");

    // First fetch must be the catalog search (not Places API)
    const firstCall = mockFetch.mock.calls[0][0] as string;
    expect(firstCall).toContain("sg30p0.familysearch.org");
    expect(firstCall).toContain("q.keywords=civil+war");
  });
});

describe("happy path: imageGroupNumber only", () => {
  it("sends q.film_number in the catalog search URL", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:381194" }], 1) },
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    await placeCatalogTool({ imageGroupNumber: "7937005" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.film_number=7937005");
  });
});

describe("happy path: surname only", () => {
  it("sends q.surname in the catalog search URL", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:2103552" }], 5) },
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    await placeCatalogTool({ surname: "Butler" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.surname=Butler");
  });
});

// ---------- dedup ----------

describe("dedup", () => {
  it("same id across two rep responses → kept once, highest score wins", async () => {
    setFetchSequence([
      // Places API → 2 reps
      { ok: true, body: makePlacesResponse("2249479", ["6068937", "6068938"]) },
      // Search for rep 6068937 → hit with score 0.8
      { ok: true, body: makeSearchResponse([{ id: "koha:555", score: 0.8 }], 10) },
      // Search for rep 6068938 → same hit with higher score 1.0
      { ok: true, body: makeSearchResponse([{ id: "koha:555", score: 1.0 }], 10) },
      // Item-detail for the single deduped hit
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    const result = await placeCatalogTool({ placeId: "2249479" });

    expect(result.returnedCount).toBe(1);
    expect(result.hits[0].id).toBe("koha:555");
    expect(result.hits[0].score).toBe(1.0); // highest wins
  });
});

// ---------- 3 flags ----------

describe("per-DGS flags: record_searchable", () => {
  it("each film note gets its own record_searchable from fs_indexed", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:632547" }], 1) },
      {
        ok: true,
        body: makeItemDetail({
          filmNotes: [
            { digital_film_no: "4000001", fs_indexed: "Y" },
            { digital_film_no: "4000002", fs_indexed: "N" },
          ],
        }),
      },
      { ok: true, body: makeFulltextResponse(0) },  // fulltext for 4000001
      { ok: true, body: makeFulltextResponse(0) },  // fulltext for 4000002
      {
        ok: true,
        body: { sourceDescriptions: [
          { id: "4000001", rights: [] },
          { id: "4000002", rights: [] },
        ]},
      },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].record_searchable).toBe(true);  // Y
    expect(result.hits[0].filmNotes[1].record_searchable).toBe(false); // N
  });

  it("false when fs_indexed field is absent", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:381194" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005" }] }) },
      { ok: true, body: makeFulltextResponse(601) },
      { ok: true, body: makePermissionsResponse(true) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].record_searchable).toBe(false);
  });
});

describe("per-DGS flags: fulltext_searchable", () => {
  it("true for a DGS when fulltext endpoint returns results > 0", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:381194" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005" }] }) },
      { ok: true, body: makeFulltextResponse(601) },
      { ok: true, body: makePermissionsResponse(false) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].fulltext_searchable).toBe(true);
  });

  it("false for a DGS when fulltext endpoint returns results === 0", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:62934" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7953746" }] }) },
      { ok: true, body: makeFulltextResponse(0) },
      { ok: true, body: makePermissionsResponse(false, "7953746") },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].fulltext_searchable).toBe(false);
  });

  it("filmNotes is [] when catalog item has no digital film numbers", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:book1" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [] }) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes).toEqual([]);
    expect(mockFetch.mock.calls).toHaveLength(2); // search + item-detail only
  });

  it("each DGS gets its own fulltext check", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:multi" }], 1) },
      {
        ok: true,
        body: makeItemDetail({
          filmNotes: [
            { digital_film_no: "1111111" },
            { digital_film_no: "2222222" },
          ],
        }),
      },
      { ok: true, body: makeFulltextResponse(10) }, // 1111111 → true
      { ok: true, body: makeFulltextResponse(0) },  // 2222222 → false
      {
        ok: true,
        body: { sourceDescriptions: [
          { id: "1111111", rights: [] },
          { id: "2222222", rights: [] },
        ]},
      },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].fulltext_searchable).toBe(true);
    expect(result.hits[0].filmNotes[1].fulltext_searchable).toBe(false);
  });
});

describe("per-DGS flags: image_searchable", () => {
  it("true for a DGS when its rights includes Allowed", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:111" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005" }] }) },
      { ok: true, body: makeFulltextResponse(0) },
      { ok: true, body: makePermissionsResponse(true) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].image_searchable).toBe(true);
  });

  it("false for a DGS when rights is empty", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:222" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005" }] }) },
      { ok: true, body: makeFulltextResponse(0) },
      { ok: true, body: makePermissionsResponse(false) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].image_searchable).toBe(false);
  });

  it("each DGS gets its own image_searchable from permissions response", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:multi" }], 1) },
      {
        ok: true,
        body: makeItemDetail({
          filmNotes: [
            { digital_film_no: "7937005" },
            { digital_film_no: "4808462" },
          ],
        }),
      },
      { ok: true, body: makeFulltextResponse(0) }, // 7937005
      { ok: true, body: makeFulltextResponse(0) }, // 4808462
      {
        ok: true,
        body: {
          sourceDescriptions: [
            { id: "7937005", rights: [] },
            { id: "4808462", rights: ["http://familysearch.org/v1/Allowed"] },
          ],
        },
      },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].image_searchable).toBe(false); // 7937005
    expect(result.hits[0].filmNotes[1].image_searchable).toBe(true);  // 4808462
  });

  it("sends one POST with all DGS numbers to artifacts-permissions", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:333" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005" }] }) },
      { ok: true, body: makeFulltextResponse(0) },
      { ok: true, body: makePermissionsResponse(false) },
    ]);

    await placeCatalogTool({ keywords: "test" });

    const permCall = mockFetch.mock.calls[3];
    expect(permCall[0]).toContain("artifacts/groups/permissions");
    expect(permCall[1].method).toBe("POST");
    expect(permCall[1].headers["Content-Type"]).toBe("application/x-gedcomx-v1+json");
    const body = JSON.parse(permCall[1].body as string);
    expect(body.sourceDescriptions).toEqual([{ id: "7937005" }]);
  });
});

// ---------- enrichment failure handling ----------

describe("per-hit item-detail failure", () => {
  it("filmNotes = [] on cascade, search still succeeds", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:fail" }], 1) },
      { ok: false, body: {}, status: 500 }, // item-detail fails
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes).toEqual([]);
    expect(result.returnedCount).toBe(1);
  });
});

describe("per-hit fulltext-search failure in isolation", () => {
  it("fulltext_searchable = false for that DGS, other flags unaffected", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:partial" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005", fs_indexed: "Y" }] }) },
      { ok: false, body: {}, status: 503 }, // fulltext fails
      { ok: true, body: makePermissionsResponse(true) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].record_searchable).toBe(true);
    expect(result.hits[0].filmNotes[0].fulltext_searchable).toBe(false); // failed
    expect(result.hits[0].filmNotes[0].image_searchable).toBe(true);
  });
});

describe("per-hit artifacts-permissions failure in isolation", () => {
  it("image_searchable = false for all DGS, other flags unaffected", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:perm-fail" }], 1) },
      { ok: true, body: makeItemDetail({ filmNotes: [{ digital_film_no: "7937005", fs_indexed: "Y" }] }) },
      { ok: true, body: makeFulltextResponse(50) },
      { ok: false, body: {}, status: 503 }, // permissions fails
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes[0].record_searchable).toBe(true);
    expect(result.hits[0].filmNotes[0].fulltext_searchable).toBe(true);
    expect(result.hits[0].filmNotes[0].image_searchable).toBe(false); // failed
  });
});

// ---------- empty results ----------

describe("empty results", () => {
  it("returns totalHits: 0, hits: [], not an error", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    const result = await placeCatalogTool({ keywords: "xyzzy-no-match" });
    expect(result.totalHits).toBe(0);
    expect(result.hits).toEqual([]);
    expect(result.returnedCount).toBe(0);
  });
});

// ---------- id extraction ----------

describe("id extraction", () => {
  it("keeps koha: prefix", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:1837843" }], 1) },
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].id).toBe("koha:1837843");
    expect(result.hits[0].url).toBe(
      "https://www.familysearch.org/search/catalog/koha:1837843"
    );
  });

  it("keeps olib: prefix", async () => {
    const body = {
      searchHits: [
        {
          metadataHit: {
            metadata: {
              identifier: {
                value: "https://www.familysearch.org/search/catalog/olib:2103552",
              },
              title: [{ value: "Test" }],
              repositoryCalls: [],
            },
            score: 0.9,
          },
        },
      ],
      totalHits: 1,
      offset: 0,
    };

    setFetchSequence([
      { ok: true, body },
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].id).toBe("olib:2103552");
  });
});

// ---------- filmNotes ----------

describe("filmNotes", () => {
  it("dedupes film notes by DGS number, preserving first occurrence", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:632547" }], 1) },
      {
        ok: true,
        body: makeItemDetail({
          filmNotes: [
            { digital_film_no: "4808462", fs_indexed: "Y" },
            { digital_film_no: "7937005", fs_indexed: "N" },
            { digital_film_no: "4808462", fs_indexed: "Y" }, // duplicate — dropped
          ],
        }),
      },
      { ok: true, body: makeFulltextResponse(1) },  // 4808462
      { ok: true, body: makeFulltextResponse(0) },  // 7937005
      {
        ok: true,
        body: {
          sourceDescriptions: [
            { id: "4808462", rights: ["http://familysearch.org/v1/Allowed"] },
            { id: "7937005", rights: [] },
          ],
        },
      },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes).toHaveLength(2);
    expect(result.hits[0].filmNotes[0].imageGroupNumber).toBe("4808462");
    expect(result.hits[0].filmNotes[1].imageGroupNumber).toBe("7937005");
  });

  it("filmNotes is [] when item has no digital film numbers", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([{ id: "koha:999" }], 1) },
      { ok: true, body: makeItemDetail({ noSource: true }) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.hits[0].filmNotes).toEqual([]);
  });
});

// ---------- URL building ----------

describe("URL building", () => {
  it("m.queryRequireDefault=on is always present", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ keywords: "test" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("m.queryRequireDefault=on");
  });

  it("m.defaultFacets=off is always present", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ keywords: "test" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("m.defaultFacets=off");
  });

  it("when count not provided, request includes count=20", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ keywords: "test" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("count=20");
  });

  it("when offset not provided, request includes offset=0", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ keywords: "test" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("offset=0");
  });

  it("place name with spaces is URL-encoded when using q.place_id", async () => {
    setFetchSequence([
      { ok: true, body: makePlacesResponse("33", ["351"]) },
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ placeId: "33" });
    const catalogUrl = mockFetch.mock.calls[1][0] as string;
    expect(catalogUrl).toContain("q.place_id=351");
  });
});

// ---------- output: placeId echo ----------

describe("placeId echo in output", () => {
  it("echoes placeId when caller provided one", async () => {
    setFetchSequence([
      { ok: true, body: makePlacesResponse("33", ["351"]) },
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    const result = await placeCatalogTool({ placeId: "33" });
    expect(result.placeId).toBe("33");
  });

  it("omits placeId when search did not use placeId", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    const result = await placeCatalogTool({ keywords: "test" });
    expect(result.placeId).toBeUndefined();
  });
});

// ---------- validation ----------

describe("validation", () => {
  it("throws when none of the four axes provided", async () => {
    await expect(placeCatalogTool({})).rejects.toThrow(
      "at least one of placeId, keywords, surname, or imageGroupNumber is required"
    );
  });

  it("throws when count = 0", async () => {
    await expect(placeCatalogTool({ keywords: "test", count: 0 })).rejects.toThrow(
      "place_catalog: count must be between 1 and 100. Got: 0."
    );
  });

  it("throws when count = 200", async () => {
    await expect(placeCatalogTool({ keywords: "test", count: 200 })).rejects.toThrow(
      "place_catalog: count must be between 1 and 100. Got: 200."
    );
  });

  it("throws when offset = -1", async () => {
    await expect(placeCatalogTool({ keywords: "test", offset: -1 })).rejects.toThrow(
      "place_catalog: offset must be non-negative. Got: -1."
    );
  });
});

// ---------- error handling ----------

describe("error handling: placeId resolves to zero reps", () => {
  it("throws the 'no catalog rep mapping' error", async () => {
    setFetchSequence([
      {
        ok: true,
        body: { places: [{ id: "99999" }] }, // only the stub, no reps
      },
    ]);

    await expect(placeCatalogTool({ placeId: "99999" })).rejects.toThrow(
      "placeId 99999 has no catalog rep mapping"
    );
  });
});

describe("error handling: getValidToken throws (no local session)", () => {
  it("propagates the not-logged-in error from getValidToken", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(placeCatalogTool({ keywords: "civil war" })).rejects.toThrow(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    );
  });
});

describe("error handling: 401 from catalog search", () => {
  it("throws the not-logged-in error", async () => {
    setFetchSequence([
      { ok: true, body: makePlacesResponse("33", ["351"]) },
      { ok: false, body: {}, status: 401 },
    ]);

    await expect(placeCatalogTool({ placeId: "33" })).rejects.toThrow(
      "not logged in to FamilySearch"
    );
  });
});

describe("error handling: 400 with JSON detail from catalog search", () => {
  it("quotes the detail in the error message", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("platform/places")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makePlacesResponse("33", ["351"])),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () =>
          Promise.resolve({ message: "Unable to map supplied value" }),
      });
    });

    await expect(placeCatalogTool({ placeId: "33" })).rejects.toThrow(
      "catalog rejected the request"
    );
  });
});

// ---------- auth headers ----------

describe("auth headers", () => {
  it("sends Authorization and browser User-Agent on catalog search", async () => {
    setFetchSequence([
      { ok: true, body: makeSearchResponse([], 0) },
    ]);

    await placeCatalogTool({ keywords: "test" });

    const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });
});
