import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  placeCollectionsTool,
  filterByQuery,
  fetchAllCollections,
  clearCollectionsCache,
  htmlToMarkdown,
  convertHtmlToMarkdown,
} from "../../src/tools/place-collections.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  FSCollectionEntry,
  FSCollectionsResponse,
  FSCollectionDetailResponse,
  CollectionDetailResult,
} from "../../src/types/collection.js";

const mockedGetValidToken = vi.mocked(getValidToken);

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

describe("placeCollectionsTool with query", () => {
  it("returns collections matching a place name query", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await placeCollectionsTool({ query: "Alabama" });

    expect(result.query).toBe("Alabama");
    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("1234");
  });

  it("query matching is case-insensitive", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await placeCollectionsTool({ query: "alabama" });

    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("1234");
  });

  it("returns empty array when query matches no titles", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await placeCollectionsTool({ query: "Narnia" });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("query matches anywhere in the title", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const result = await placeCollectionsTool({ query: "Census" });

    expect(result.matchingCollections).toBe(1);
    expect(result.collections[0].id).toBe("9999");
  });
});

describe("placeCollectionsTool error handling", () => {
  it("throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(placeCollectionsTool({ query: "Alabama" })).rejects.toThrow(
      "User is not logged in to FamilySearch. Call the login tool to authenticate."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-OK API response", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(placeCollectionsTool({ query: "Alabama" })).rejects.toThrow(
      "FamilySearch collections API error: 500 Internal Server Error"
    );
  });

  it("handles malformed API response gracefully", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const result = await placeCollectionsTool({ query: "Alabama" });

    expect(result.matchingCollections).toBe(0);
    expect(result.collections).toEqual([]);
  });

  it("throws when neither id nor query is provided", async () => {
    await expect(placeCollectionsTool({})).rejects.toThrow(/Provide one of/);
  });
});

describe("placeCollectionsTool field mapping", () => {
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

    const result = await placeCollectionsTool({ query: "Alabama" });

    expect(result.collections[0]).toEqual({
      id: "1234",
      title: "Alabama, County Marriages, 1809-1950",
      dateRange: "1809-1950",
      recordCount: 524000,
      personCount: 1048000,
      imageCount: 120000,
      url: "https://www.familysearch.org/search/collection/1234",
    });
  });
});

describe("placeCollectionsTool — User-Agent contract", () => {
  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockedGetValidToken.mockResolvedValueOnce("test-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    await placeCollectionsTool({ query: "Alabama" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });
});

// ------------------------------------------------------------------
// Detail-mode tests (id parameter)
// ------------------------------------------------------------------

// Fixture mirroring the real /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true
// response shape captured by dev/probe-collection-detail.ts.
function makeDetailResponse(): FSCollectionDetailResponse {
  return {
    description: "#1743384",
    sourceDescriptions: [
      {
        id: "1743384",
        about: "https://www.familysearch.org/platform/records/collections/1743384",
        modified: "2025-04-22T14:16:50.905+00:00", // ISO string on this endpoint
        descriptions: [
          { lang: "en_US", value: "This collection of marriage records includes images..." },
        ],
        citations: [
          {
            value:
              '"Alabama County Marriages, 1711-1992." Database with images. <i>FamilySearch</i>. https://FamilySearch.org : 29 December 2025. County Probate Courts, Alabama.',
          },
        ],
        titles: [{ lang: "en_US", value: "Alabama County Marriages, 1711-1992" }],
        rights: ["http://familysearch.org/records/permissionGroup/FamilySearch"],
        coverage: [
          {
            spatial: { original: "United States, Alabama", description: "#place_351" },
            temporal: { original: "1809/1950", formal: "+1809/+1950" },
            recordType: "http://gedcomx.org/Vital",
          },
          {
            spatial: { original: "Alabama, United States", description: "#place_351" },
            temporal: { original: "1711/1992", formal: "+1711/+1992" },
            recordType: "http://gedcomx.org/Marriage",
          },
        ],
      },
      // Container parent — kept for resolveCollectionSourceDescription tests.
      {
        id: "1743384_c",
        about: "https://www.familysearch.org/platform/records/collections",
      },
    ],
    collections: [
      {
        id: "1743384",
        title: "Alabama County Marriages, 1711-1992",
        content: [
          { count: 6252135, resourceType: "http://gedcomx.org/Record", completeness: 0.64 },
          { count: 22361722, resourceType: "http://gedcomx.org/Person", completeness: 0.64 },
          { count: 1231203, resourceType: "http://gedcomx.org/DigitalArtifact#FamilySearch" },
        ],
        // searchMetadata is INSIDE collections[0] on the new endpoint —
        // no dual-fetch with list endpoint needed.
        searchMetadata: [
          {
            imageCount: 1231203,
            recordCount: 6049744,
            lastUpdated: 1745331410905,
            startYear: 1711,
            endYear: 1992,
            placeIds: [33],
          },
        ],
      },
    ],
    documents: [
      {
        id: "1743384",
        text:
          '<h1>Alabama County Marriages, 1711-1992</h1>' +
          '<p>Source: <a href="https://www.familysearch.org/en/wiki/Alabama">Wiki link</a></p>' +
          '<h2>What is in This Collection?</h2>' +
          '<p>Marriage records from <i>Alabama</i> counties.</p>',
        textType: "html",
        extracted: false,
      },
    ],
  };
}

// Helper: route mock fetches by URL. Detail endpoint is now
// /service/search/hr/v2/collections/{id}?embedWikiAboutCollection=true.
// List endpoint shares the same /service/search/hr/v2/collections path but
// uses ?count=...&facets=OFF — discriminate on the wiki flag.
function routeFetchMocks(opts: {
  listResponse?: FSCollectionsResponse;
  detailResponse?: FSCollectionDetailResponse;
  detailStatus?: number;
  detailMalformed?: boolean;
}) {
  mockFetch.mockImplementation((url: string) => {
    const isDetail = url.includes("embedWikiAboutCollection=true");
    if (isDetail) {
      if (opts.detailStatus && opts.detailStatus !== 200) {
        return Promise.resolve({
          ok: false,
          status: opts.detailStatus,
          statusText: opts.detailStatus === 404 ? "Not Found" : "Error",
          text: async () => "",
        });
      }
      if (opts.detailMalformed) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("invalid JSON");
          },
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => opts.detailResponse ?? makeDetailResponse(),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => opts.listResponse ?? mockApiResponse,
    });
  });
}

