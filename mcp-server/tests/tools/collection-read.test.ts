import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  collectionReadTool,
  htmlToMarkdown,
  convertHtmlToMarkdown,
} from "../../src/tools/collection-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type {
  FSCollectionDetailResponse,
  CollectionDetailResult,
} from "../../src/types/collection.js";

const mockedGetValidToken = vi.mocked(getValidToken);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

// Helper: mock the detail fetch (the only call collection_read makes).
function mockDetailFetch(opts: {
  detailResponse?: FSCollectionDetailResponse;
  detailStatus?: number;
  detailMalformed?: boolean;
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    expect(url).toContain("embedWikiAboutCollection=true");
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

describe("collectionReadTool (pass-through)", () => {
  it("returns the FS response shape, not a wrapped { collection: ... }", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    const result = (await collectionReadTool({ id: "1743384" })) as CollectionDetailResult;

    expect("collection" in result).toBe(false);
    expect(result.sourceDescriptions).toBeDefined();
    expect(result.documents).toBeDefined();
    expect(result.collections).toBeDefined();
  });

  it("leaves citation HTML untouched (stays as raw HTML, not markdown)", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    const result = (await collectionReadTool({ id: "1743384" })) as CollectionDetailResult;
    const citation = result.sourceDescriptions?.[0].citations?.[0].value ?? "";

    expect(citation).toContain("<i>FamilySearch</i>");
    expect(citation).not.toContain("*FamilySearch*");
  });

  it("converts documents[0].text to markdown and flips textType to 'markdown'", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    const result = (await collectionReadTool({ id: "1743384" })) as CollectionDetailResult;
    const doc = result.documents?.[0];

    expect(doc?.text).toContain("# Alabama County Marriages");
    expect(doc?.text).toContain("## What is in This Collection?");
    expect(doc?.text).not.toContain("<h1>");
    expect(doc?.textType).toBe("markdown");
  });

  it("preserves container-parent sourceDescriptions (no stripping)", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    const result = (await collectionReadTool({ id: "1743384" })) as CollectionDetailResult;
    const ids = result.sourceDescriptions?.map((sd) => sd.id);

    expect(ids).toContain("1743384");
    expect(ids).toContain("1743384_c");
  });

  it("preserves searchMetadata inside collections[0]", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    const result = (await collectionReadTool({ id: "1743384" })) as CollectionDetailResult;
    const meta = result.collections?.[0].searchMetadata?.[0];

    expect(meta?.placeIds).toEqual([33]);
    expect(meta?.imageCount).toBe(1231203);
    expect(meta?.lastUpdated).toBe(1745331410905);
    expect(meta?.startYear).toBe(1711);
    expect(meta?.endYear).toBe(1992);
  });

  it("makes exactly one fetch (the detail endpoint)", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch();

    await collectionReadTool({ id: "1743384" });

    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("embedWikiAboutCollection=true");
  });

  it("throws a friendly error on 404, pointing at collections_search", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch({ detailStatus: 404 });

    await expect(collectionReadTool({ id: "9999999" })).rejects.toThrow(
      /No FamilySearch collection found with id "9999999".*collections_search/s
    );
  });

  it("throws a generic API error on non-404 detail failure", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch({ detailStatus: 500 });

    await expect(collectionReadTool({ id: "1743384" })).rejects.toThrow(
      /FamilySearch collection detail API error: 500/
    );
  });

  it("throws auth error when not logged in", async () => {
    mockedGetValidToken.mockRejectedValue(
      new Error(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );

    await expect(collectionReadTool({ id: "1743384" })).rejects.toThrow(
      /User is not logged in/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on malformed detail response", async () => {
    mockedGetValidToken.mockResolvedValue("test-token");
    mockDetailFetch({ detailMalformed: true });

    await expect(collectionReadTool({ id: "1743384" })).rejects.toThrow(
      /malformed response/
    );
  });

  it("throws when id is missing", async () => {
    await expect(collectionReadTool({ id: "" })).rejects.toThrow(
      /collection_read requires an id/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
