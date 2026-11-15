import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockGetWikiApiUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", () => ({
  getWikiApiUrl: mockGetWikiApiUrl,
}));

import { countryTopicSlug, wikiReadTool, wikiReadSchema } from "../../src/tools/wiki-read.js";
import { WIKI_PAGE_MAX_CHARS } from "../../src/types/wikiPage.js";
import { CLI_SPILL_CHARS } from "../helpers/cli-spill.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";
import { SHAPES, escapedBody, headingPage, oneLinePage, walkParts } from "../helpers/wiki-pages.js";
import { ENGLAND_HEAD, ENGLAND_STRIPPED, LONG_PAGE, LONG_PAGE_STRIPPED } from "../helpers/wiki-sidebar-pages.js";

const API_BASE = "http://localhost:8000";
const TEST_URL = "https://www.familysearch.org/en/wiki/Portugal_Genealogy";

beforeEach(() => {
  mockFetch.mockReset();
  mockGetWikiApiUrl.mockReset();
  mockGetWikiApiUrl.mockResolvedValue(API_BASE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wikiReadTool", () => {
  it("GETs /page/{slug} and returns the page content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Portugal_Genealogy",
        content: "# Portugal Genealogy",
        source_url: "https://www.familysearch.org/en/wiki/Portugal_Genealogy",
      }),
    });

    const result = await wikiReadTool({ url: TEST_URL }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
    expect(result.url).toBe("https://www.familysearch.org/en/wiki/Portugal_Genealogy");
    expect(result.content).toBe("# Portugal Genealogy");
  });

  it("throws a descriptive error on 404", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "No wiki page found" }),
    });

    await expect(wikiReadTool({ url: TEST_URL }, LOCAL)).rejects.toThrow(
      /No wiki page found for "Portugal_Genealogy"/
    );
  });

  it("throws on non-2xx, non-404 response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error", headers: new Headers() });

    await expect(wikiReadTool({ url: TEST_URL }, LOCAL)).rejects.toThrow(
      "wiki-query-api error: 500"
    );
  });

  it("throws a friendly error when the server is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(wikiReadTool({ url: TEST_URL }, LOCAL)).rejects.toThrow(
      /Could not reach wiki-query-api/
    );
  });

  it("names the socket cause, not just \"fetch failed\"", async () => {
    mockFetch.mockRejectedValue(socketFetchFailure());

    const err = await wikiReadTool({ url: TEST_URL }, LOCAL).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Could not reach wiki-query-api.*ETIMEDOUT/s);
    expect((err as Error).message).toContain(API_BASE);
    expect((err as Error).message).not.toMatch(/Is the server running/);
  });

  it("throws when given a non-wiki URL (and never calls the server)", async () => {
    await expect(
      wikiReadTool({ url: "https://www.google.com/search?q=test" }, LOCAL)
    ).rejects.toThrow(/Not a valid FamilySearch wiki URL/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles URL-encoded slugs correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Manitoba,_Canada_Genealogy",
        content: "# Manitoba",
        source_url:
          "https://www.familysearch.org/en/wiki/Manitoba,_Canada_Genealogy",
      }),
    });
    const encodedUrl =
      "https://www.familysearch.org/en/wiki/Manitoba%2C_Canada_Genealogy";

    await wikiReadTool({ url: encodedUrl }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Manitoba,_Canada_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("extracts slug from URL with query params or fragments", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        title: "Portugal_Genealogy",
        content: "# Content",
        source_url: "https://www.familysearch.org/en/wiki/Portugal_Genealogy",
      }),
    });
    const urlWithParams =
      "https://www.familysearch.org/en/wiki/Portugal_Genealogy?section=2#top";

    await wikiReadTool({ url: urlWithParams }, LOCAL);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API_BASE}/page/Portugal_Genealogy`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("propagates the LLM-instruction error when wikiApiUrl is missing", async () => {
    mockGetWikiApiUrl.mockReset();
    mockGetWikiApiUrl.mockRejectedValueOnce(
      new Error("wiki-query-api MCP is not configured.")
    );

    await expect(wikiReadTool({ url: TEST_URL }, LOCAL)).rejects.toThrow(
      /wiki-query-api MCP is not configured/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── paging ───────────────────────────────────────────────────────────────────

/** The server answers every call with this page, as the real one does. */
function servePage(content: string | undefined): void {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ title: "Portugal_Genealogy", content, source_url: TEST_URL }),
  }));
}

const read = (offset?: number) =>
  wikiReadTool({ url: TEST_URL, ...(offset === undefined ? {} : { offset }) }, LOCAL);

describe.each(SHAPES)("wikiReadTool, a page of %s", (_label, make) => {
  const page = make();
  beforeEach(() => servePage(page));

  it("is a page that would have spilled: its whole answer is over the CLI limit", () => {
    expect(JSON.stringify({ url: TEST_URL, content: page }).length).toBeGreaterThan(CLI_SPILL_CHARS);
  });

  it("(a) every part serializes under the CLI spill line, with content inside the cap", async () => {
    const parts = await walkParts(read);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(JSON.stringify(part).length).toBeLessThan(CLI_SPILL_CHARS);
      expect(escapedBody(part.content)).toBeLessThanOrEqual(WIKI_PAGE_MAX_CHARS);
    }
  });

  it("(b) joining content across the nextOffset chain rebuilds the page exactly", async () => {
    const parts = await walkParts(read);
    expect(parts.map((p) => p.content).join("")).toBe(page);
    let at = 0;
    for (const part of parts) {
      expect(part.offset ?? 0).toBe(at);
      at += part.content.length;
    }
    expect(parts[0].totalChars).toBe(page.length);
  });

  it("(c) the chain ends: the last part says truncated: false and carries no nextOffset", async () => {
    const parts = await walkParts(read);
    const last = parts[parts.length - 1];
    expect(last.truncated).toBe(false);
    expect("nextOffset" in last).toBe(false);
    for (const part of parts.slice(0, -1)) {
      expect(part.truncated).toBe(true);
      expect(part.nextOffset).toBe((part.offset ?? 0) + part.content.length);
    }
  });

  it("fetches the page again for each part, from the same address", async () => {
    const parts = await walkParts(read);
    expect(mockFetch).toHaveBeenCalledTimes(parts.length);
    for (const call of mockFetch.mock.calls) expect(call[0]).toBe(`${API_BASE}/page/Portugal_Genealogy`);
  });
});

describe("wikiReadTool, where the cut falls", () => {
  it("cuts a county-style page at a heading", async () => {
    servePage(headingPage());
    const [first, second] = await walkParts(read);
    expect(first.content.endsWith("\n")).toBe(true);
    expect(second.content.startsWith("## Heading ")).toBe(true);
    // the cut moved back at most half a part: the part is still more than half full
    expect(first.content.length).toBeGreaterThan(WIKI_PAGE_MAX_CHARS / 2);
  });

  it("cuts a page that is one huge row in the middle of the row, as nothing better exists", async () => {
    servePage(oneLinePage());
    const [first, second] = await walkParts(read);
    expect(first.content.endsWith("\n")).toBe(false);
    expect(second.content.startsWith("#")).toBe(false);
    // no wasted room: the first part is as full as the escape bound allows
    expect(escapedBody(first.content)).toBeGreaterThan(WIKI_PAGE_MAX_CHARS - 10);
  });
});

describe("wikiReadTool, a page under the cap", () => {
  it("(d) returns exactly today's object for a 9,000-character page, with no extra keys", async () => {
    const head = "# Small page\n";
    const content = head + "x".repeat(9_000 - head.length);
    expect(content.length).toBe(9_000);
    servePage(content);
    const result = await read();
    expect(result).toStrictEqual({ url: TEST_URL, content });
    expect(Object.keys(result)).toEqual(["url", "content"]);
  });

  it("returns a page whose escaped body is exactly the cap whole, and pages one unit more", async () => {
    servePage("x".repeat(WIKI_PAGE_MAX_CHARS));
    expect(Object.keys(await read())).toEqual(["url", "content"]);
    servePage("x".repeat(WIKI_PAGE_MAX_CHARS + 1));
    const parts = await walkParts(read);
    expect(parts.map((p) => p.content.length)).toEqual([WIKI_PAGE_MAX_CHARS, 1]);
  });

  it("pages a page that is under the cap in length but over it once its line breaks are escaped", async () => {
    const content = "a\n".repeat(WIKI_PAGE_MAX_CHARS / 2); // 40,000 characters, 60,000 escaped
    expect(content.length).toBe(WIKI_PAGE_MAX_CHARS);
    servePage(content);
    const parts = await walkParts(read);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.content).join("")).toBe(content);
  });

  it("adds the paging fields, and only those, when offset is passed on a page that fits", async () => {
    servePage("# Small");
    const result = await read(0);
    expect(result).toStrictEqual({ url: TEST_URL, content: "# Small", totalChars: 7, offset: 0, truncated: false });
  });

  it("starts at the offset it is given", async () => {
    const page = headingPage();
    servePage(page);
    const part = await read(5_000);
    expect(part.offset).toBe(5_000);
    expect(part.content).toBe(page.slice(5_000, 5_000 + part.content.length));
  });

  it("reads an offset past the end as an empty part that is not truncated", async () => {
    servePage("# Small");
    expect(await read(7)).toStrictEqual({ url: TEST_URL, content: "", totalChars: 7, offset: 7, truncated: false });
    expect(await read(1_000_000)).toStrictEqual({ url: TEST_URL, content: "", totalChars: 7, offset: 7, truncated: false });
  });

  it("passes a body with no text through as it always did", async () => {
    servePage(undefined);
    expect(await read()).toStrictEqual({ url: TEST_URL, content: undefined });
  });
});

describe("wikiReadTool, the sidebar", () => {
  it("removes it from a page that fits, which still comes back as just { url, content }", async () => {
    servePage(ENGLAND_HEAD);
    expect(await read()).toStrictEqual({ url: TEST_URL, content: ENGLAND_STRIPPED });
  });

  it("removes it before the cut: the parts join to the page without it, and totalChars is that page's length", async () => {
    servePage(LONG_PAGE);
    const stripped = LONG_PAGE_STRIPPED;
    const parts = await walkParts(read);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.content).join("")).toBe(stripped);
    for (const part of parts) {
      expect(part.totalChars).toBe(stripped.length);
      expect(part.content).not.toContain("Wiki Topics");
    }
  });
});

describe("wikiReadTool, offset validation", () => {
  it.each([
    ["a string", "5", '"5"'],
    ["a negative number", -1, "-1"],
    ["a fraction", 1.5, "1.5"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["null", null, "null"],
  ])("(e) rejects an offset of %s with the requireWholeNumber error, before any request", async (_label, value, got) => {
    servePage("# Small");
    await expect(wikiReadTool({ url: TEST_URL, offset: value as unknown as number }, LOCAL)).rejects.toThrow(
      `offset must be a whole number ≥ 0 (got ${got}). Send it as a number, not a string.`,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetWikiApiUrl).not.toHaveBeenCalled();
  });
});

describe("wikiReadSchema, paging", () => {
  it("declares offset as a number and still requires only url", () => {
    expect(wikiReadSchema.inputSchema.properties.offset.type).toBe("number");
    expect(wikiReadSchema.inputSchema.required).toEqual(["url"]);
  });

  it("tells the agent how to continue", () => {
    expect(wikiReadSchema.description).toContain(
      "when `truncated` is true, call again with `offset: nextOffset` until it is false",
    );
    expect(wikiReadSchema.inputSchema.properties.offset.description).toContain("`nextOffset`");
  });
});

describe("wikiReadTool, a missing regional record-type page (issue #4516)", () => {
  const notFound = { ok: false, status: 404, json: async () => ({}) };
  const plainFor = (slug: string) => `No wiki page found for "${slug}". The page may not exist in the corpus.`;

  it("derives the country's slug from a regional record-type slug", () => {
    expect(countryTopicSlug("Württemberg,_Germany_Naming_Customs")).toBe("Germany_Naming_Customs");
    expect(countryTopicSlug("Bavaria_(Bayern),_German_Empire_Church_Records")).toBe("German_Empire_Church_Records");
    expect(countryTopicSlug("Lincolnshire,_England_Census")).toBe("England_Census");
    expect(countryTopicSlug("Norway_Church_Records")).toBeNull();
    expect(countryTopicSlug("Hamre,_Hordaland,_Norway_Genealogy")).toBeNull();
  });

  it("names the country's page when it exists", async () => {
    mockFetch
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ title: "Germany_Naming_Customs", content: "# G", source_url: "" }),
      });
    const err = await wikiReadTool(
      { url: "https://www.familysearch.org/en/wiki/W%C3%BCrttemberg,_Germany_Naming_Customs" },
      LOCAL
    ).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      `${plainFor("Württemberg,_Germany_Naming_Customs")} The country's page exists: ` +
        "https://www.familysearch.org/en/wiki/Germany_Naming_Customs"
    );
    expect(mockFetch.mock.calls[1][0]).toBe(`${API_BASE}/page/Germany_Naming_Customs`);
  });

  it("keeps the plain message when the country's page is missing too", async () => {
    mockFetch.mockResolvedValue(notFound);
    const err = await wikiReadTool({ url: "https://www.familysearch.org/en/wiki/Hordaland,_Norway_Census" }, LOCAL).catch(
      (e: Error) => e
    );
    expect((err as Error).message).toBe(plainFor("Hordaland,_Norway_Census"));
  });

  it("keeps the plain message when the country lookup fails", async () => {
    mockFetch.mockResolvedValueOnce(notFound).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    const err = await wikiReadTool({ url: "https://www.familysearch.org/en/wiki/Hordaland,_Norway_Census" }, LOCAL).catch(
      (e: Error) => e
    );
    expect((err as Error).message).toBe(plainFor("Hordaland,_Norway_Census"));
  });

  it("makes no second request for a missing page that is not a regional record-type page", async () => {
    mockFetch.mockResolvedValueOnce(notFound);
    await expect(wikiReadTool({ url: TEST_URL }, LOCAL)).rejects.toThrow(/No wiki page found/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("wikiReadTool, collection notices", () => {
  const WIKI = "https://www.familysearch.org/en/wiki";
  const legacyLine =
    "| [Information icon.png](https://x/icon.png) | **This is a Legacy Collection** This collection is a partial index " +
    'of records for this locality. *As no additional records will be added, this is considered to be a ["Legacy" ' +
    "collection](https://x/Legacy)*. **Verify with original records.** |";
  const LEGACY_TEXT =
    "This is a Legacy Collection This collection is a partial index of records for this locality. " +
    'As no additional records will be added, this is considered to be a "Legacy" collection. Verify with original records.';
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const collectionLink = (slug: string, anchor = "") =>
    `[How to Use this Collection](${WIKI}/${slug}_-_FamilySearch_Historical_Records${anchor})`;

  function serve(pages: Record<string, { status: number; content?: string; title?: string }>) {
    mockFetch.mockImplementation(async (url: string) => {
      const slug = decodeURIComponent(url.slice(`${API_BASE}/page/`.length));
      const page = pages[slug];
      if (!page) return { ok: false, status: 404, json: async () => ({}) };
      if (page.status !== 200) return { ok: false, status: page.status, json: async () => ({}) };
      return ok({ title: page.title ?? slug, content: page.content ?? "", source_url: "" });
    });
  }

  it("lists a linked collection page that carries the Legacy notice, as plain text", async () => {
    serve({
      Region_Church_Records: { status: 200, content: `### Baptisms\n* ${collectionLink("Region,_Births")}` },
      "Region,_Births_-_FamilySearch_Historical_Records": {
        status: 200,
        title: "Region, Births - FamilySearch Historical Records",
        content: `# Region, Births\n${legacyLine}\n## What is in This Collection?`,
      },
    });
    const result = await wikiReadTool({ url: `${WIKI}/Region_Church_Records` }, LOCAL);
    expect(result.collectionNotices).toEqual([
      {
        title: "Region, Births - FamilySearch Historical Records",
        url: `${WIKI}/Region,_Births_-_FamilySearch_Historical_Records`,
        notice: LEGACY_TEXT,
      },
    ]);
  });

  it("leaves out linked pages with no notice, missing pages and failed lookups, and still returns the page", async () => {
    serve({
      Region_Church_Records: {
        status: 200,
        content: [collectionLink("Plain"), collectionLink("Missing"), collectionLink("Broken")].join("\n"),
      },
      "Plain_-_FamilySearch_Historical_Records": { status: 200, content: "# Plain\nNo notice here." },
      "Broken_-_FamilySearch_Historical_Records": { status: 400 },
    });
    const result = await wikiReadTool({ url: `${WIKI}/Region_Church_Records` }, LOCAL);
    expect(result.content).toContain("Plain");
    expect(result).not.toHaveProperty("collectionNotices");
  });

  it("checks each linked page once, ignoring anchors", async () => {
    serve({
      Region_Church_Records: {
        status: 200,
        content: [collectionLink("Region,_Births"), collectionLink("Region,_Births", "#Collection_Content")].join("\n"),
      },
      "Region,_Births_-_FamilySearch_Historical_Records": { status: 200, content: legacyLine },
    });
    const result = await wikiReadTool({ url: `${WIKI}/Region_Church_Records` }, LOCAL);
    expect(result.collectionNotices).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("checks at most 10 linked pages, all at once", async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `C${i}`);
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async (url: string) => {
      const slug = decodeURIComponent(url.slice(`${API_BASE}/page/`.length));
      if (slug === "Region_Church_Records") {
        return ok({ title: slug, content: slugs.map((s) => collectionLink(s)).join("\n"), source_url: "" });
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return ok({ title: slug, content: legacyLine, source_url: "" });
    });
    const result = await wikiReadTool({ url: `${WIKI}/Region_Church_Records` }, LOCAL);
    expect(mockFetch).toHaveBeenCalledTimes(11);
    expect(peak).toBe(10);
    expect(result.collectionNotices?.map((n) => n.url)).toEqual(
      slugs.slice(0, 10).map((s) => `${WIKI}/${s}_-_FamilySearch_Historical_Records`)
    );
  });

  it("makes no lookup on a later part", async () => {
    serve({
      Region_Church_Records: { status: 200, content: `${collectionLink("Region,_Births")}\n` + "x".repeat(10) },
      "Region,_Births_-_FamilySearch_Historical_Records": { status: 200, content: legacyLine },
    });
    const result = await wikiReadTool({ url: `${WIKI}/Region_Church_Records`, offset: 5 }, LOCAL);
    expect(result).not.toHaveProperty("collectionNotices");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("names the field in its description", () => {
    expect(wikiReadSchema.description).toContain("collectionNotices");
  });
});
