import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  searchTool,
  buildSearchUrl,
  applyAltNameAutoPair,
  validateInput,
  mapEntry,
  findRepresentedPerson,
  parseUpstreamErrorBody,
} from "../../src/tools/search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type { FSSearchEntry, FSSearchResponse } from "../../src/types/search.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeOkResponse(body: FSSearchResponse): {
  ok: true;
  status: 200;
  statusText: "OK";
  json: () => Promise<FSSearchResponse>;
} {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

function emptyResponse(): FSSearchResponse {
  return { results: 0, index: 0, entries: [] };
}

function lincolnEntry(): FSSearchEntry {
  return {
    id: "QPRC-WPBZ",
    score: 5.42,
    confidence: 4,
    hints: [
      { id: "ark:/61903/4:1:GQWZ-GPX", stars: 5 },
      { id: "ark:/61903/4:1:GQWZ-AAA", stars: 3 },
    ],
    content: {
      gedcomx: {
        persons: [
          {
            principal: true,
            id: "p_1",
            display: {
              name: "Abraham Lincoln",
              gender: "Male",
              birthDate: "12 February 1809",
              birthPlace: "Hardin, Kentucky, United States",
              deathDate: "14 April 1865",
              deathPlace: "Washington, DC",
              role: "Principal",
            },
            facts: [
              {
                type: "http://gedcomx.org/Birth",
                date: { original: "12 February 1809" },
                place: { original: "Hardin, Kentucky, United States" },
              },
              {
                type: "http://gedcomx.org/Residence",
                date: { original: "1860" },
                place: { original: "Springfield, Illinois" },
              },
            ],
            identifiers: {
              "http://gedcomx.org/Persistent": [
                "https://familysearch.org/ark:/61903/1:1:QPRC-WPBZ",
              ],
            },
          },
        ],
        sourceDescriptions: [
          {
            resourceType: "http://gedcomx.org/Collection",
            about: "https://familysearch.org/collections/5000016",
            titles: [{ value: "Some Collection" }],
          },
          {
            titles: [{ value: "Entry for Abraham Lincoln" }],
            identifiers: {
              "http://gedcomx.org/Persistent": [
                "https://familysearch.org/ark:/61903/1:2:HSJG-CLNF",
              ],
            },
          },
        ],
      },
    },
  };
}

describe("searchTool happy path", () => {
  it("1. returns ranked results for surname + givenName", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 432, index: 0, entries: [lincolnEntry()] })
    );

    const result = await searchTool({ surname: "Lincoln", givenName: "Abraham" });

    expect(result.totalMatches).toBe(432);
    expect(result.returned).toBe(1);
    expect(result.results[0].personId).toBe("QPRC-WPBZ");
    expect(result.results[0].personName).toBe("Abraham Lincoln");
    expect(result.paginationCappedAt).toBe(4999);
  });

  it("2. returns results for country-scoped search (recordCountry only)", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    const result = await searchTool({
      recordCountry: "United States",
      givenName: "John",
    });
    expect(result.results).toEqual([]);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("q.recordCountry=United%20States");
  });

  it("3. surnameAlt-only triggers UNION + auto-pairs givenNameAlt", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await searchTool({
      givenName: "Mary",
      surname: "Lincoln",
      surnameAlt: "Todd",
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.surname.1=Todd");
    expect(url).toContain("q.givenName.1=Mary");
  });

  it("4. givenNameAlt-only triggers UNION + auto-pairs surnameAlt", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await searchTool({
      givenName: "Mary",
      surname: "Lincoln",
      givenNameAlt: "May",
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.givenName.1=May");
    expect(url).toContain("q.surname.1=Lincoln");
  });
});

