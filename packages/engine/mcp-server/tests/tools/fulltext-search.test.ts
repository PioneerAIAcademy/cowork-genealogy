import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// Stage results host-side is best-effort and touches the filesystem; mock it so
// these tool tests stay offline and deterministic. The real staging contract is
// covered by tests/utils/results-staging.test.ts.
vi.mock("../../src/utils/results-staging.js", () => ({
  stageSearchResults: vi.fn(),
}));

import { fulltextSearchTool } from "../../src/tools/fulltext-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  FSFulltextResponse,
  FSFulltextEntry,
} from "../../src/types/fulltext-search.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockedStage = vi.mocked(stageSearchResults);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
  mockedStage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// fulltext_search keeps its helpers (buildUrl/mapEntry/mapFacets/validateInput)
// module-private, so — unlike record-search.test.ts which imports them — these
// tests drive everything through the public entry point and assert the URL the
// tool built (mockFetch.mock.calls) and the mapped response it returned.

function makeOk(body: FSFulltextResponse): {
  ok: true;
  status: 200;
  statusText: "OK";
  json: () => Promise<FSFulltextResponse>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

function emptyBody(): FSFulltextResponse {
  return { results: 0, index: 0, entries: [] };
}

function flynnEntry(): FSFulltextEntry {
  return {
    id: "3:1:3Q9M-CSNL-S98H-M",
    sourceUrl: "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M",
    collectionId: "2221234",
    collectionTitle: "Ireland Catholic Parish Registers",
    content: {
      title: "Last Will and Testament of Patrick Flynn",
      recordDate: "1849",
      recordType: "Probate",
      recordPlace: "Tipperary, Ireland",
      textDocument: "...full transcript text...",
      entities: [
        { type: "NAME", value: "Patrick Flynn" },
        { type: "NAME", value: "Mary Flynn" },
        { type: "NAME", value: "Patrick Flynn" }, // duplicate -> deduped
        { type: "PLACE", value: "Tipperary" },
        { type: "PLACE", value: "Tipperary" }, // duplicate -> deduped
        { type: "DATE", value: "1849" },
        { type: "OTHER", value: "ignored" }, // not NAME/PLACE/DATE -> dropped
      ],
      highlightTexts: ["Patrick <em>Flynn</em>"],
    },
  };
}

describe("fulltextSearchTool happy path", () => {
  it("1. returns mapped results with totals, offset, and hasMore", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({
        results: 87,
        index: 0,
        entries: [flynnEntry()],
        links: { next: { href: "https://...&offset=5" } },
      })
    );

    const result = await fulltextSearchTool({ keywords: "+Patrick +Flynn" });

    expect(result.totalResults).toBe(87);
    expect(result.returned).toBe(1);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
    expect(result.results[0].id).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
  });

  it("2. echoes the supplied query fields, dropping undefined", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      count: 5,
      includeFacets: true,
    });
    expect(result.query).toMatchObject({
      keywords: "Flynn",
      count: 5,
      includeFacets: true,
    });
    expect(result.query).not.toHaveProperty("name");
  });
});

