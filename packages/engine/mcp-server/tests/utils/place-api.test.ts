import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { searchPlace } from "../../src/utils/place-api.js";

function emptyResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ entries: [] }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(emptyResponse());
});

describe("searchPlace", () => {
  it("phrase-quotes a multi-word name in the query", async () => {
    // Regression test: an unquoted multi-word `name:` value is parsed by
    // FamilySearch's search as an OR of tokens, so a place literally named
    // just one token (e.g. "West" in Cameroon) can outscore the real
    // multi-word place entirely. Verified live against the real API:
    // `q=name:West Bromwich` (unquoted) returns no West-Bromwich-shaped
    // result at all; `q=name:"West Bromwich"` (phrase-quoted) ranks the
    // correct England/UK entries first.
    await searchPlace("West Bromwich");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain(encodeURIComponent(`"West Bromwich"`));
    expect(requestedUrl).not.toContain(`name:${encodeURIComponent("West Bromwich")}&`);
    expect(requestedUrl).not.toMatch(/name:West(%20|\+)Bromwich(?!%22)/);
  });

  it("still quotes a single-word name (harmless, keeps the query construction uniform)", async () => {
    await searchPlace("Ohio");

    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain(encodeURIComponent(`"Ohio"`));
  });

  it("parses a successful response into SearchPlaceResult[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          entries: [
            {
              id: "rep1",
              score: 0.75,
              content: {
                gedcomx: {
                  places: [
                    {
                      display: {
                        name: "West Bromwich",
                        fullName: "West Bromwich, Staffordshire, England, United Kingdom",
                        type: "City",
                      },
                      identifiers: {
                        "http://gedcomx.org/Primary": [
                          "https://api.familysearch.org/platform/places/12345",
                        ],
                      },
                    },
                  ],
                },
              },
            },
          ],
        }),
    });

    const results = await searchPlace("West Bromwich");
    expect(results).toEqual([
      expect.objectContaining({
        placeId: "12345",
        placeRepId: "rep1",
        fullName: "West Bromwich, Staffordshire, England, United Kingdom",
        score: 0.75,
      }),
    ]);
  });
});

// Each of these fails on main. The suite was previously invariant to whether
// the sanitiser, the header and the qualifier worked at all: reverting
// place-api.ts wholesale left every test green, which is why they exist.
describe("searchPlace query sanitisation", () => {
  // Read the decoded `q` VALUE, not the whole URL: the URL always contains a
  // literal "?" as its query separator, so asserting on the raw string would
  // pass or fail for the wrong reason.
  const q = (i = 0) =>
    new URL(mockFetch.mock.calls[i][0] as string).searchParams.get("q") ?? "";
  const decoded = () => q(0);

  it("maps & to the word 'and' rather than dropping it", async () => {
    // Dropping the & deletes a token from the phrase and a shorter parent name
    // outscores the real place: live, "Manila American Cemetery & Memorial, ..."
    // returns the cemetery at 88 with the word and only the CITY of Manila at
    // 72 with the & removed.
    await searchPlace("Great & Little Singleton, Kirkham, Lancashire");
    expect(decoded()).toContain("Great and Little Singleton");
    expect(decoded()).not.toContain("&");
  });

  it("drops the documented wildcard and fuzzy operators", async () => {
    await searchPlace("Marshall Sal*, Missouri");
    expect(q(0)).not.toContain("*");
    await searchPlace("Alverson Cemetery #1, Owen, Indiana");
    expect(q(1)).not.toContain("#");
    await searchPlace("??Gren");
    expect(q(2)).not.toContain("?");
    expect(q(2)).toContain('name:"Gren"');
    await searchPlace("Wanrooij~, Noord-Brabant");
    expect(q(3)).not.toContain("~");
  });

  it("leaves characters that were never measured as harmful alone", async () => {
    // Hyphens are load-bearing in real names; parens and colons measured benign.
    await searchPlace("Bambecque, Nord, Hauts-de-France, France");
    expect(decoded()).toContain("Hauts-de-France");
  });

  it("returns [] without calling the API when sanitising empties the name", async () => {
    const results = await searchPlace("???");
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pins Accept-Language so the persisted spelling cannot drift", async () => {
    await searchPlace("Bayern, Deutschland");
    const init = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["Accept-Language"]).toBe("en");
  });
});

describe("searchPlace date qualifier", () => {
  it("omits +date: entirely when no date is given", async () => {
    await searchPlace("Rochdale, England");
    const sent = new URL(mockFetch.mock.calls[0][0] as string).searchParams.get("q") ?? "";
    expect(sent).not.toContain("+date:");
  });

  it("appends +date:+YYYY when a year is given", async () => {
    await searchPlace("Rochdale, England", { date: 1880 });
    // Undated this resolves to Greater Manchester, a county created in 1974.
    const sent = new URL(mockFetch.mock.calls[0][0] as string).searchParams.get("q") ?? "";
    expect(sent).toContain("+date:+1880");
  });

  it("keeps the qualifier outside the phrase-quoted name", async () => {
    await searchPlace("Rochdale, England", { date: 1880 });
    const sent = new URL(mockFetch.mock.calls[0][0] as string).searchParams.get("q") ?? "";
    expect(sent).toBe('name:"Rochdale, England" +date:+1880');
  });
});
