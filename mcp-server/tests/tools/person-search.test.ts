import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  personSearchTool,
  buildSearchUrl,
  validateInput,
  mapEntry,
  findMatchedPerson,
} from "../../src/tools/person-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type {
  FSTreeSearchEntry,
  FSTreeSearchResponse,
} from "../../src/types/person-search.js";

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

// ─── Fixtures ───────────────────────────────────────────────────────────

function makeOkResponse(body: FSTreeSearchResponse) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

function make204Response() {
  return { ok: true, status: 204, statusText: "No Content", json: async () => ({}) };
}

function makeErrorResponse(status: number, statusText: string, body: unknown = {}) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => body,
  };
}

function emptyResponse(): FSTreeSearchResponse {
  return { results: 0, index: 0, entries: [] };
}

/** Matched person (Lincoln) + a relative (his father) + a relationship. */
function lincolnTreeEntry(): FSTreeSearchEntry {
  return {
    id: "LZJW-C31",
    title: "Person LZJW-C31 (President Abraham Lincoln)",
    score: 5.11,
    confidence: 3,
    content: {
      gedcomx: {
        id: "ark:/61903/4:1:LZJW-C31",
        description: "#sdp_LZJW-C31",
        persons: [
          {
            id: "LZJW-C31",
            gender: { type: "http://gedcomx.org/Male" },
            names: [
              {
                type: "http://gedcomx.org/BirthName",
                preferred: true,
                nameForms: [
                  {
                    fullText: "President Abraham Lincoln",
                    parts: [
                      { type: "http://gedcomx.org/Given", value: "Abraham" },
                      { type: "http://gedcomx.org/Surname", value: "Lincoln" },
                    ],
                  },
                ],
              },
            ],
            facts: [
              {
                type: "http://gedcomx.org/Birth",
                date: { original: "12 February 1809" },
                place: { original: "Hardin, Kentucky, United States" },
              },
              {
                type: "http://gedcomx.org/Death",
                date: { original: "15 April 1865" },
                place: { original: "Washington, District of Columbia, United States" },
              },
            ],
            identifiers: {
              "http://gedcomx.org/Persistent": [
                "https://familysearch.org/ark:/61903/4:1:LZJW-C31",
              ],
            },
            // Source references on the matched person — dangling IDs that the
            // tool should strip from the lean output.
            sources: [
              { description: "#sd_1_1_4CT4-N1ZM" },
              { description: "#sd_1_1_QK4J-2GJL" },
            ],
          },
          {
            // A relative in the cluster — must NOT appear in the lean output.
            id: "LZ99-DAD",
            gender: { type: "http://gedcomx.org/Male" },
            names: [
              {
                nameForms: [
                  {
                    parts: [
                      { type: "http://gedcomx.org/Given", value: "Thomas" },
                      { type: "http://gedcomx.org/Surname", value: "Lincoln" },
                    ],
                  },
                ],
              },
            ],
            facts: [
              { type: "http://gedcomx.org/Birth", date: { original: "1778" } },
            ],
            identifiers: {
              "http://gedcomx.org/Persistent": [
                "https://familysearch.org/ark:/61903/4:1:LZ99-DAD",
              ],
            },
          },
        ],
        relationships: [
          {
            type: "http://gedcomx.org/ParentChild",
            person1: { resource: "#LZ99-DAD" },
            person2: { resource: "#LZJW-C31" },
          },
        ],
      },
    },
  };
}

const VALID_QUERY = { surname: "Lincoln", givenName: "Abraham" };

// ─── Happy path ─────────────────────────────────────────────────────────

describe("personSearchTool happy path", () => {
  it("1. returns ranked results for surname + givenName", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 7, index: 0, entries: [lincolnTreeEntry()] }),
    );

    const result = await personSearchTool(VALID_QUERY);

    expect(result.totalMatches).toBe(7);
    expect(result.returned).toBe(1);
    expect(result.results[0].personId).toBe("LZJW-C31");
    expect(result.results[0].score).toBe(5.11);
    expect(result.results[0].confidence).toBe(3);
    expect(result.paginationCappedAt).toBe(4999);
  });
});

// ─── Surname-plus-one rule (test #2 in the spec table) ──────────────────