describe("searchTool input validation", () => {
  it("5. throws when no anchor is supplied", async () => {
    await expect(
      searchTool({ givenName: "John", birthPlace: "Kentucky" })
    ).rejects.toThrow(/at least one anchor/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("6. throws when count > 100 or count < 1", async () => {
    await expect(
      searchTool({ surname: "Lincoln", count: 200 })
    ).rejects.toThrow(/count must be between 1 and 100/);
    await expect(
      searchTool({ surname: "Lincoln", count: 0 })
    ).rejects.toThrow(/count must be between 1 and 100/);
  });

  it("7. throws when offset + count > 4999", async () => {
    await expect(
      searchTool({ surname: "Lincoln", offset: 4998, count: 3 })
    ).rejects.toThrow(/offset \+ count must be <= 4999/);
  });

  it("8. throws when YearFrom is supplied without YearTo", async () => {
    await expect(
      searchTool({ surname: "Lincoln", birthYearFrom: 1809 })
    ).rejects.toThrow(/birthYearFrom and birthYearTo must be provided together/);
  });

  it("9. throws when YearFrom > YearTo", async () => {
    await expect(
      searchTool({
        surname: "Lincoln",
        birthYearFrom: 1850,
        birthYearTo: 1849,
      })
    ).rejects.toThrow(/birthYearFrom must be <= birthYearTo/);
  });

  it("10. throws when recordSubdivision is supplied without recordCountry", async () => {
    await expect(
      searchTool({ surname: "Lincoln", recordSubdivision: "Alabama" })
    ).rejects.toThrow(/recordSubdivision requires recordCountry/);
  });

  it("11. throws on sex outside Male/Female/Unknown", async () => {
    await expect(
      searchTool({ surname: "Lincoln", sex: "M" })
    ).rejects.toThrow(/sex must be 'Male', 'Female', or 'Unknown'/);
  });

  it("11b. accepts case-insensitive sex", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await searchTool({ surname: "Lincoln", sex: "male" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.sex=Male");
  });

  it("12. throws on maritalStatus outside the four allowed values", async () => {
    await expect(
      searchTool({ surname: "Lincoln", maritalStatus: "married" })
    ).rejects.toThrow(/maritalStatus must be exactly one of/);
  });

  it("13. throws on recordType outside the eight allowed values", async () => {
    await expect(
      searchTool({ surname: "Lincoln", recordType: "wedding" as never })
    ).rejects.toThrow(/recordType must be one of/);
  });

  it("rejects non-4-digit year inputs", () => {
    expect(() =>
      validateInput({
        surname: "Lincoln",
        birthYearFrom: 99,
        birthYearTo: 99,
      })
    ).toThrow(/4-digit year/);
  });
});

describe("buildSearchUrl param mapping", () => {
  it("14. maps q.* params correctly", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      givenName: "Abraham",
      birthYearFrom: 1809,
      birthYearTo: 1809,
      birthPlace: "Kentucky",
    });
    expect(url).toContain("q.surname=Lincoln");
    expect(url).toContain("q.givenName=Abraham");
    expect(url).toContain("q.birthLikeDate.from=1809");
    expect(url).toContain("q.birthLikeDate.to=1809");
    expect(url).toContain("q.birthLikePlace=Kentucky");
  });

  it("15. surnameExact + surnameAlt emits both .exact=on and .exact.1=on", () => {
    const url = buildSearchUrl({
      surname: "Smith",
      surnameAlt: "Smyth",
      givenName: "John",
      surnameExact: true,
    });
    expect(url).toContain("q.surname.exact=on");
    expect(url).toContain("q.surname.exact.1=on");
  });

  it("16. birthYearExact emits q.birthLikeDate.exact=on", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      birthYearFrom: 1809,
      birthYearTo: 1809,
      birthYearExact: true,
    });
    expect(url).toContain("q.birthLikeDate.exact=on");
  });

  it("17. birthPlaceExact emits q.birthLikePlace.exact=on", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      birthPlace: "Hodgenville",
      birthPlaceExact: true,
    });
    expect(url).toContain("q.birthLikePlace.exact=on");
  });

  it("18. recordSubdivision composes into q.recordSubcountry=country,subdivision", () => {
    const url = buildSearchUrl({
      surname: "Smith",
      recordCountry: "United States",
      recordSubdivision: "Alabama",
    });
    expect(url).toContain(
      "q.recordSubcountry=United%20States%2CAlabama"
    );
  });

  it("19. recordType=marriage maps to f.recordType=1", () => {
    const url = buildSearchUrl({ surname: "Smith", recordType: "marriage" });
    expect(url).toContain("f.recordType=1");
  });

  it("20. default flags m.queryRequireDefault=on and m.defaultFacets=off are sent", () => {
    const url = buildSearchUrl({ surname: "Lincoln" });
    expect(url).toContain("m.queryRequireDefault=on");
    expect(url).toContain("m.defaultFacets=off");
  });
});

describe("searchTool error propagation", () => {
  it("21. throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockReset();
    mockedGetValidToken.mockRejectedValueOnce(
      new Error(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );
    await expect(
      searchTool({ surname: "Lincoln" })
    ).rejects.toThrow(/not logged in/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("22. throws on 400 with extracted error body detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        errors: [{ message: "invalid q.foo" }, { message: "bar required" }],
      }),
    });
    await expect(
      searchTool({ surname: "Lincoln" })
    ).rejects.toThrow(/invalid q.foo; bar required/);
  });

  it("23. falls back to generic 400 message when body isn't parseable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(
      searchTool({ surname: "Lincoln" })
    ).rejects.toThrow(/400 Bad Request/);
  });

  it("24. throws on 401 with re-login guidance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    await expect(searchTool({ surname: "Lincoln" })).rejects.toThrow(
      /session not accepted; call the login tool/
    );
  });

  it("25. throws on 403 with WAF/UA guidance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    await expect(searchTool({ surname: "Lincoln" })).rejects.toThrow(
      /User-Agent header was rejected by the WAF/
    );
  });

  it("throws on other non-OK statuses", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    await expect(searchTool({ surname: "Lincoln" })).rejects.toThrow(
      /500 Internal Server Error/
    );
  });
});

