import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { wikipediaSearch } from "../../src/tools/wikipedia.js";
import { readBuildInfo } from "../../src/utils/build-info.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";
const SEARCH = "https://en.wikipedia.org/w/rest.php/v1/search/page";
const USER_AGENT = `genealogy-mcp-server/${readBuildInfo().base} (https://github.com/PioneerAIAcademy/cowork-genealogy)`;

const summaryBody = (title: string, extract: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    title,
    extract,
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` } },
  }),
});

const statusBody = (code: number) => ({ ok: false, status: code, headers: new Headers(), json: async () => ({}) });

const hitsBody = (titles: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ pages: titles.map((title) => ({ title, key: title.replace(/ /g, "_") })) }),
});

function summaryOk(title: string, extract: string) {
  mockFetch.mockResolvedValueOnce(summaryBody(title, extract));
}

function status(code: number) {
  mockFetch.mockResolvedValueOnce(statusBody(code));
}

function searchHits(titles: string[]) {
  mockFetch.mockResolvedValueOnce(hitsBody(titles));
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
  const MOOREA = ["Moʼorea", "French Polynesia", "Marquesas Islands", "Society Islands", "Index of French Polynesia–related articles"];
  const GEORGIA = [
    "Tamar of Georgia",
    "History of Georgia (U.S. state)",
    "History of slavery in South Carolina",
    "Cherokee history",
    "Bibliography of early United States naval history",
  ];

  const expectSearched = (query: string) =>
    expect(urlOf(1)).toBe(`${SEARCH}?q=${encodeURIComponent(query)}&limit=5`);

  // Hit lists as the live search endpoint returned them on 2026-10-19 (issue #3557).
  const KENYA = ["Church Mission Society", "Anglican Church of Kenya", "Missionary Church", "Mill Hill Missionaries", "Chief Kivoi Mwendwa"];
  // Wikipedia swaps "Pretoria" and the 1948–1994 article between fetches, so both orders are tested.
  const PRETORIA_FOURTH = ["Transvaal Colony", "South African Republic", "History of South Africa (1948–1994)", "Pretoria", "University of South Africa"];
  const PRETORIA_THIRD = ["Transvaal Colony", "South African Republic", "Pretoria", "History of South Africa (1948–1994)", "University of South Africa"];
  const PECQUENCOURT = ["Communes of the Nord department", "Pecquencourt", "Armorial of the Communes of Nord (Q–Z)", "Bailleul, Nord", "Croix, Nord"];
  const NORWAY = ["Culture of Norway", "History of Norway", "Diseases and epidemics of the 19th century", "History of Germany", "19th century in science"];
  const TOPSHAM = ["Orange County, Vermont", "Orange, Vermont", "Groton State Forest", "Groton, Vermont", "Thetford Academy, Vermont"];
  const DETROIT = ["History of Detroit", "Michigan", "Hamtramck, Michigan", "History of Michigan", "Detroit"];

  it.each([
    ["Maddock North Dakota history", MADDOCK],
    ["Hollow Creek Settlement", HOLLOW_CREEK],
    ["Church Missionary Society in Kenya", KENYA],
    // Constructed hit lists, each pinning one part of the rule.
    ["Cork Ireland county history", ["County Cork"]],
    ["Baden history Germany", ["Baden-Baden"]],
    ["Fort history", ["Fort (Wayne) station"]],
    ["Rhode Island history", ["Rhode Island (19th century)"]],
    ["1999 history", ["The (1999)"]],
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
    ["Mo'orea island history French Polynesia", MOOREA, "Moʼorea"],
    ["O'Brien family history Ireland", ["O’Brien", "O'Brien (surname)"], "O’Brien"],
    ["Pretoria Transvaal South Africa history civil registration", PRETORIA_FOURTH, "Pretoria"],
    ["Pretoria Transvaal South Africa history civil registration", PRETORIA_THIRD, "Pretoria"],
    ["Pecquencourt commune Nord department France", PECQUENCOURT, "Pecquencourt"],
    ["Norway history 19th century", NORWAY, "History of Norway"],
    ["Topsham Vermont history Orange County", TOPSHAM, "Orange County, Vermont"],
    ["Detroit Wayne County Michigan history genealogy records", DETROIT, "History of Detroit"],
    ["History of Detroit Michigan", DETROIT, "History of Detroit"],
    // Constructed hit lists, each pinning one part of the rule.
    ["Republic of Texas history", ["History of the Republic of Texas"], "History of the Republic of Texas"],
    ["Savannah Georgia history", ["History of Savannah, Georgia"], "History of Savannah, Georgia"],
    ["South Africa history 1948–1994", ["History of South Africa (1948–1994)"], "History of South Africa (1948–1994)"],
    ["Posen province history Prussia", ["Province of Posen", "Posen"], "Province of Posen"],
    ["Illinois 1821 Springfield history", ["Springfield (Illinois, 1821)"], "Springfield (Illinois, 1821)"],
    ["Treaty of Paris 1783 American Revolution", ["Treaty of Paris (1783)"], "Treaty of Paris (1783)"],
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

describe("wikipediaSearch — one deadline for the whole call", () => {
  const START = 1_000_000;
  const QUERY = "Luo people Kenya ethnic group history";
  let now: number;

  beforeEach(() => {
    now = START;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  /** Queue a response that arrives `ms` after its request was sent. */
  function after(ms: number, response: object) {
    mockFetch.mockImplementationOnce(async () => {
      now += ms;
      return response;
    });
  }

  it("caps each request's timeout at what is left of one 55s deadline", async () => {
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    after(20_000, statusBody(404));
    after(10_000, hitsBody(["Luo people"]));
    after(0, summaryBody("Luo people", "…"));

    await wikipediaSearch({ query: QUERY });

    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([55_000, 35_000, 25_000]);
  });

  it.each([
    ["the search", [[54_500, statusBody(404)]], 1],
    ["the matched hit's summary", [[20_000, statusBody(404)], [34_500, hitsBody(["Luo people"])]], 2],
  ] as const)("fails as a timeout, not as no article, when too little is left for %s", async (_stage, responses, sent) => {
    for (const [ms, response] of responses) after(ms, response);
    // What each later request would answer if it were sent: nothing found.
    mockFetch.mockImplementation(async (url: string) => (url.startsWith(SEARCH) ? hitsBody([]) : statusBody(404)));

    await expect(wikipediaSearch({ query: QUERY })).rejects.toThrow(
      `Wikipedia lookup for '${QUERY}' timed out: it is not an exact article title`
    );
    expect(mockFetch).toHaveBeenCalledTimes(sent);
  });

  it("keeps a retried request inside the deadline", async () => {
    after(52_000, statusBody(404));
    mockFetch.mockImplementation(async () => {
      now += 3_000;
      return statusBody(503);
    });

    await expect(wikipediaSearch({ query: QUERY })).rejects.toThrow("Wikipedia search API error: 503");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(now - START).toBeLessThanOrEqual(55_000);
  });
});
