import { LOCAL, connectorPrincipal } from "../../src/auth/principal.js";
import { connectorReauthMessage, REJECTED_TOKEN_MESSAGE } from "../../src/auth/config.js";
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
  configureCollectionsCache,
  collectionCountsById,
  fitToBudget,
  subPlaceTerms,
  ANSWER_CHAR_BUDGET,
  COLLECTION_URL_TEMPLATE,
} from "../../src/tools/collections-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  Collection,
  CollectionsSearchResult,
  FSCollectionEntry,
  FSCollectionsResponse,
} from "../../src/types/collection.js";
import { callTool } from "../helpers/call-tool.js";

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
  configureCollectionsCache({});
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

    const result = await collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL);

    expect(result).not.toHaveProperty("query");
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
    }, LOCAL);

    // The tool derived "Alabama" (the state) from the full standardPlace and
    // matched the Alabama collection; the derived jurisdiction is in scope.
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

    const result = await collectionsSearchTool({ standardPlace: "alabama" }, LOCAL);

    expect(result.totalForPlace).toBe(1);
    expect(result.results[0].id).toBe("1234");
  });

  it("returns empty array when query matches no titles", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "Narnia" }, LOCAL);

    expect(result.totalForPlace).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("query matches anywhere in the title", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await collectionsSearchTool({ standardPlace: "Census" }, LOCAL);

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
    }, LOCAL);

    // Both titles match "Census" (totalForPlace: 2); only the 1900 one survives
    // the 1890–1920 window.
    expect(result.totalForPlace).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("new");
  });

  it("rejects endYear < startYear", async () => {
    await expect(
      collectionsSearchTool({ standardPlace: "Census", startYear: 1920, endYear: 1890 }, LOCAL)
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

    await expect(collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL)).rejects.toThrow(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a 401 is a sign-in problem, worded for the caller: the login tool on the desktop, the link on a connector", async () => {
    const unauthorized = { ok: false, status: 401, statusText: "Unauthorized", headers: new Headers() };
    mockedGetValidToken.mockResolvedValue("test-token");
    mockFetch.mockResolvedValue(unauthorized);
    await expect(collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL)).rejects.toThrow(REJECTED_TOKEN_MESSAGE);

    clearCollectionsCache();
    const connector = connectorPrincipal({
      accessToken: "dead-token",
      userId: "u_1",
      config: { webPublicUrl: "https://beta.example" },
    });
    const failure = await collectionsSearchTool({ standardPlace: "Alabama" }, connector).catch((e: Error) => e.message);
    expect(failure).toBe(connectorReauthMessage(connector));
    expect(failure).toContain("https://beta.example/auth/familysearch/login");
  });

  it("throws on non-OK API response", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
    });

    await expect(collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL)).rejects.toThrow(
      "FamilySearch collections API error: 500 Internal Server Error"
    );
  });

  it("handles malformed API response gracefully", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL);

    expect(result.totalForPlace).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("throws when standardPlace is not provided", async () => {
    await expect(collectionsSearchTool({ standardPlace: "" }, LOCAL)).rejects.toThrow(
      /collections_search requires a standardPlace/
    );
  });

  it.each(["recordType", "record_type", "recordTypes", "recordTypeGroup", "recordTypeGroups"])(
    "refuses %s rather than returning the place's whole list unfiltered",
    async (alias) => {
      const r = await callTool("collections_search", {
        standardPlace: "New York, United States",
        [alias]: alias.endsWith("s") ? ["Probate"] : "probate",
      });

      expect(r.isError).toBe(true);
      expect(r.text).toMatch(
        new RegExp(
          `no record-type filter: it lists the place's collections by place and years only, so ${alias} ` +
            "cannot narrow it.*volume_search's recordTypeGroups.*Valid groups: Genealogies, .*Probate",
          "s"
        )
      );
      expect(mockedGetValidToken).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );
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

    const result = await collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL);

    // One lean row for every caller: no counts but personCount, no per-row url,
    // and no query echo; the link is the one top-level template.
    expect(result).toEqual({
      collectionUrl: "https://www.familysearch.org/search/collection/{id}",
      scope: "Alabama",
      totalForPlace: 1,
      results: [
        {
          id: "1234",
          title: "Alabama, County Marriages, 1809-1950",
          dateRange: "1809-1950",
          personCount: 1048000,
        },
      ],
    });
  });

  it("collectionCountsById still derives the /Record count the row no longer carries", () => {
    const counts = collectionCountsById(mockApiResponse);
    expect(counts.get("1234")).toEqual({ personCount: 1048000, recordCount: 524000 });
  });
});

