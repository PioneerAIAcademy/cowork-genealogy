import { describe, it, expect, vi, beforeEach } from "vitest";
import { externalLinksSearchTool } from "../../src/tools/external-links-search.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
}));

// Runs before every test (in addition to the per-describe fetch resets);
// default the resolver to a successful placeId so existing cases reach fetch.
beforeEach(() => {
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue("1927089");
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