describe("searchTool response shape", () => {
  it("26. returns empty results when entries is empty", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const result = await searchTool({ surname: "Nobody" });
    expect(result.results).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("27. maps entry → SearchResult using display first, facts fallback", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        results: 1,
        index: 0,
        entries: [
          {
            id: "Q24K-MK1G",
            score: 1,
            confidence: 3,
            content: {
              gedcomx: {
                persons: [
                  {
                    principal: true,
                    facts: [
                      {
                        type: "http://gedcomx.org/Birth",
                        date: { original: "1880" },
                        place: { original: "Texas" },
                      },
                    ],
                    identifiers: {
                      "http://gedcomx.org/Persistent": [
                        "https://familysearch.org/ark:/61903/1:1:Q24K-MK1G",
                      ],
                    },
                    names: [{ nameForms: [{ fullText: "John Doe" }] }],
                    gender: { type: "http://gedcomx.org/Male" },
                  },
                ],
                sourceDescriptions: [
                  {
                    resourceType: "http://gedcomx.org/Collection",
                    about: "https://familysearch.org/collections/9999",
                    titles: [{ value: "Texas Births" }],
                  },
                ],
              },
            },
          },
        ],
      })
    );
    const result = await searchTool({ surname: "Doe" });
    const r = result.results[0];
    expect(r.personName).toBe("John Doe");
    expect(r.sex).toBe("Male");
    expect(r.birthDate).toBe("1880");
    expect(r.birthPlace).toBe("Texas");
    expect(r.collectionId).toBe("9999");
    expect(r.collectionTitle).toBe("Texas Births");
  });

  it("28. surfaces treeMatches from entry.hints sorted by stars descending", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] })
    );
    const result = await searchTool({ surname: "Lincoln" });
    const matches = result.results[0].treeMatches;
    expect(matches).toEqual([
      { treePersonId: "GQWZ-GPX", stars: 5 },
      { treePersonId: "GQWZ-AAA", stars: 3 },
    ]);
  });

  it("29. resolves represented persona by ark suffix when multiple principals exist", () => {
    const entry: FSSearchEntry = {
      id: "BBBB-2222",
      content: {
        gedcomx: {
          persons: [
            {
              principal: true,
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/1:1:AAAA-1111",
                ],
              },
              display: { name: "First Person" },
            },
            {
              principal: true,
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/1:1:BBBB-2222",
                ],
              },
              display: { name: "Second Person" },
            },
          ],
        },
      },
    };
    const person = findRepresentedPerson(entry);
    expect(person?.display?.name).toBe("Second Person");
  });

  it("30. sets hasMore=true when links.next exists", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        results: 100,
        index: 0,
        entries: [lincolnEntry()],
        links: { next: { href: "https://...&offset=20" } },
      })
    );
    const result = await searchTool({ surname: "Lincoln" });
    expect(result.hasMore).toBe(true);
  });

  it("31. echoes totalMatches and paginationCappedAt", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 17, index: 0, entries: [] })
    );
    const result = await searchTool({ surname: "Lincoln" });
    expect(result.totalMatches).toBe(17);
    expect(result.paginationCappedAt).toBe(4999);
  });
});

describe("helpers", () => {
  it("applyAltNameAutoPair fills missing givenNameAlt", () => {
    const out = applyAltNameAutoPair({
      surname: "Lincoln",
      givenName: "Mary",
      surnameAlt: "Todd",
    });
    expect(out.givenNameAlt).toBe("Mary");
  });

  it("applyAltNameAutoPair fills missing surnameAlt", () => {
    const out = applyAltNameAutoPair({
      surname: "Lincoln",
      givenName: "Mary",
      givenNameAlt: "May",
    });
    expect(out.surnameAlt).toBe("Lincoln");
  });

  it("applyAltNameAutoPair leaves both alone when both set", () => {
    const out = applyAltNameAutoPair({
      surname: "Lincoln",
      givenName: "Mary",
      surnameAlt: "Todd",
      givenNameAlt: "Polly",
    });
    expect(out.surnameAlt).toBe("Todd");
    expect(out.givenNameAlt).toBe("Polly");
  });

  it("mapEntry returns null when entry has no represented person", () => {
    const entry: FSSearchEntry = {
      id: "ZZZZ-9999",
      content: { gedcomx: { persons: [] } },
    };
    expect(mapEntry(entry)).toBeNull();
  });

  it("parseUpstreamErrorBody returns null for non-error bodies", () => {
    expect(parseUpstreamErrorBody({})).toBeNull();
    expect(parseUpstreamErrorBody(null)).toBeNull();
    expect(parseUpstreamErrorBody({ errors: [] })).toBeNull();
  });

  it("parseUpstreamErrorBody joins error messages", () => {
    expect(
      parseUpstreamErrorBody({
        errors: [{ message: "a" }, { message: "b" }],
      })
    ).toBe("a; b");
  });
});