describe("collections_search answer budget", () => {
  const row = (id: string, title: string): Collection => ({ id, title, dateRange: "1800-1900", personCount: 1000 });
  const answerOf = (results: Collection[], totalForPlace = results.length): CollectionsSearchResult => ({
    collectionUrl: COLLECTION_URL_TEMPLATE,
    scope: "Italy",
    totalForPlace,
    results,
  });

  // A synthetic Italy-scoped catalog well past the budget: 600 national rows,
  // and one row naming Palermo at the very end of catalog order.
  function bigItaly(): FSCollectionsResponse {
    const entries: FSCollectionEntry[] = [];
    for (let i = 0; i < 600; i++) {
      entries.push(makeEntry({
        id: String(100000 + i),
        title: `Italy, Civil Registration (State Archive), 1802-1940, volume ${i} of a long series`,
        placeIds: [1],
        personCount: 12345678,
        startYear: 1802,
        endYear: 1940,
      }));
    }
    entries.push(makeEntry({
      id: "999999",
      title: "Italy, Palermo, Civil Registration (State Archive), 1820-1910",
      placeIds: [1],
      personCount: 5000,
      startYear: 1820,
      endYear: 1910,
    }));
    return { results: entries.length, entries };
  }

  it("answers an over-budget catalog within the budget, sub-place row first, with truncated and matched", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bigItaly() });

    const result = await collectionsSearchTool({ standardPlace: "Palermo, Sicilia, Italy" }, LOCAL);

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
    expect(result.truncated).toBe(true);
    expect(result.matched).toBe(601);
    expect(result.totalForPlace).toBe(601);
    expect(result.results.length).toBeLessThan(601);
    expect(result.results[0].id).toBe("999999");
    // The rest keep catalog order.
    expect(result.results[1].id).toBe("100000");
    expect(result.results[2].id).toBe("100001");
    expect(result.collectionUrl).toBe(COLLECTION_URL_TEMPLATE);
  });

  it("matched counts rows after the year filter, not totalForPlace and not the rows returned", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    const catalog = bigItaly();
    // 100 more Italy rows outside the window: in totalForPlace, not in matched.
    for (let i = 0; i < 100; i++) {
      catalog.entries!.push(makeEntry({ id: String(500000 + i), title: `Italy, Late Records ${i}`, placeIds: [1], startYear: 1990, endYear: 2000 }));
    }
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => catalog });

    const result = await collectionsSearchTool({ standardPlace: "Italy", startYear: 1850, endYear: 1860 }, LOCAL);

    expect(result.totalForPlace).toBe(701);
    expect(result.matched).toBe(601);
    expect(result.results.length).toBeLessThan(601);
  });

  it("keeps rows in order up to the edge: one more would not have fit", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(String(i), `Italy, Records ${i}`));
    const out = fitToBudget(answerOf(rows), "Italy", 1500);
    expect(out.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(1500);
    // With no sub-place in the input, the kept rows are the first in catalog order.
    expect(out.results.map((r) => r.id)).toEqual(rows.slice(0, out.results.length).map((r) => r.id));
    const next = rows[out.results.length];
    expect(JSON.stringify(out).length + JSON.stringify(next).length + 1).toBeGreaterThan(1500);
  });

  it("leaves an answer under the budget exactly as it was: catalog order, no truncated or matched", () => {
    const answer = answerOf([row("1", "Italy, Records"), row("2", "Italy, Palermo, Records")]);
    const out = fitToBudget(answer, "Palermo, Sicilia, Italy");
    expect(JSON.stringify(out)).toBe(JSON.stringify(answer));
    expect(out).not.toHaveProperty("truncated");
    expect(out).not.toHaveProperty("matched");
  });

  it("matches a sub-place as a whole word, so Rome does not pull Romeo forward", () => {
    const rows = [
      row("1", "Italy, Romeo Family Papers"),
      row("2", "Italy, Records"),
      row("3", "Italy, Rome, Catholic Church Records"),
    ];
    const out = fitToBudget(answerOf(rows), "Rome, Lazio, Italy", 260);
    expect(out.truncated).toBe(true);
    expect(out.results[0].id).toBe("3");
  });
});