describe("fulltextSearchTool param mapping", () => {
  async function urlFor(
    input: Parameters<typeof fulltextSearchTool>[0]
  ): Promise<string> {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    await fulltextSearchTool(input);
    const calls = mockFetch.mock.calls;
    return calls[calls.length - 1][0] as string;
  }

  it("3. maps every q.* and f.* param", async () => {
    const url = await urlFor({
      keywords: "Flynn",
      name: "Patrick Flynn",
      place: "Tipperary",
      collectionId: "2221234",
      imageGroupNumber: "004010852",
      yearFrom: 1840,
      yearTo: 1850,
      recordType: "Probate",
      recordPlace0: "Europe",
      recordPlace1: "Ireland",
      recordPlace2: "Tipperary",
      recordPlace3: "Nenagh",
    });
    expect(url).toContain("q.text=Flynn");
    expect(url).toContain("q.fullName=Patrick%20Flynn");
    expect(url).toContain("q.recordPlace=Tipperary");
    expect(url).toContain("f.collectionId=2221234");
    expect(url).toContain("q.groupName=004010852");
    expect(url).toContain("f.recordYear0=1840");
    expect(url).toContain("f.recordYear1=1850");
    expect(url).toContain("f.recordType0=Probate");
    expect(url).toContain("f.recordPlace0=Europe");
    expect(url).toContain("f.recordPlace1=Ireland");
    expect(url).toContain("f.recordPlace2=Tipperary");
    expect(url).toContain("f.recordPlace3=Nenagh");
  });

  it("4. sends default count=5, offset=0 and m.queryRequireDefault=on", async () => {
    const url = await urlFor({ keywords: "Flynn" });
    expect(url).toContain("count=5");
    expect(url).toContain("offset=0");
    expect(url).toContain("m.queryRequireDefault=on");
  });

  it("5. count and offset overrides land in the URL", async () => {
    const url = await urlFor({ keywords: "Flynn", count: 25, offset: 50 });
    expect(url).toContain("count=25");
    expect(url).toContain("offset=50");
  });

  it("6. includeFacets adds m.defaultFacets=on; default omits it", async () => {
    const withFacets = await urlFor({ keywords: "Flynn", includeFacets: true });
    expect(withFacets).toContain("m.defaultFacets=on");
    const without = await urlFor({ keywords: "Flynn" });
    expect(without).not.toContain("m.defaultFacets");
  });

  it("7. URL-encodes Lucene operator/phrase syntax", async () => {
    const q = '+"Last Will" +Flynn';
    const url = await urlFor({ keywords: q });
    expect(url).toContain(`q.text=${encodeURIComponent(q)}`);
  });
});

describe("fulltextSearchTool input validation", () => {
  it("8. throws when no query field is supplied and never calls fetch", async () => {
    await expect(fulltextSearchTool({})).rejects.toThrow(
      /At least one of keywords, name, place, nlQuery, or imageGroupNumber/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("9. accepts a query via any single field (imageGroupNumber alone)", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    await expect(
      fulltextSearchTool({ imageGroupNumber: "004010852" })
    ).resolves.toBeDefined();
  });

  it("10. throws when count is out of 1..100 or non-integer", async () => {
    await expect(
      fulltextSearchTool({ keywords: "x", count: 0 })
    ).rejects.toThrow(/count must be between 1 and 100/);
    await expect(
      fulltextSearchTool({ keywords: "x", count: 101 })
    ).rejects.toThrow(/count must be between 1 and 100/);
    await expect(
      fulltextSearchTool({ keywords: "x", count: 1.5 })
    ).rejects.toThrow(/count must be between 1 and 100/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("11. throws when offset is negative or non-integer", async () => {
    await expect(
      fulltextSearchTool({ keywords: "x", offset: -1 })
    ).rejects.toThrow(/offset must be non-negative/);
    await expect(
      fulltextSearchTool({ keywords: "x", offset: 2.5 })
    ).rejects.toThrow(/offset must be non-negative/);
  });

  it("12. throws when yearFrom and yearTo are not supplied together", async () => {
    await expect(
      fulltextSearchTool({ keywords: "x", yearFrom: 1840 })
    ).rejects.toThrow(/yearFrom and yearTo must be provided together/);
    await expect(
      fulltextSearchTool({ keywords: "x", yearTo: 1850 })
    ).rejects.toThrow(/yearFrom and yearTo must be provided together/);
  });

  it("13. throws when yearFrom > yearTo", async () => {
    await expect(
      fulltextSearchTool({ keywords: "x", yearFrom: 1850, yearTo: 1840 })
    ).rejects.toThrow(/yearFrom must be <= yearTo/);
  });

  it("14. accepts an equal year pair", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    await expect(
      fulltextSearchTool({ keywords: "x", yearFrom: 1849, yearTo: 1849 })
    ).resolves.toBeDefined();
  });
});

describe("fulltextSearchTool natural-language query", () => {
  it("15. emits the nlQuery param and the X-FS-Feature-Tag header", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    const q = "Search for John Doe born in Austria";
    await fulltextSearchTool({ nlQuery: q });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`nlQuery=${encodeURIComponent(q)}`);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-FS-Feature-Tag"]).toBe("search_naturalLanguageSupport");
  });

  it("16. omits the feature header for a non-nlQuery search", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    await fulltextSearchTool({ keywords: "Flynn" });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-FS-Feature-Tag"]).toBeUndefined();
  });
});

describe("fulltextSearchTool error propagation", () => {
  it("17. propagates the auth error and never calls fetch", async () => {
    mockedGetValidToken.mockReset();
    mockedGetValidToken.mockRejectedValueOnce(
      new Error(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );
    await expect(
      fulltextSearchTool({ keywords: "Flynn" })
    ).rejects.toThrow(/not logged in/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("18. throws re-authenticate guidance on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    await expect(fulltextSearchTool({ keywords: "Flynn" })).rejects.toThrow(
      /session expired; call the login tool/
    );
  });

  it("19. throws unmodified-build guidance on 403", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    await expect(fulltextSearchTool({ keywords: "Flynn" })).rejects.toThrow(
      /blocked the request/
    );
  });

  it("20. throws query-syntax guidance with body detail on 400", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "unbalanced quote",
    });
    await expect(
      fulltextSearchTool({ keywords: 'Flynn"' })
    ).rejects.toThrow(/rejected the query \(400\)[\s\S]*Detail: unbalanced quote/);
  });

  it("21. falls back to a generic 400 message (no Detail clause) when the body can't be read", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => {
        throw new Error("no body");
      },
    });
    const err = await fulltextSearchTool({ keywords: "Flynn" }).catch(
      (e) => e as Error
    );
    expect(err.message).toMatch(/rejected the query \(400\)/);
    expect(err.message).not.toContain("Detail:");
  });

  it("22. throws a generic message for other non-OK statuses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(fulltextSearchTool({ keywords: "Flynn" })).rejects.toThrow(
      /full-text search error: 500 Internal Server Error/
    );
  });
});

