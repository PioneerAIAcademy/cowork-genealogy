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
    expect(urlOf(1)).toBe(`${SEARCH}?q=${encodeURIComponent(query)}&limit=5`);
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

describe("wikipediaSearch — which search hit it takes", () => {
  // Hit lists as the live search endpoint returned them (limit=5) on 2026-10-18.
  const MADDOCK = [
    "List of governors of North Dakota",
    "First ladies of North Dakota",
    "List of founding dates of North Dakota incorporated cities",
    "Doug Burgum",
    "List of school districts in North Dakota",
  ];
  const HOLLOW_CREEK = ["Swede Hollow, Saint Paul", "Goose Hollow, Portland, Oregon", "Hannacrois Creek", "Kawagama Lake", "Wilber Lake"];
  const LUO = ["Luo people", "Demographics of Kenya", "Luo peoples", "Luo", "List of Luo Kenyans"];
  const SCHUYLKILL = [
    "Schuylkill County, Pennsylvania",
    "Schuylkill notes",
    "National Register of Historic Places listings in Schuylkill County, Pennsylvania",
    "Schuylkill Haven, Pennsylvania",
    "Schuylkill River",
  ];
  const SAINT_ETIENNE = ["Saint-Étienne", "AS Saint-Étienne", "Saint Etienne (band)", "Saint Etienne discography", "CA Saint-Étienne Loire Sud Rugby"];
  const OSTEROY = ["Hamre, Osterøy", "Osterøy Municipality", "Hordaland", "Etne Municipality", "Os Municipality (Hordaland)"];
  const GEORGIA = [
    "Tamar of Georgia",
    "History of Georgia (U.S. state)",
    "History of slavery in South Carolina",
    "Cherokee history",
    "Bibliography of early United States naval history",
  ];

  const expectSearched = (query: string) =>
    expect(urlOf(1)).toBe(`${SEARCH}?q=${encodeURIComponent(query)}&limit=5`);

  it.each([
    ["Maddock North Dakota history", MADDOCK],
    ["Hollow Creek Settlement", HOLLOW_CREEK],
  ])("keeps the not-found error for '%s' when no hit's title is in the query", async (query, hits) => {
    status(404);
    searchHits(hits);

    await expect(wikipediaSearch({ query })).rejects.toThrow(`No Wikipedia article found for '${query}'`);
    expectSearched(query);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Luo people Kenya ethnic group history", LUO, "Luo people"],
    ["History of Schuylkill County Pennsylvania", SCHUYLKILL, "Schuylkill County, Pennsylvania"],
    ["Saint Etienne history", SAINT_ETIENNE, "Saint-Étienne"],
    ["Hamre parish Osteroy Hordaland Norway history", OSTEROY, "Hamre, Osterøy"],
    ["Georgia state history genealogy records 19th century", GEORGIA, "History of Georgia (U.S. state)"],
  ])("resolves '%s' to the hit whose title it spells out", async (query, hits, title) => {
    status(404);
    searchHits(hits);
    summaryOk(title, "…");

    const result = await wikipediaSearch({ query });

    expectSearched(query);
    expect(urlOf(2)).toBe(`${SUMMARY}/${encodeURIComponent(title)}`);
    expect(result.title).toBe(title);
  });

  it("takes a matching second hit over a first that does not match", async () => {
    const query = "Luo people Kenya ethnic group history";
    status(404);
    searchHits(["Demographics of Kenya", "Luo people"]);
    summaryOk("Luo people", "…");

    const result = await wikipediaSearch({ query });

    expectSearched(query);
    expect(urlOf(2)).toBe(`${SUMMARY}/Luo%20people`);
    expect(result.title).toBe("Luo people");
  });

  it("never takes a hit whose title is only small words", async () => {
    status(404);
    searchHits(["Le", "Le Mans"]);
    summaryOk("Le Mans", "…");

    const result = await wikipediaSearch({ query: "Le Mans history" });

    expect(urlOf(2)).toBe(`${SUMMARY}/Le%20Mans`);
    expect(result.title).toBe("Le Mans");
  });
});
