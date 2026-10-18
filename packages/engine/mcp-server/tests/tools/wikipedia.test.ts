import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wikipediaSearch } from "../../src/tools/wikipedia.js";
import { readBuildInfo } from "../../src/utils/build-info.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";
const SEARCH = "https://en.wikipedia.org/w/rest.php/v1/search/page";
const USER_AGENT = `genealogy-mcp-server/${readBuildInfo().base} (https://github.com/PioneerAIAcademy/cowork-genealogy)`;

function summaryOk(title: string, extract: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      title,
      extract,
      content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` } },
    }),
  });
}

function status(code: number) {
  mockFetch.mockResolvedValueOnce({ ok: false, status: code, json: async () => ({}) });
}

function searchHits(titles: string[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ pages: titles.map((title) => ({ title, key: title.replace(/ /g, "_") })) }),
  });
}

const urlOf = (call: number) => mockFetch.mock.calls[call][0] as string;

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wikipediaSearch", () => {
  it("returns an exact title's summary directly, without searching", async () => {
    summaryOk("Luo people", "The Luo are a Western Nilotic ethnic group…");

    const result = await wikipediaSearch({ query: "Luo people" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toBe(`${SUMMARY}/Luo%20people`);
    expect(result).toEqual({
      title: "Luo people",
      extract: "The Luo are a Western Nilotic ethnic group…",
      url: "https://en.wikipedia.org/wiki/Luo_people",
    });
  });

  it("resolves a descriptive query that 404s as a title through search, returning the real article title", async () => {
    const query = "Luo people Kenya Western Kenya ethnic group history";
    status(404);
    searchHits(["Luo people"]);
    summaryOk("Luo people", "The Luo are a Western Nilotic ethnic group…");

    const result = await wikipediaSearch({ query });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(urlOf(0)).toBe(`${SUMMARY}/${encodeURIComponent(query)}`);
    expect(urlOf(1)).toBe(`${SEARCH}?q=${encodeURIComponent(query)}&limit=1`);
    expect(urlOf(2)).toBe(`${SUMMARY}/Luo%20people`);
    expect(result.title).toBe("Luo people");
    expect(result.url).toBe("https://en.wikipedia.org/wiki/Luo_people");
    for (const [, init] of mockFetch.mock.calls) {
      expect((init as RequestInit).headers).toEqual({ "User-Agent": USER_AGENT });
    }
  });

  it("keeps the not-found error when the search has no hits either", async () => {
    status(404);
    searchHits([]);

    await expect(wikipediaSearch({ query: "zzqxjvwk qqqzzzxxyy" })).rejects.toThrow(
      "No Wikipedia article found for 'zzqxjvwk qqqzzzxxyy'"
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a summary error other than 404 without searching", async () => {
    status(403);

    await expect(wikipediaSearch({ query: "Luo people" })).rejects.toThrow("Wikipedia API error: 403");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("reports a failed search as a search error, not as no article", async () => {
    status(404);
    status(403);

    await expect(wikipediaSearch({ query: "Luo people Kenya" })).rejects.toThrow(
      "Wikipedia search API error: 403"
    );
  });
});