describe("fulltextSearchTool response shaping", () => {
  it("23. normalizes the record id and partitions/dedupes entities", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({ results: 1, index: 0, entries: [flynnEntry()] })
    );
    const r = (await fulltextSearchTool({ keywords: "Flynn" })).results[0];
    expect(r.id).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
    expect(r.names).toEqual(["Patrick Flynn", "Mary Flynn"]); // deduped, OTHER dropped
    expect(r.places).toEqual(["Tipperary"]);
    expect(r.dates).toEqual(["1849"]);
    expect(r.highlightTerms).toEqual(["Patrick <em>Flynn</em>"]);
    expect(r.sourceUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:3Q9M-CSNL-S98H-M"
    );
    expect(r.collectionId).toBe("2221234");
    expect(r.collectionTitle).toBe("Ireland Catholic Parish Registers");
    expect(r.title).toBe("Last Will and Testament of Patrick Flynn");
    expect(r.recordDate).toBe("1849");
    expect(r.recordType).toBe("Probate");
    expect(r.recordPlace).toBe("Tipperary, Ireland");
    expect(r.textDocument).toBe("...full transcript text...");
  });

  it("24. normalizes a resolver-URL id to the bare ARK form", async () => {
    const entry: FSFulltextEntry = {
      id: "https://www.familysearch.org/ark:/61903/3:2:ABCD-1234",
    };
    mockFetch.mockResolvedValueOnce(makeOk({ results: 1, entries: [entry] }));
    const r = (await fulltextSearchTool({ keywords: "x" })).results[0];
    expect(r.id).toBe("ark:/61903/3:2:ABCD-1234");
  });

  it("25. omits empty entity arrays and absent optional fields", async () => {
    const entry: FSFulltextEntry = {
      id: "3:1:BARE-ONLY",
      content: { entities: [], highlightTexts: [] },
    };
    mockFetch.mockResolvedValueOnce(makeOk({ results: 1, entries: [entry] }));
    const r = (await fulltextSearchTool({ keywords: "x" })).results[0];
    expect(r.id).toBe("ark:/61903/3:1:BARE-ONLY");
    expect(r.names).toBeUndefined();
    expect(r.places).toBeUndefined();
    expect(r.dates).toBeUndefined();
    expect(r.highlightTerms).toBeUndefined();
    expect(r.title).toBeUndefined();
  });

  it("26. drops entries without an id and counts only the survivors", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({
        results: 2,
        index: 0,
        entries: [{ content: {} }, flynnEntry()],
      })
    );
    const result = await fulltextSearchTool({ keywords: "Flynn" });
    expect(result.returned).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe("ark:/61903/3:1:3Q9M-CSNL-S98H-M");
  });

  it("27. returns an empty result set with hasMore=false", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    const result = await fulltextSearchTool({ keywords: "Nobody" });
    expect(result.results).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.totalResults).toBe(0);
  });

  it("28. falls back to input.offset when the response omits index", async () => {
    mockFetch.mockResolvedValueOnce(makeOk({ results: 5, entries: [] }));
    const result = await fulltextSearchTool({ keywords: "Flynn", offset: 20 });
    expect(result.offset).toBe(20);
  });

  it("29. uses the response index over input.offset when present", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({ results: 5, index: 10, entries: [] })
    );
    const result = await fulltextSearchTool({ keywords: "Flynn", offset: 20 });
    expect(result.offset).toBe(10);
  });
});

