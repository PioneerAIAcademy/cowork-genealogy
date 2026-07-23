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
