import { describe, it, expect, vi, beforeEach } from "vitest";
import { externalLinksSearchTool } from "../../src/tools/external-links-search.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
}));

// The staging util is exercised by tests/utils/results-staging.test.ts; here we
// only assert the tool calls it correctly and shapes the inline copy around it.
vi.mock("../../src/utils/results-staging.js", () => ({
  stageSearchResults: vi.fn(),
}));
const mockedStage = vi.mocked(stageSearchResults);

// Runs before every test (in addition to the per-describe fetch resets);
// default the resolver to a successful placeId so existing cases reach fetch.
beforeEach(() => {
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue("1927089");
  mockedStage.mockReset();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function brokenJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  } as unknown as Response;
}

function singlePage(collections: unknown[], totalResults?: number) {
  return jsonResponse({
    count: collections.length,
    offset: 0,
    totalResults: totalResults ?? collections.length,
    collections,
  });
}

function pageAt(collections: unknown[], offset: number, totalResults: number) {
  return jsonResponse({
    count: collections.length,
    offset,
    totalResults,
    collections,
  });
}

describe("externalLinksSearchTool — happy path", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns matching collections with url + linkText only", async () => {
    const collections = [
      {
        url: "https://example.com/census-1940",
        linkText: "1940 Census",
        place: "France",
        startYear: "1940",
        endYear: "1940",
        recordTypeId: "3",
        cost: "free",
      },
      {
        url: "https://example.com/marriages-1700",
        linkText: "1700 Marriages",
        place: "France",
        startYear: "1700",
        endYear: "1700",
      },
    ];
    mockFetch.mockResolvedValueOnce(singlePage(collections));

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(result.query).toEqual({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });
    expect(result.totalForPlace).toBe(2);
    expect(result.results).toEqual([
      { url: "https://example.com/census-1940", linkText: "1940 Census" },
    ]);
  });

  it("includes collections with empty start/end years (permissive)", async () => {
    const collections = [
      {
        url: "https://example.com/wiki-undated",
        linkText: "France Genealogy Resources List",
        place: "France",
        startYear: "",
        endYear: "",
      },
      {
        url: "https://example.com/out-of-range",
        linkText: "1700 Marriages",
        place: "France",
        startYear: "1700",
        endYear: "1700",
      },
    ];
    mockFetch.mockResolvedValueOnce(singlePage(collections));

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.url).toBe("https://example.com/wiki-undated");
  });

  it("returns all dated and undated resources when no years are given", async () => {
    const collections = [
      {
        url: "https://example.com/wiki-undated",
        linkText: "France Genealogy Resources List",
        place: "France",
        startYear: "",
        endYear: "",
      },
      {
        url: "https://example.com/marriages-1700",
        linkText: "1700 Marriages",
        place: "France",
        startYear: "1700",
        endYear: "1700",
      },
      {
        url: "https://example.com/census-1940",
        linkText: "1940 Census",
        place: "France",
        startYear: "1940",
        endYear: "1940",
      },
    ];
    mockFetch.mockResolvedValueOnce(singlePage(collections));

    const result = await externalLinksSearchTool({ standardPlace: "France" });

    expect(result.query).toEqual({ standardPlace: "France" });
    expect(result.totalForPlace).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  it("reports totalForPlace independent of the year filter", async () => {
    // 3 resources for the place; only the undated one survives the 1880–1950
    // window → results: 1, totalForPlace: 3.
    const collections = [
      { url: "https://example.com/undated", linkText: "Undated", place: "France", startYear: "", endYear: "" },
      { url: "https://example.com/1700", linkText: "1700", place: "France", startYear: "1700", endYear: "1700" },
      { url: "https://example.com/1600", linkText: "1600", place: "France", startYear: "1600", endYear: "1600" },
    ];
    mockFetch.mockResolvedValueOnce(singlePage(collections));

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(result.totalForPlace).toBe(3);
    expect(result.results).toHaveLength(1);
  });
});

describe("externalLinksSearchTool — fetches the full set", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches every page until totalForPlace is exhausted", async () => {
    const makePage = (offset: number, size: number) =>
      Array.from({ length: size }, (_, i) => ({
        url: `https://example.com/c${offset + i}`,
        linkText: `Collection ${offset + i}`,
        place: "France",
        startYear: "1900",
        endYear: "1900",
      }));

    mockFetch
      .mockResolvedValueOnce(pageAt(makePage(0, 100), 0, 250))
      .mockResolvedValueOnce(pageAt(makePage(100, 100), 100, 250))
      .mockResolvedValueOnce(pageAt(makePage(200, 50), 200, 250));

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.totalForPlace).toBe(250);
    expect(result.results).toHaveLength(250);
    expect(result.results[0]?.url).toBe("https://example.com/c0");
    expect(result.results.at(-1)?.url).toBe("https://example.com/c249");
  });

  it("stops looping when an empty page is returned (defensive)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ count: 0, offset: 0, totalResults: 999, collections: [] })
    );

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(0);
  });

  it("returns empty results cleanly for a place with no collections", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ count: 0, offset: 0, totalResults: 0, collections: [] })
    );

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(result.totalForPlace).toBe(0);
    expect(result.results).toEqual([]);
  });
});