describe("fulltextSearchTool facets", () => {
  function facetBody(): FSFulltextResponse {
    return {
      results: 1,
      index: 0,
      entries: [],
      facets: [
        {
          count: 3,
          displayName: "Collection",
          facets: [
            { count: 10, displayName: "Ireland Wills", params: "f.collectionId=111" },
            { count: 5, displayName: "" }, // no displayName -> filtered out
            { count: 2 }, // no displayName -> filtered out
          ],
        },
        {
          count: 0,
          displayName: "Empty Group",
          facets: [], // empty nested -> whole group filtered out
        },
        {
          count: 1,
          facets: [{ count: 1, displayName: "x" }], // group has no displayName -> filtered out
        },
      ],
    };
  }

  it("30. shapes facets, filtering groups and items without a displayName", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(facetBody()));
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      includeFacets: true,
    });
    expect(result.facets).toHaveLength(1);
    const group = result.facets![0];
    expect(group.name).toBe("Collection");
    expect(group.count).toBe(3);
    expect(group.items).toEqual([
      { name: "Ireland Wills", count: 10, filterParam: "f.collectionId=111" },
    ]);
  });

  it("31. defaults a missing item params to an empty filterParam", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({
        results: 1,
        entries: [],
        facets: [
          { count: 1, displayName: "Year", facets: [{ count: 1, displayName: "1849" }] },
        ],
      })
    );
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      includeFacets: true,
    });
    expect(result.facets![0].items[0].filterParam).toBe("");
  });

  it("32. caps facet items to 20", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      count: i,
      displayName: `c${i}`,
    }));
    mockFetch.mockResolvedValueOnce(
      makeOk({
        results: 1,
        entries: [],
        facets: [{ count: 25, displayName: "Place", facets: items }],
      })
    );
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      includeFacets: true,
    });
    expect(result.facets![0].items).toHaveLength(20);
  });

  it("33. omits facets entirely when includeFacets is not set", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(facetBody()));
    const result = await fulltextSearchTool({ keywords: "Flynn" });
    expect(result.facets).toBeUndefined();
  });
});

describe("fulltextSearchTool result staging", () => {
  it("34. attaches the staged handle when projectPath is supplied", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({ results: 1, index: 0, entries: [flynnEntry()] })
    );
    mockedStage.mockResolvedValueOnce({
      resultsRef: "results/abc123.json",
      returnedCount: 1,
    });
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      projectPath: "/tmp/project",
    });
    expect(mockedStage).toHaveBeenCalledTimes(1);
    expect(mockedStage.mock.calls[0][0]).toMatchObject({
      projectPath: "/tmp/project",
      tool: "fulltext_search",
    });
    expect(result.staged).toEqual({
      resultsRef: "results/abc123.json",
      returnedCount: 1,
    });
    expect(result.stagingError).toBeUndefined();
  });

  it("35. never fails the search when staging throws", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({ results: 1, index: 0, entries: [flynnEntry()] })
    );
    mockedStage.mockRejectedValueOnce(new Error("disk full"));
    const result = await fulltextSearchTool({
      keywords: "Flynn",
      projectPath: "/tmp/project",
    });
    expect(result.staged).toBeNull();
    expect(result.stagingError).toBe("disk full");
    expect(result.results).toHaveLength(1); // search result is intact
  });

  it("36. does not stage when projectPath is omitted", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOk({ results: 1, index: 0, entries: [flynnEntry()] })
    );
    const result = await fulltextSearchTool({ keywords: "Flynn" });
    expect(mockedStage).not.toHaveBeenCalled();
    expect(result.staged).toBeUndefined();
  });
});

describe("fulltextSearchTool request headers", () => {
  it("37. sends Bearer auth, JSON Accept, and the browser User-Agent", async () => {
    mockFetch.mockResolvedValueOnce(makeOk(emptyBody()));
    await fulltextSearchTool({ keywords: "Flynn" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers.Accept).toBe("application/json");
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });
});