describe("htmlToMarkdown", () => {
  it("converts <i> to markdown emphasis", () => {
    expect(htmlToMarkdown("<i>FamilySearch</i>")).toBe("*FamilySearch*");
  });

  it("converts headings, paragraphs, and links", () => {
    const md = htmlToMarkdown(
      '<h1>Title</h1><p>Text with <a href="https://example.com">a link</a>.</p>'
    );
    expect(md).toContain("# Title");
    expect(md).toContain("[a link](https://example.com)");
  });

  it("returns null for null/undefined/empty inputs", () => {
    expect(htmlToMarkdown(null)).toBeNull();
    expect(htmlToMarkdown(undefined)).toBeNull();
    expect(htmlToMarkdown("")).toBeNull();
  });

  it("returns null when conversion yields only whitespace", () => {
    expect(htmlToMarkdown("<div></div>")).toBeNull();
  });

  it("preserves plain text", () => {
    expect(htmlToMarkdown("Just text, no markup.")).toBe("Just text, no markup.");
  });
});

describe("htmlToMarkdown — wiki content quirks", () => {
  it("drops <head>, <style>, and <script> blocks entirely", () => {
    const html =
      "<!DOCTYPE html><html><head><title>Drop</title><style>body{x:1}</style></head>" +
      "<body><h1>Keep</h1><script>alert(1)</script><p>Text</p></body></html>";
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("Drop");
    expect(md).not.toContain("body{x:1}");
    expect(md).not.toContain("alert(1)");
    expect(md).toContain("# Keep");
    expect(md).toContain("Text");
  });

  it("drops elements with style=\"display: none\" (MediaWiki template placeholders)", () => {
    const html =
      '<div><p>Visible</p>' +
      '<div style="display: none">{{{CID2}}}</div>' +
      '<div style="display:none">{{{CID3}}}</div>' +
      '<p>Also visible</p></div>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("Visible");
    expect(md).toContain("Also visible");
    expect(md).not.toContain("CID2");
    expect(md).not.toContain("CID3");
  });
});