describe("externalLinksSearchTool — error handling", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it.each([
    { label: "403", mock: () => jsonResponse({}, 403), pattern: /Wait 60 seconds and retry once/i },
    { label: "429", mock: () => jsonResponse({}, 429), pattern: /Wait 60 seconds and retry once/i },
    { label: "5xx (503)", mock: () => jsonResponse({}, 503), pattern: /retry once before giving up/i },
    { label: "malformed JSON", mock: () => brokenJsonResponse(200), pattern: /not valid JSON/i },
  ])("throws an instructional error on $label", async ({ mock, pattern }) => {
    mockFetch.mockResolvedValueOnce(mock());

    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(pattern);
  });
});

describe("externalLinksSearchTool — handler-level guards", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects endYear < startYear without hitting the network", async () => {
    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1950, endYear: 1880 })
    ).rejects.toThrow(/endYear must be greater than or equal to startYear/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });

  it("accepts endYear === startYear (single-year query)", async () => {
    mockFetch.mockResolvedValueOnce(singlePage([]));

    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1900,
      endYear: 1900,
    });

    expect(result.results).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects empty standardPlace without hitting the network", async () => {
    await expect(
      externalLinksSearchTool({ standardPlace: "", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/standardPlace is required/i);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });

  it("rejects an unresolvable standardPlace without hitting the network", async () => {
    mockStandardPlaceToPlaceId.mockResolvedValueOnce(null);
    await expect(
      externalLinksSearchTool({ standardPlace: "Nowhere", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/Could not resolve "Nowhere"/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("externalLinksSearchTool — User-Agent contract", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockFetch.mockResolvedValueOnce(singlePage([]));

    await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1880,
      endYear: 1950,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });
});

describe("externalLinksSearchTool — staging, host filter, and inline cap", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const twoHostCollections = [
    { url: "https://www.ancestry.com/search/collections/1/", linkText: "PA Wills" },
    { url: "https://www.findagrave.com/cemetery/22", linkText: "PA Graves" },
    { url: "https://www.ancestry.com/search/collections/2/", linkText: "PA Census" },
  ];

  it("stages the full pre-filter set with tool 'external_links' when projectPath is supplied", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    mockedStage.mockResolvedValueOnce({
      resultsRef: "results/.staging/abc.json",
      returnedCount: 3,
    });

    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      projectPath: "/tmp/project",
    });

    expect(mockedStage).toHaveBeenCalledTimes(1);
    const stageArg = mockedStage.mock.calls[0][0];
    expect(stageArg).toMatchObject({
      projectPath: "/tmp/project",
      tool: "external_links",
    });
    // The staged payload is the FULL set (all hosts), before any host filter.
    expect(stageArg.response.results).toHaveLength(3);
    expect(result.staged).toEqual({
      resultsRef: "results/.staging/abc.json",
      returnedCount: 3,
    });
    expect(result.stagingError).toBeUndefined();
  });

  it("host filter narrows the inline results while the full set is still staged", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    mockedStage.mockResolvedValueOnce({
      resultsRef: "results/.staging/abc.json",
      returnedCount: 3,
    });

    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      host: "ancestry.com",
      projectPath: "/tmp/project",
    });

    // Inline: only the two ancestry links, and `returned` reflects that.
    expect(result.results).toHaveLength(2);
    expect(result.returned).toBe(2);
    expect(result.results.every((r) => r.url.includes("ancestry.com"))).toBe(true);
    // Staged: still the full 3-link set (host filter never touches the sidecar).
    expect(mockedStage.mock.calls[0][0].response.results).toHaveLength(3);
  });

  it("applies the host filter even when not staged (explicit query narrowing)", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      host: "findagrave.com",
    });
    expect(mockedStage).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.url).toContain("findagrave.com");
    expect(result.staged).toBeUndefined();
  });

  it("caps the inline set to 50 only when staged; returns the full set un-staged", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      url: `https://example.com/c${i}`,
      linkText: `Collection ${i}`,
    }));

    // Un-staged: full set comes back (back-compat; nothing retained to recover).
    mockFetch.mockResolvedValueOnce(singlePage(many));
    const unstaged = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
    });
    expect(unstaged.results).toHaveLength(120);
    expect(unstaged.returned).toBe(120);

    // Staged: inline capped at 50, full 120 staged to disk.
    mockFetch.mockResolvedValueOnce(singlePage(many));
    mockedStage.mockResolvedValueOnce({
      resultsRef: "results/.staging/def.json",
      returnedCount: 120,
    });
    const staged = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      projectPath: "/tmp/project",
    });
    expect(staged.results).toHaveLength(50);
    expect(staged.returned).toBe(50);
    expect(mockedStage.mock.calls[0][0].response.results).toHaveLength(120);
  });

  it("never fails the search when staging throws", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    mockedStage.mockRejectedValueOnce(new Error("disk full"));

    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      projectPath: "/tmp/project",
    });

    expect(result.staged).toBeNull();
    expect(result.stagingError).toBe("disk full");
    expect(result.results).toHaveLength(3); // search result intact
  });

  it("does not stage when projectPath is omitted", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
    });
    expect(mockedStage).not.toHaveBeenCalled();
    expect(result.staged).toBeUndefined();
    expect(result.returned).toBe(3);
  });
});