describe("subPlaceTerms", () => {
  it("names the parts below the derived scope", () => {
    expect(subPlaceTerms("Palermo, Sicilia, Italy")).toEqual(["Palermo", "Sicilia"]);
    expect(subPlaceTerms("Schuylkill, Pennsylvania, United States")).toEqual(["Schuylkill"]);
    expect(subPlaceTerms("Toronto, Ontario, Canada")).toEqual(["Toronto"]);
    expect(subPlaceTerms("Italy")).toEqual([]);
    expect(subPlaceTerms("Pennsylvania, United States")).toEqual([]);
  });

  it("has none for free text that is its own scope", () => {
    expect(subPlaceTerms("Census")).toEqual([]);
  });
});

describe("collectionsSearchTool — User-Agent contract", () => {
  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    await collectionsSearchTool({ standardPlace: "Alabama" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
  });
});

describe("fetchAllCollections cache", () => {
  const ok = () => ({ ok: true, json: async () => mockApiResponse });
  const forbidden = () => ({ ok: false, status: 403, statusText: "Forbidden", headers: new Headers() });

  beforeEach(() => {
    mockedGetValidToken.mockResolvedValue("fs-token");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("setting unset (today's behaviour)", () => {
    it("serves the same token from cache, and refetches for another token", async () => {
      mockFetch.mockResolvedValue(ok());
      await fetchAllCollections("token-a", LOCAL);
      await fetchAllCollections("token-a", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps one slot: the second token's fetch replaces the first's", async () => {
      mockFetch.mockResolvedValue(ok());
      await fetchAllCollections("token-a", LOCAL);
      await fetchAllCollections("token-b", LOCAL);
      await fetchAllCollections("token-a", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("is what an explicit shared: false gives", async () => {
      configureCollectionsCache({ shared: false });
      mockFetch.mockResolvedValue(ok());
      await fetchAllCollections("token-a", LOCAL);
      await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("shared", () => {
    beforeEach(() => configureCollectionsCache({ shared: true }));

    it("serves one patron's cached catalog to another patron's call", async () => {
      mockFetch.mockResolvedValue(ok());
      const a = await fetchAllCollections("token-a", LOCAL);
      const b = await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(b).toBe(a);
    });

    it("never hands one patron's failed fetch to another: the next call fetches for itself", async () => {
      mockFetch.mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(ok());
      await expect(fetchAllCollections("token-a", LOCAL)).rejects.toThrow(
        "FamilySearch collections API error: 403 Forbidden",
      );
      await expect(fetchAllCollections("token-b", LOCAL)).resolves.toEqual(mockApiResponse);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not share an in-flight fetch: two cold calls each fetch, and one failing leaves the other whole", async () => {
      let release!: (v: unknown) => void;
      mockFetch
        .mockImplementationOnce(() => new Promise((r) => { release = r; }))
        .mockResolvedValueOnce(ok());
      const a = fetchAllCollections("token-a", LOCAL);
      const b = fetchAllCollections("token-b", LOCAL);
      await expect(b).resolves.toEqual(mockApiResponse);
      release(forbidden());
      await expect(a).rejects.toThrow("403 Forbidden");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("still expires after an hour", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-02T00:00:00Z"));
      mockFetch.mockResolvedValue(ok());
      await fetchAllCollections("token-a", LOCAL);
      vi.setSystemTime(new Date("2026-11-02T00:59:59Z"));
      await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-11-02T01:00:01Z"));
      await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("turned back off, keys on the token again", async () => {
      mockFetch.mockResolvedValue(ok());
      await fetchAllCollections("token-a", LOCAL);
      configureCollectionsCache({});
      await fetchAllCollections("token-b", LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