describe("convertHtmlToMarkdown", () => {
  it("does NOT touch citations[*].value (citations stay as HTML)", () => {
    const original = "Title. <i>FamilySearch</i>. http://...";
    const out = convertHtmlToMarkdown({
      sourceDescriptions: [{ id: "x", citations: [{ value: original }] }],
    });
    expect(out.sourceDescriptions?.[0].citations?.[0].value).toBe(original);
  });

  it("converts documents[*].text and flips textType from html to markdown", () => {
    const out = convertHtmlToMarkdown({
      documents: [
        { id: "x", textType: "html", text: "<h1>Title</h1><p>Body</p>" },
      ],
    });
    expect(out.documents?.[0].text).toContain("# Title");
    expect(out.documents?.[0].text).not.toContain("<h1>");
    expect(out.documents?.[0].textType).toBe("markdown");
  });

  it("leaves documents with textType !== 'html' untouched", () => {
    const out = convertHtmlToMarkdown({
      documents: [{ id: "x", textType: "plain", text: "<not html>" }],
    });
    expect(out.documents?.[0].text).toBe("<not html>");
    expect(out.documents?.[0].textType).toBe("plain");
  });

  it("preserves all other top-level fields unchanged", () => {
    const input = {
      description: "#1473181",
      id: "1473181",
      collections: [
        {
          id: "1473181",
          title: "Foo",
          content: [{ count: 1, resourceType: "x" }],
          searchMetadata: [{ placeIds: [1], imageCount: 2 }],
        },
      ],
      sourceDescriptions: [{ id: "1473181", titles: [{ value: "Foo" }] }],
    };
    const out = convertHtmlToMarkdown(input);
    expect(out.description).toBe("#1473181");
    expect(out.id).toBe("1473181");
    expect(out.collections).toEqual(input.collections);
    expect(out.sourceDescriptions?.[0].titles).toEqual(input.sourceDescriptions[0].titles);
  });
});

describe("placeCollectionsTool detail mode (pass-through)", () => {
  it("returns the FS response shape, not a wrapped { collection: ... }", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({ id: "1743384" })) as CollectionDetailResult;

    // Top-level keys come from the FS response, no { collection: ... } wrapper.
    expect("collection" in result).toBe(false);
    expect(result.sourceDescriptions).toBeDefined();
    expect(result.documents).toBeDefined();
    expect(result.collections).toBeDefined();
  });

  it("leaves citation HTML untouched (stays as raw HTML, not markdown)", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({ id: "1743384" })) as CollectionDetailResult;
    const citation = result.sourceDescriptions?.[0].citations?.[0].value ?? "";

    // Per stakeholder direction, only documents[*].text gets converted.
    expect(citation).toContain("<i>FamilySearch</i>");
    expect(citation).not.toContain("*FamilySearch*");
  });

  it("converts documents[0].text to markdown and flips textType to 'markdown'", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({ id: "1743384" })) as CollectionDetailResult;
    const doc = result.documents?.[0];

    expect(doc?.text).toContain("# Alabama County Marriages");
    expect(doc?.text).toContain("## What is in This Collection?");
    expect(doc?.text).not.toContain("<h1>");
    expect(doc?.textType).toBe("markdown");
  });

  it("preserves container-parent sourceDescriptions (no stripping)", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({ id: "1743384" })) as CollectionDetailResult;
    const ids = result.sourceDescriptions?.map((sd) => sd.id);

    // Both the primary SD and the container parent are passed through.
    expect(ids).toContain("1743384");
    expect(ids).toContain("1743384_c");
  });

  it("preserves searchMetadata inside collections[0]", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({ id: "1743384" })) as CollectionDetailResult;
    const meta = result.collections?.[0].searchMetadata?.[0];

    expect(meta?.placeIds).toEqual([33]);
    expect(meta?.imageCount).toBe(1231203);
    expect(meta?.lastUpdated).toBe(1745331410905);
    expect(meta?.startYear).toBe(1711);
    expect(meta?.endYear).toBe(1992);
  });

  it("does NOT call the list endpoint in detail mode", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    await placeCollectionsTool({ id: "1743384" });

    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("embedWikiAboutCollection=true");
  });

  it("throws a friendly error on 404 from the detail endpoint", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({ detailStatus: 404 });

    await expect(placeCollectionsTool({ id: "9999999" })).rejects.toThrow(
      /No FamilySearch collection found with id "9999999"/
    );
  });

  it("throws a generic API error on non-404 detail failure", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({ detailStatus: 500 });

    await expect(placeCollectionsTool({ id: "1743384" })).rejects.toThrow(
      /FamilySearch collection detail API error: 500/
    );
  });

  it("throws auth error when not logged in", async () => {
    mockedGetValidToken.mockRejectedValue(
      new Error(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );

    await expect(placeCollectionsTool({ id: "1743384" })).rejects.toThrow(
      /User is not logged in/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on malformed detail response", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({ detailMalformed: true });

    await expect(placeCollectionsTool({ id: "1743384" })).rejects.toThrow(
      /malformed response/
    );
  });

  it("id wins when both id and query are passed", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    routeFetchMocks({});

    const result = (await placeCollectionsTool({
      id: "1743384",
      query: "ignored",
    })) as CollectionDetailResult;

    // Detail-mode shape (sourceDescriptions present), not list-mode (collections array of summaries).
    expect(result.sourceDescriptions).toBeDefined();
  });
});
