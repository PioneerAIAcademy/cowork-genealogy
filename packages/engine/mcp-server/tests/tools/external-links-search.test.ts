import { describe, it, expect, vi, beforeEach } from "vitest";
import { externalLinksSearchTool } from "../../src/tools/external-links-search.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockResolveStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    resolveStandardPlaceToPlaceId: mockResolveStandardPlaceToPlaceId,
    ambiguousPlaceError: real.ambiguousPlaceError,
  };
});

// Runs before every test (in addition to the per-describe fetch resets);
// default the resolver to a successful placeId so existing cases reach fetch.
beforeEach(() => {
  mockResolveStandardPlaceToPlaceId.mockReset();
  mockResolveStandardPlaceToPlaceId.mockResolvedValue({ kind: "resolved", placeId: "1927089" });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Status ${status}`,
    json: async () => body,
    headers: new Headers(),
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

  it("returns matching collections with url, linkText and the collection's years", async () => {
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
      {
        url: "https://example.com/census-1940",
        linkText: "1940 Census",
        startYear: 1940,
        endYear: 1940,
      },
    ]);
  });

  it("carries no years on an undated collection", async () => {
    mockFetch.mockResolvedValueOnce(
      singlePage([
        { url: "https://example.com/catalog", linkText: "Library Catalog", place: "France" },
      ])
    );

    const result = await externalLinksSearchTool({ standardPlace: "France" });

    expect(result.results).toEqual([
      { url: "https://example.com/catalog", linkText: "Library Catalog" },
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

  it("fetches the whole list in ONE request (offset=0, count=1000) — never pages", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example.com/c${i}`,
      linkText: `Collection ${i}`,
      place: "France",
    }));
    mockFetch.mockResolvedValueOnce(singlePage(rows));

    const result = await externalLinksSearchTool({ standardPlace: "France" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(mockFetch.mock.calls[0][0]));
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("count")).toBe("1000");
    expect(result.totalForPlace).toBe(250);
    expect(result.results).toHaveLength(200);
    expect(result.inlineCapped).toBe(true);
  });

  it("refuses a response with no totalResults — completeness cannot be told", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ collections: [{ url: "https://example.com/a" }] }));
    await expect(externalLinksSearchTool({ standardPlace: "France" })).rejects.toThrow(/no totalResults/);
  });

  it("refuses a partial list (totalResults above the rows returned)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalResults: 999, collections: [{ url: "https://example.com/a" }] }),
    );
    await expect(externalLinksSearchTool({ standardPlace: "France" })).rejects.toThrow(/1 of the 999/);
  });

  it("refuses a place over the 1,000-row cap and names a smaller scope", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ totalResults: 1998, collections: [{ url: "https://example.com/a" }] }),
    );
    await expect(externalLinksSearchTool({ standardPlace: "United States" })).rejects.toThrow(
      /1998 curated links.*state or county, not a whole country/s,
    );
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

  it("throws on 403 with WAF message", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/403 Forbidden/i);
  });

  it("recovers from a transient 429 and returns the result", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(singlePage([
        { url: "https://example.com/a", linkText: "Link A", place: "France" },
      ]));
    const result = await externalLinksSearchTool({
      standardPlace: "France",
      startYear: 1900,
      endYear: 1950,
    });
    expect(result.totalForPlace).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on 429 with rate-limit message after retry exhaustion", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 429));
    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/Wait 60 seconds/i);
  });

  it("throws on 5xx (503) after retry exhaustion", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 503));
    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/503/);
  });

  it("throws on malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce(brokenJsonResponse(200));
    await expect(
      externalLinksSearchTool({ standardPlace: "France", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/not valid JSON/i);
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
    expect(mockResolveStandardPlaceToPlaceId).not.toHaveBeenCalled();
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
    expect(mockResolveStandardPlaceToPlaceId).not.toHaveBeenCalled();
  });

  it("rejects an unresolvable standardPlace without hitting the network", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({ kind: "unresolved" });
    await expect(
      externalLinksSearchTool({ standardPlace: "Nowhere", startYear: 1900, endYear: 1950 })
    ).rejects.toThrow(/Could not resolve "Nowhere"/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes a (Type)-suffixed standardPlace through verbatim and searches its placeId", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({ kind: "resolved", placeId: "3172" });
    mockFetch.mockResolvedValueOnce(singlePage([]));
    await externalLinksSearchTool({
      standardPlace: "Baltimore, Maryland, United States (Independent City)",
    });
    expect(mockResolveStandardPlaceToPlaceId).toHaveBeenCalledWith(
      "Baltimore, Maryland, United States (Independent City)"
    );
    expect(String(mockFetch.mock.calls[0][0])).toContain("q.placeId=3172");
  });

  it("names the candidates when the standard place is ambiguous", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: [
        "Baltimore, Maryland, United States (Independent City)",
        "Baltimore, Maryland, United States (County)",
      ],
    });
    await expect(
      externalLinksSearchTool({ standardPlace: "Baltimore, Maryland, United States" })
    ).rejects.toThrow(
      /matches more than one place:.*Independent City.*County.*including the parenthesised type/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not reuse the unresolvable wording for an ambiguous place", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: ["A (County)", "B (City)"],
    });
    const err = await externalLinksSearchTool({
      standardPlace: "Somewhere",
    }).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err, "an ambiguous place must still throw").toBeInstanceOf(Error);
    expect(err?.message).not.toMatch(/Could not resolve/);
    expect(err?.message).toContain("A (County)");
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

describe("externalLinksSearchTool — host filter and inline cap", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const twoHostCollections = [
    { url: "https://www.ancestry.com/search/collections/1/", linkText: "PA Wills" },
    { url: "https://www.findagrave.com/cemetery/22", linkText: "PA Graves" },
    { url: "https://www.ancestry.com/search/collections/2/", linkText: "PA Census" },
  ];

  it("host filter narrows the inline results to the target site", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    const result = await externalLinksSearchTool({
      standardPlace: "Pennsylvania, United States",
      host: "ancestry.com",
    });
    expect(result.results).toHaveLength(2);
    expect(result.returned).toBe(2);
    expect(result.results.every((r) => r.url.includes("ancestry.com"))).toBe(true);
  });

  it("caps the inline set at 200 on every call and says so", async () => {
    const many = Array.from({ length: 260 }, (_, i) => ({
      url: `https://example.com/c${String(i).padStart(3, "0")}`,
      linkText: `Collection ${i}`,
    }));
    mockFetch.mockResolvedValueOnce(singlePage(many));
    const result = await externalLinksSearchTool({ standardPlace: "Pennsylvania, United States" });
    expect(result.results).toHaveLength(200);
    expect(result.returned).toBe(200);
    expect(result.inlineCapped).toBe(true);
  });

  it("does not flag inlineCapped when everything fits", async () => {
    mockFetch.mockResolvedValueOnce(singlePage(twoHostCollections));
    const r = await externalLinksSearchTool({ standardPlace: "Pennsylvania, United States" });
    expect(r.inlineCapped).toBeUndefined();
  });
});