describe("personSearchTool surname-plus-one rule", () => {
  it("2a. accepts surname + givenName", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await expect(
      personSearchTool({ surname: "Lincoln", givenName: "Abraham" }),
    ).resolves.toBeDefined();
  });

  it("2b. accepts surname + birthPlace", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await expect(
      personSearchTool({ surname: "Lincoln", birthPlace: "Kentucky" }),
    ).resolves.toBeDefined();
  });

  it("2c. rejects surname alone", async () => {
    await expect(personSearchTool({ surname: "Lincoln" })).rejects.toThrow(
      /requires a surname plus at least one other/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("2d. rejects no-surname (givenName + birthPlace)", async () => {
    await expect(
      personSearchTool({ givenName: "Abraham", birthPlace: "Kentucky" }),
    ).rejects.toThrow(/requires a surname/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("2e. rejects surname + sex only (sex doesn't count)", async () => {
    await expect(
      personSearchTool({ surname: "Lincoln", sex: "Male" }),
    ).rejects.toThrow(/requires a surname plus at least one other/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("2f. rejects surname + surnameExact only (a toggle doesn't count)", async () => {
    await expect(
      personSearchTool({ surname: "Lincoln", surnameExact: true }),
    ).rejects.toThrow(/requires a surname plus at least one other/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("2g. accepts surname + a relative name", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await expect(
      personSearchTool({ surname: "Lincoln", fatherSurname: "Lincoln" }),
    ).resolves.toBeDefined();
  });
});

// ─── Validation ─────────────────────────────────────────────────────────

describe("personSearchTool input validation", () => {
  it("3. throws when count is out of [1,100]", async () => {
    await expect(
      personSearchTool({ ...VALID_QUERY, count: 0 }),
    ).rejects.toThrow(/count must be between 1 and 100/);
    await expect(
      personSearchTool({ ...VALID_QUERY, count: 101 }),
    ).rejects.toThrow(/count must be between 1 and 100/);
  });

  it("4. throws when offset is out of [0,4999]", async () => {
    await expect(
      personSearchTool({ ...VALID_QUERY, offset: -1 }),
    ).rejects.toThrow(/offset must be between 0 and 4999/);
    await expect(
      personSearchTool({ ...VALID_QUERY, offset: 5000 }),
    ).rejects.toThrow(/offset must be between 0 and 4999/);
  });

  it("5. throws when a year-range half is supplied without the other", () => {
    expect(() =>
      validateInput({ ...VALID_QUERY, birthYearFrom: 1809 }),
    ).toThrow(/birthYearFrom and birthYearTo must be provided together/);
  });

  it("6. throws when YearFrom > YearTo", () => {
    expect(() =>
      validateInput({ ...VALID_QUERY, birthYearFrom: 1900, birthYearTo: 1800 }),
    ).toThrow(/birthYearFrom must be <= birthYearTo/);
  });

  it("6b. throws when a year is not 4 digits", () => {
    expect(() =>
      validateInput({ ...VALID_QUERY, birthYearFrom: 99, birthYearTo: 99 }),
    ).toThrow(/must be a 4-digit year/);
  });

  it("7. throws on sex outside Male/Female/Unknown (case-insensitive accepted)", () => {
    expect(() => validateInput({ ...VALID_QUERY, sex: "X" })).toThrow(
      /sex must be 'Male', 'Female', or 'Unknown'/,
    );
    expect(() =>
      validateInput({ ...VALID_QUERY, sex: "male" }),
    ).not.toThrow();
  });
});

// ─── URL building ───────────────────────────────────────────────────────

describe("buildSearchUrl", () => {
  it("8. maps core q.* params and targets the platform endpoint", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      givenName: "Abraham",
      sex: "Male",
    });
    expect(url).toContain("https://api.familysearch.org/platform/tree/search?");
    expect(url).toContain("q.surname=Lincoln");
    expect(url).toContain("q.givenName=Abraham");
    expect(url).toContain("q.sex=Male");
  });

  it("9. surnameExact emits q.surname.exact=on", () => {
    const url = buildSearchUrl({ ...VALID_QUERY, surnameExact: true });
    expect(url).toContain("q.surname.exact=on");
  });

  it("10. birthYearFrom/To emit q.birthLikeDate.from/.to; birthYearExact emits .exact=on", () => {
    const url = buildSearchUrl({
      ...VALID_QUERY,
      birthYearFrom: 1809,
      birthYearTo: 1810,
      birthYearExact: true,
    });
    expect(url).toContain("q.birthLikeDate.from=1809");
    expect(url).toContain("q.birthLikeDate.to=1810");
    expect(url).toContain("q.birthLikeDate.exact=on");
  });

  it("10b. places and relatives map to the right q.* params", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      birthPlace: "Kentucky",
      residenceYearFrom: 1860,
      residenceYearTo: 1860,
      spouseGivenName: "Mary",
      spouseSurname: "Todd",
    });
    expect(url).toContain("q.birthLikePlace=Kentucky");
    expect(url).toContain("q.residenceDate.from=1860");
    expect(url).toContain("q.spouseGivenName=Mary");
    expect(url).toContain("q.spouseSurname=Todd");
  });

  it("11. fatherBirthPlace maps to q.fatherBirthLikePlace", () => {
    const url = buildSearchUrl({ ...VALID_QUERY, fatherBirthPlace: "Virginia" });
    expect(url).toContain("q.fatherBirthLikePlace=Virginia");
  });

  it("12. sends m.queryRequireDefault=on and default count/offset", () => {
    const url = buildSearchUrl(VALID_QUERY);
    expect(url).toContain("m.queryRequireDefault=on");
    expect(url).toContain("count=20");
    expect(url).toContain("offset=0");
  });
});

// ─── Headers / host contract ────────────────────────────────────────────

describe("personSearchTool request headers", () => {
  it("13. sends Accept-Language: en and the atom Accept header", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await personSearchTool(VALID_QUERY);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept-Language"]).toBe("en");
    expect(headers["Accept"]).toBe("application/x-gedcomx-atom+json");
    expect(headers["Authorization"]).toBe("Bearer test-token");
  });

  it("14. does NOT send a User-Agent header (platform host needs none)", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await personSearchTool(VALID_QUERY);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBeUndefined();
  });
});

// ─── Mapping: lean output ───────────────────────────────────────────────

describe("mapEntry / lean output", () => {
  it("15. gedcomx carries the matched person's name, gender, ark, and facts", () => {
    const result = mapEntry(lincolnTreeEntry());
    expect(result).not.toBeNull();
    const person = result!.gedcomx.persons![0];
    expect(person.id).toBe("LZJW-C31");
    expect(person.gender).toBe("Male");
    expect(person.ark).toBe("https://familysearch.org/ark:/61903/4:1:LZJW-C31");
    expect(person.names![0].given).toBe("Abraham");
    expect(person.names![0].surname).toBe("Lincoln");
    const birth = person.facts!.find((f) => f.type === "Birth");
    expect(birth?.date).toBe("12 Feb 1809");
    expect(birth?.place).toBe("Hardin, Kentucky, United States");
  });

  it("16. resolves the matched person by entry.id even when not first in the cluster", () => {
    const entry = lincolnTreeEntry();
    // Reverse the cluster so the matched person (entry.id) is last.
    entry.content!.gedcomx!.persons!.reverse();
    const person = findMatchedPerson(entry);
    expect(person?.id).toBe("LZJW-C31");
    const result = mapEntry(entry);
    expect(result!.gedcomx.persons![0].id).toBe("LZJW-C31");
  });

  it("17. gedcomx contains only the matched person — no relatives, no relationships", () => {
    const result = mapEntry(lincolnTreeEntry());
    expect(result!.gedcomx.persons).toHaveLength(1);
    expect(result!.gedcomx.persons![0].id).toBe("LZJW-C31");
    expect(result!.gedcomx.relationships).toBeUndefined();
  });

  it("17b. carries no flat summary fields beyond personId/score/confidence/gedcomx", () => {
    const result = mapEntry(lincolnTreeEntry())!;
    expect(Object.keys(result).sort()).toEqual(
      ["confidence", "gedcomx", "personId", "score"].sort(),
    );
  });

  it("17c. strips per-person source references (dangling IDs) from the gedcomx", () => {
    // The fixture's matched person carries source references; the lean
    // output must drop them (full sources come from person_read).
    const result = mapEntry(lincolnTreeEntry())!;
    expect(result.gedcomx.persons![0].sources).toBeUndefined();
  });
});

// ─── Envelope + pagination ──────────────────────────────────────────────

describe("personSearchTool envelope", () => {
  it("18. sets hasMore: true when links.next exists", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({
        results: 100,
        index: 0,
        links: { next: { href: "https://api.familysearch.org/platform/tree/search?offset=20" } },
        entries: [lincolnTreeEntry()],
      }),
    );
    const result = await personSearchTool(VALID_QUERY);
    expect(result.hasMore).toBe(true);
  });

  it("19. echoes totalMatches and paginationCappedAt", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 42, index: 0, entries: [] }),
    );
    const result = await personSearchTool(VALID_QUERY);
    expect(result.totalMatches).toBe(42);
    expect(result.paginationCappedAt).toBe(4999);
    expect(result.hasMore).toBe(false);
  });
});

// ─── Zero-match handling ────────────────────────────────────────────────

describe("personSearchTool zero matches", () => {
  it("20a. returns empty results on 200 with empty entries", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 0, index: 0, entries: [] }),
    );
    const result = await personSearchTool(VALID_QUERY);
    expect(result.results).toEqual([]);
    expect(result.returned).toBe(0);
  });

  it("20b. returns empty results on 204 No Content", async () => {
    mockFetch.mockResolvedValueOnce(make204Response());
    const result = await personSearchTool(VALID_QUERY);
    expect(result.results).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.totalMatches).toBe(0);
  });
});

// ─── Errors ─────────────────────────────────────────────────────────────

describe("personSearchTool errors", () => {
  it("21. propagates the auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate."),
    );
    await expect(personSearchTool(VALID_QUERY)).rejects.toThrow(/not logged in/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("22a. throws on 401 with re-login guidance", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(401, "Unauthorized"));
    await expect(personSearchTool(VALID_QUERY)).rejects.toThrow(
      /session not accepted; call the login tool/,
    );
  });

  it("22b. throws on 400 with extracted error detail", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, "Bad Request", {
        errors: [{ message: "invalid date" }],
      }),
    );
    await expect(personSearchTool(VALID_QUERY)).rejects.toThrow(
      /rejected the query: invalid date/,
    );
  });

  it("22c. throws a generic error on other non-OK status", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, "Server Error"));
    await expect(personSearchTool(VALID_QUERY)).rejects.toThrow(
      /tree search API error: 500/,
    );
  });
});
