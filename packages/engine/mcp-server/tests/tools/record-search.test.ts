import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// FamilySearch's matcher unless a test names the service: LOCAL reads the
// developer's own config.json, which may name the service.
const matcherSettingsMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/config.js", async (orig) => ({
  ...(await orig<typeof import("../../src/auth/config.js")>()),
  getMatcherSettings: matcherSettingsMock,
}));

// Place standardization runs inside the converter now; stub the network
// resolver so these tool tests stay offline and deterministic (no standard_place
// is added — that behavior is covered in gedcomx-standardize.test.ts).
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    ...actual,
    resolveStandardPlace: vi.fn().mockResolvedValue(null),
    // No place expansion unless a test asks for one (issue #4067), so the
    // ordered fetch mocks below keep meaning "the one search request".
    placeSearchNames: vi.fn().mockResolvedValue(null),
  };
});

import {
  recordSearchTool,
  buildSearchUrl,
  applyAltNameAutoPair,
  validateInput,
  mapEntry,
  findRepresentedPerson,
  parseUpstreamErrorBody,
  recordSearchToolSchema,
} from "../../src/tools/record-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { placeSearchNames } from "../../src/utils/place-resolver.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import { toSimplified } from "../../src/utils/gedcomx-convert.js";
import type { GedcomX } from "../../src/types/gedcomx.js";
import type {
  FSSearchEntry,
  FSSearchResponse,
  RecordSearchToolResponse,
} from "../../src/types/record-search.js";
import { compactStagedRecordSearch } from "../../src/utils/staged-compaction.js";
import type { KinPrefix, KinTerm } from "../../src/types/relative-terms.js";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
  matcherSettingsMock.mockReset();
  matcherSettingsMock.mockResolvedValue({ backend: "familysearch" });
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

/** FamilySearch's matchTwoExamples answer: one candidate at `score`. */
function matchResponse(score: number) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      entries: [{ id: "https://familysearch.org/ark:/61903/4:1:KCWM-J9H", score }],
      results: 1,
      title: "Matches for ark:/61903/4:1:KGS8-LY1",
      updated: "2026-10-30T00:00:00.000Z",
    }),
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

describe("recordSearchTool happy path", () => {
  it("1. returns ranked results for surname + givenName", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 432, index: 0, entries: [lincolnEntry()] })
    );

    const result = await recordSearchTool({ surname: "Lincoln", givenName: "Abraham" }, LOCAL);

    expect(result.totalMatches).toBe(432);
    expect(result.returned).toBe(1);
    expect(result.results![0].recordId).toBe("ark:/61903/1:1:QPRC-WPBZ");
    expect(result.results![0].personName).toBe("Abraham Lincoln");
    // Always 4999, so the answer drops it (staged-compaction.ts).
    expect(result).not.toHaveProperty("paginationCappedAt");
  });

  it("2. returns results for country-scoped search (recordCountry only)", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    const result = await recordSearchTool({
      recordCountry: "United States",
      givenName: "John",
    }, LOCAL);
    expect(result.results).toEqual([]);
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("q.recordCountry=United%20States");
  });

  it("3. surnameAlt-only triggers UNION + auto-pairs givenNameAlt", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await recordSearchTool({
      givenName: "Mary",
      surname: "Lincoln",
      surnameAlt: "Todd",
    }, LOCAL);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.surname.1=Todd");
    expect(url).toContain("q.givenName.1=Mary");
  });

  it("4. givenNameAlt-only triggers UNION + auto-pairs surnameAlt", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await recordSearchTool({
      givenName: "Mary",
      surname: "Lincoln",
      givenNameAlt: "May",
    }, LOCAL);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.givenName.1=May");
    expect(url).toContain("q.surname.1=Lincoln");
  });
});

describe("recordSearchTool input validation", () => {
  it("5. throws when no anchor is supplied", async () => {
    await expect(
      recordSearchTool({ givenName: "John", birthPlace: "Kentucky" }, LOCAL)
    ).rejects.toThrow(/at least one anchor/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // `batchNumber` anchors alone (see the anchor-rule note in the spec). This is
  // the assertion that would have caught the original rule: a batch-only call
  // is accepted upstream and is the canonical parish enumeration, but
  // validateInput rejected it, so the one strategy collection-quirks.md
  // recommends for IGI registers could not be executed.
  it("5a. accepts batchNumber as the only anchor", () => {
    expect(() => validateInput({ batchNumber: "B01883-5" })).not.toThrow();
  });

  // The error message names every anchor. It named two while accepting three,
  // which tells the model to add a field it must not add: an unmatched
  // recordCountry on a batch search silently returns 0.
  it("5b. the anchor error names batchNumber", () => {
    expect(() => validateInput({ givenName: "John" })).toThrow(/batchNumber/);
  });

  // The structural half of the batch rule. Prose survives about three
  // compactions (docs/architecture.md §3.1), and the pairing this rejects is
  // precisely what a half-remembered "every query needs surname or
  // recordCountry" produces. Rejecting is free: a MATCHING country returns an
  // identical count, so the field never buys anything on a batch search.
  it("5c. rejects batchNumber combined with recordCountry", () => {
    expect(() =>
      validateInput({ batchNumber: "B01883-5", recordCountry: "England" })
    ).toThrow(/do not combine batchNumber with recordCountry/);
  });

  // ...and the permitted narrowing still works, so 5c cannot be satisfied by
  // rejecting every companion field.
  it("5d. allows batchNumber combined with surname", () => {
    expect(() =>
      validateInput({ batchNumber: "B01883-5", surname: "Smith" })
    ).not.toThrow();
  });

  // `recordSubdivision` is the same class of record-jurisdiction filter and
  // carries the same silent-zero risk. Without it named here the invariant
  // still held — batch + subdivision with no country trips "recordSubdivision
  // requires recordCountry" — but that error points the model at the one field
  // the batch rule forbids, costing a round-trip to arrive at the same place.
  it("5e. rejects batchNumber combined with recordSubdivision", () => {
    expect(() =>
      validateInput({ batchNumber: "B01883-5", recordSubdivision: "Alabama" })
    ).toThrow(/do not combine batchNumber with recordCountry or recordSubdivision/);
  });

  it("6. throws when count > 100 or count < 1", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", count: 200 }, LOCAL)
    ).rejects.toThrow(/count must be between 1 and 100/);
    await expect(
      recordSearchTool({ surname: "Lincoln", count: 0 }, LOCAL)
    ).rejects.toThrow(/count must be between 1 and 100/);
  });

  it("7. throws when offset + count > 4999", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", offset: 4998, count: 3 }, LOCAL)
    ).rejects.toThrow(/offset \+ count must be <= 4999/);
  });

  it("8. throws when YearFrom is supplied without YearTo", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", birthYearFrom: 1809 }, LOCAL)
    ).rejects.toThrow(/birthYearFrom and birthYearTo must be provided together/);
  });

  it("9. throws when YearFrom > YearTo", async () => {
    await expect(
      recordSearchTool({
        surname: "Lincoln",
        birthYearFrom: 1850,
        birthYearTo: 1849,
      }, LOCAL)
    ).rejects.toThrow(/birthYearFrom must be <= birthYearTo/);
  });

  it("10. throws when recordSubdivision is supplied without recordCountry", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", recordSubdivision: "Alabama" }, LOCAL)
    ).rejects.toThrow(/recordSubdivision requires recordCountry/);
  });

  it("11. throws on sex outside Male/Female/Unknown", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", sex: "M" }, LOCAL)
    ).rejects.toThrow(/sex must be 'Male', 'Female', or 'Unknown'/);
  });

  it("11b. accepts case-insensitive sex", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    await recordSearchTool({ surname: "Lincoln", sex: "male" }, LOCAL);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("q.sex=Male");
  });

  it("12. throws on maritalStatus outside the four allowed values", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", maritalStatus: "married" }, LOCAL)
    ).rejects.toThrow(/maritalStatus must be exactly one of/);
  });

  it("13. throws on recordType outside the eight allowed values", async () => {
    await expect(
      recordSearchTool({ surname: "Lincoln", recordType: "wedding" as never }, LOCAL)
    ).rejects.toThrow(/recordType must be one of/);
  });

  // The guard used `recordType in RECORD_TYPE_TO_INT`, and `in` walks the
  // prototype chain — so "constructor" passed validation and buildSearchUrl
  // then indexed out `Object`, sending
  // `f.recordType=function%20Object()%20{%20[native%20code]%20}` upstream.
  // All twelve Object.prototype own names reached here, not just this one —
  // "constructor" and "__proto__" are the all-lowercase pair a model is likeliest
  // to emit, and the tool schema's enum is not a runtime guard. hasOwn rejects
  // every one of the twelve; the loop below asserts that rather than one sample.
  it("13a. throws on an inherited Object.prototype key as recordType", () => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      expect(() =>
        validateInput({ surname: "Lincoln", recordType: key as never })
      ).toThrow(/recordType must be one of/);
    }
  });

  it("13b. never emits a non-numeric f.recordType", () => {
    const url = buildSearchUrl({
      surname: "Lincoln",
      recordType: "constructor" as never,
    });
    expect(url).not.toMatch(/f\.recordType=(?!\d+(&|$))/);
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

  // Issue #2071. A particle surname is passed through VERBATIM, percent-encoded
  // and unquoted. No unit test passed a surname containing a space before this.
  //
  // This pins the STRING THE TOOL BUILDS, which is the only half CI can see
  // (spec row 20a). That FamilySearch honours it is a separate, live claim, and
  // it is measured in section K of dev/probe-search-qualifiers.ts, not here.
  //
  // The probe is also why this test asserts the ABSENCE of quotes rather than
  // adding them: `name-search-mechanics.md` prescribes literal quotes, and the
  // server strips them before matching (bare and unbalanced-quote queries both
  // return 900,650). Quoting is inert, so emitting it would add an encoded pair
  // of `%22`s to every multi-word surname for no measured gain.
  it("15a. a particle surname is sent verbatim, space-encoded and unquoted", () => {
    const url = buildSearchUrl({ surname: "van der Linde" });
    expect(url).toContain("q.surname=van%20der%20Linde");
    expect(url).not.toContain("%22");
    // Not split into surname + surnameAlt, and not concatenated.
    expect(url).not.toContain("q.surname.1=");
    expect(url).not.toContain("vanderLinde");
  });

  it("15b. the space survives round-tripping the built URL", () => {
    const url = buildSearchUrl({ surname: "van der Linde", givenName: "Marinus" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q.surname")).toBe("van der Linde");
    expect(parsed.searchParams.get("q.givenName")).toBe("Marinus");
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

  it("18. recordSubdivision composes into f.recordSubcountry=country,subdivision", () => {
    const url = buildSearchUrl({
      surname: "Smith",
      recordCountry: "United States",
      recordSubdivision: "Alabama",
    });
    expect(url).toContain(
      "f.recordSubcountry=United%20States%2CAlabama"
    );
    expect(url).not.toContain("q.recordSubcountry");
  });

  it("18b. a hyphenated recordSubdivision is sent as the f. facet filter", () => {
    const url = buildSearchUrl({
      surname: "Olsen",
      recordCountry: "Norway",
      recordSubdivision: "Aust-Agder",
    });
    expect(url).toContain("f.recordSubcountry=Norway%2CAust-Agder");
  });

  it("19. recordType=marriage maps to f.recordType=1", () => {
    const url = buildSearchUrl({ surname: "Smith", recordType: "marriage" });
    expect(url).toContain("f.recordType=1");
  });

  // Issue #3547: a search built straight from a plan item is not refused.
  // Issue #3547: a plan item's record_type searches where its records are
  // indexed (dev/probe-record-type-aliases.ts), one f.recordType per type.
  it.each([
    ["land", [7]],
    ["tax", [7, 3]],
    ["court", [7, 6]],
    ["vital_record", [0, 1, 2]],
    ["church", [0, 1, 2]],
    ["cemetery", [2]],
  ])("19a. plan type %s sends f.recordType %j", (type, codes) => {
    expect(() => validateInput({ surname: "Smith", recordType: type as never })).not.toThrow();
    const url = buildSearchUrl({ surname: "Smith", recordType: type as never });
    const sent = [...url.matchAll(/f\.recordType=(\d+)/g)].map((m) => Number(m[1]));
    expect(sent).toEqual(codes);
  });

  it("19b. an upstream type still sends exactly one f.recordType", () => {
    const url = buildSearchUrl({ surname: "Smith", recordType: "census" });
    expect([...url.matchAll(/f\.recordType=/g)]).toHaveLength(1);
    expect(url).toContain("f.recordType=3");
  });

  it("19c. the schema enum advertises the plan types it accepts", () => {
    const values = (recordSearchToolSchema as any).inputSchema.properties.recordType.enum;
    expect(values).toEqual(expect.arrayContaining(["vital_record", "church", "cemetery", "land", "court", "tax"]));
  });

  it("20. default flags m.queryRequireDefault=on and m.defaultFacets=off are sent", () => {
    const url = buildSearchUrl({ surname: "Lincoln" });
    expect(url).toContain("m.queryRequireDefault=on");
    expect(url).toContain("m.defaultFacets=off");
  });

  it("21b. imageGroupNumber maps to q.filmNumber", () => {
    const url = buildSearchUrl({ surname: "Smith", imageGroupNumber: "004010852" });
    expect(url).toContain("q.filmNumber=004010852");
  });

  it("21c. imageGroupNumber accepts split DGS format", () => {
    const url = buildSearchUrl({ surname: "Smith", imageGroupNumber: "004010852_001_M9QY-X6Y" });
    expect(url).toContain("q.filmNumber=004010852_001_M9QY-X6Y");
  });

  // The PR's one behaviour change, and it was the only one with no guard: the
  // mapping is real (buildSearchUrl emits `q.batchNumber`) but nothing asserted
  // it, so a rename would have gone unnoticed while the skill and the spec both
  // kept teaching the parameter.
  it("21d. batchNumber maps to q.batchNumber", () => {
    const url = buildSearchUrl({ surname: "Wilkins", batchNumber: "M01048-5" });
    expect(url).toContain("q.batchNumber=M01048-5");
  });

  // Batch shape is open, not a rule: the documented form has been narrowed and
  // then corrected twice (`exactly 6 digits after a letter prefix`, then `a
  // letter prefix followed by digits`), and both were too narrow. So the
  // contract asserted here is passthrough — whatever shape the caller was given
  // reaches `q.batchNumber` byte-for-byte. A wrong batch returns 0 rather than
  // erroring, so any reformatting this tool did would be indistinguishable from
  // an empty parish. Leading zeros are the case that has to survive.
  it.each([
    ["letter + 6 digits", "C050761"],
    ["dashed", "M01048-5"],
    ["all-numeric", "7501234"],
    ["leading zero", "0501234"],
  ])("21e. batchNumber passes the %s form through unaltered", (_shape, batch) => {
    // Batch only, deliberately: the batch anchors by itself, and adding
    // `recordCountry` is the one thing the docs tell callers never to do here.
    const url = buildSearchUrl({ batchNumber: batch });
    expect(url).toContain(`q.batchNumber=${batch}`);
  });
});

describe("recordSearchTool error propagation", () => {
  it("21. throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockReset();
    mockedGetValidToken.mockRejectedValueOnce(
      new Error(
        "User is not logged in to FamilySearch. Call the login tool to authenticate."
      )
    );
    await expect(
      recordSearchTool({ surname: "Lincoln" }, LOCAL)
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
      recordSearchTool({ surname: "Lincoln" }, LOCAL)
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
      recordSearchTool({ surname: "Lincoln" }, LOCAL)
    ).rejects.toThrow(/400 Bad Request/);
  });

  it("24. throws on 401 with re-login guidance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /session not accepted; call the login tool/
    );
  });

  it("25. throws on 403 with WAF/UA guidance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /User-Agent header was rejected by the WAF/
    );
  });

  // #1316: a per-attempt AbortSignal.timeout is passed to fetch so a stalled
  // FamilySearch connection can't hang the turn.
  it("passes an AbortSignal timeout to fetch", async () => {
    mockFetch.mockResolvedValue(makeOkResponse(emptyResponse()));
    await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // #1316: a transient blip must not be fatal — withRetry retries before failing.
  it("retries a transient network failure, then succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const result = await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    expect(result.returned).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // #1316 / #2054: 5xx is transient — retried by fetchWithRetry then, when
  // exhausted, the last Response is returned and falls through to !response.ok.
  it("retries 5xx and throws the generic API-error when exhausted", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers(),
    });
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /coverage is unknown/
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // #2054: 429 then 200 → returns the successful result
  it("recovers from a transient 429 and returns the search result", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
      })
      .mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const result = await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    expect(result.returned).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // #1316 / #2054: 429 is retried alongside 5xx by fetchWithRetry.
  it("retries 429 and throws when exhausted", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers(),
    });
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /rate limit/
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // #1316 / #2054: a timeout (AbortSignal firing → fetch rejects) is transient
  // too. fetchWithRetry re-throws the last error after exhaustion, caught by
  // the try/catch in recordSearchTool.
  it("retries a timeout and throws the terminal error when exhausted", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("The operation timed out"), {
        name: "TimeoutError",
      })
    );
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /did not complete after retries.*network timeout or transient error/s
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // #1316: non-retryable non-OK statuses (e.g. 404) are NOT retried and keep the
  // existing generic message — only 429/5xx became transient.
  it("does not retry a 404 and keeps the generic API-error message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    await expect(recordSearchTool({ surname: "Lincoln" }, LOCAL)).rejects.toThrow(
      /API error: 404 Not Found/
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("recordSearchTool response shape", () => {
  it("26. returns empty results when entries is empty", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const result = await recordSearchTool({ surname: "Nobody" }, LOCAL);
    expect(result.results).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("27. maps entry → RecordSearchResult using display first, facts fallback", async () => {
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
    const result = await recordSearchTool({ surname: "Doe" }, LOCAL);
    const r = result.results![0];
    expect(r.personName).toBe("John Doe");
    expect(r.sex).toBe("Male");
    expect(r.birthDate).toBe("1880");
    expect(r.birthPlace).toBe("Texas");
    expect(r.collectionId).toBe("9999");
    expect(result.collections).toEqual({ "9999": "Texas Births" });
  });

  it("28. surfaces treeMatches from entry.hints sorted by stars descending", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] })
    );
    const result = await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    const matches = result.results![0].treeMatches;
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
    const represented = findRepresentedPerson(entry);
    expect(represented?.person.display?.name).toBe("Second Person");
    // Matched by ark, not by the `principal` fallback — both persons here are
    // flagged principal, so only the ark match can pick the right one. #1324
    // refuses to resolve relatives on a `principal` anchor, which makes this
    // distinction load-bearing rather than cosmetic.
    expect(represented?.anchor).toBe("ark");
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
    const result = await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    expect(result.hasMore).toBe(true);
  });

  it("31. echoes totalMatches, and the query when nothing staged, but not paginationCappedAt", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 17, index: 0, entries: [] })
    );
    const result = await recordSearchTool({ surname: "Lincoln" }, LOCAL);
    expect(result.totalMatches).toBe(17);
    expect(result.query).toEqual({ surname: "Lincoln" });
    expect(result).not.toHaveProperty("paginationCappedAt");
  });
});

describe("recordSearchTool gedcomx + primaryId passthrough", () => {
  it("32. mapEntry carries simplified gedcomx and the focus person's id", () => {
    const entry = lincolnEntry();
    const result = mapEntry(entry)!;
    expect(result.primaryId).toBe("p_1");
    expect(result.gedcomx).toEqual(
      toSimplified(entry.content!.gedcomx as unknown as GedcomX)
    );
  });

  it("33. primaryId identifies a person present in the carried gedcomx", () => {
    const result = mapEntry(lincolnEntry())!;
    expect(
      result.gedcomx?.persons?.some((p) => p.id === result.primaryId)
    ).toBe(true);
  });

  it("34. carries gedcomx but omits primaryId when the persona has no id", () => {
    const entry: FSSearchEntry = {
      id: "ZZZZ-9999",
      content: {
        gedcomx: {
          persons: [
            {
              principal: true,
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  "https://familysearch.org/ark:/61903/1:1:ZZZZ-9999",
                ],
              },
              display: { name: "No Id Person" },
            },
          ],
        },
      },
    };
    const result = mapEntry(entry)!;
    expect(result.primaryId).toBeUndefined();
    expect(result.gedcomx).toBeDefined();
    expect(result.gedcomx?.persons?.[0]?.ark).toBe(
      "ark:/61903/1:1:ZZZZ-9999"
    );
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

  it("mapEntry attaches the simplified gedcomx and primaryId for tool chaining", () => {
    const result = mapEntry(lincolnEntry());
    expect(result).not.toBeNull();

    // primaryId points at the focus person inside gedcomx.persons[].
    expect(result!.primaryId).toBe("p_1");

    // gedcomx is the simplified shape: flat `ark` lifted from the raw
    // identifiers map, and fact types stripped of the gedcomx.org URI.
    const person = result!.gedcomx?.persons?.[0];
    expect(person?.id).toBe("p_1");
    expect(person?.ark).toBe(
      "ark:/61903/1:1:QPRC-WPBZ"
    );
    expect(person?.facts?.[0].type).toBe("Birth");

    // primaryId must match a persons[].id so same_person can
    // anchor on the focus person.
    const ids = result!.gedcomx?.persons?.map((p) => p.id) ?? [];
    expect(ids).toContain(result!.primaryId);
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

  it("parseUpstreamErrorBody reads the Catalog's RFC7807 detail", () => {
    expect(
      parseUpstreamErrorBody({
        detail: "Validation failure",
        instance: "/v3/search",
        status: 400,
        title: "Bad Request",
      })
    ).toBe("Validation failure");
  });

  it("parseUpstreamErrorBody falls through to detail when errors yields nothing", () => {
    // PRESENT but unusable is not the same as absent. Branching on the
    // array's shape up front returned null and lost the only readable
    // explanation the body carried.
    expect(
      parseUpstreamErrorBody({
        errors: [{ code: 400 }],
        detail: "Validation failure",
      })
    ).toBe("Validation failure");
  });

  it("parseUpstreamErrorBody prefers errors[] over a generic detail", () => {
    // Pins the ORDER. `detail` is generic ("Bad Request"); errors[].message
    // names the offending parameter, which is what three callers' messages
    // were built around. Checking detail first silently swapped them.
    expect(
      parseUpstreamErrorBody({
        detail: "Bad Request",
        errors: [{ message: "q.birthLikeDate.from must precede .to" }],
      })
    ).toBe("q.birthLikeDate.from must precede .to");
  });
});

describe("recordSearchTool — User-Agent contract", () => {
  it("sends the shared BROWSER_USER_AGENT header", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    await recordSearchTool({ surname: "Lincoln" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
  });
});

describe("recordSearchTool — inline compaction", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-search-omit-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const oneResult = (): FSSearchResponse => ({
    results: 1,
    index: 0,
    entries: [lincolnEntry()],
  });

  describe("unlogged-search notes (#2056)", () => {
    const writeResearch = async (log: unknown[]) =>
      writeFile(join(dir, "research.json"), JSON.stringify({ log }, null, 2), "utf-8");

    it("emits the unlogged-search note when a prior staged search was never finalized", async () => {
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      const first = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(first.staged).toBeTruthy();
      // Nothing logged that first search, so the second one says so.
      expect(first.unloggedSearches).toBeUndefined();

      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      const second = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(second.unloggedSearches).toContain("1 earlier staged search");
      expect(second.unloggedSearches).toContain("research_log_append");
    });

    it("counts the backlog before this call stages, so a first search never accuses itself", async () => {
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(out.staged).toBeTruthy();
      expect(out.unloggedSearches).toBeUndefined();
    });

    it("serializes both notes before results", async () => {
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

      // Nil second search: both notes fire at once, and both must precede the
      // largest field — a trailing field is the first thing a size bound drops.
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 0, index: 0, entries: [] }),
      );
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(out.unloggedSearches).toBeTruthy();
      expect(out.nilSearchNeedsLog).toBeTruthy();

      const keys = Object.keys(out);
      expect(keys.indexOf("unloggedSearches")).toBeLessThan(keys.indexOf("results"));
      expect(keys.indexOf("nilSearchNeedsLog")).toBeLessThan(keys.indexOf("results"));
    });

    it("asks for a negative log entry on a nil projectPath search", async () => {
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 0, index: 0, entries: [] }),
      );
      const out = await recordSearchTool({ surname: "Nonesuch", projectPath: dir }, LOCAL);
      expect(out.staged).toBeNull();
      expect(out.nilSearchNeedsLog).toContain('outcome: "negative"');
    });

    it("does not ask for a negative log entry when entries failed mapping but matches exist", async () => {
      // `mapEntry` returns null on a missing represented person or a missing
      // `entry.id`, so a page can map to zero results while the corpus holds 812
      // matches. Keying the note on `results.length` alone would order an
      // `outcome: "negative"` entry for a query that has hits — and the log is
      // append-only, so a wrong negative can only be corrected by a later append.
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({
          results: 812,
          index: 0,
          entries: [{ id: undefined } as unknown as FSSearchEntry],
        }),
      );
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

      expect(out.results).toHaveLength(0);
      expect(out.totalMatches).toBe(812);
      expect(out.nilSearchNeedsLog).toBeUndefined();
    });

    it("says nothing about logging when no projectPath was supplied", async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 0, index: 0, entries: [] }),
      );
      const out = await recordSearchTool({ surname: "Nonesuch" }, LOCAL);
      expect(out.nilSearchNeedsLog).toBeUndefined();
      expect(out.unloggedSearches).toBeUndefined();
    });

    it("withholds both notes from the staged payload", async () => {
      await writeResearch([]);
      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

      mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(out.unloggedSearches).toBeTruthy();

      const envelope = JSON.parse(
        await readFile(join(dir, out.staged!.resultsRef), "utf-8"),
      );
      // The sidecar records what the search RETURNED, not instructions to the model.
      expect(envelope.payload.unloggedSearches).toBeUndefined();
      expect(envelope.payload.nilSearchNeedsLog).toBeUndefined();
    });
  });

  it("strips inline results[].gedcomx whenever staging succeeds, keeping the stub", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({
      surname: "Lincoln",
      projectPath: dir,
    }, LOCAL);

    // Staging happened, so the inline gedcomx is dropped unconditionally (no
    // opt-in flag); the flat stub survives for triage.
    expect(out.staged).toBeTruthy();
    expect(out.results).toHaveLength(1);
    expect(out.results![0].gedcomx).toBeUndefined();
    expect(out.results![0].recordId).toBeTruthy();
    // The answer drops what only the staged file's readers use; the file keeps it.
    expect(out.results![0]).not.toHaveProperty("primaryId");
    expect(out).not.toHaveProperty("query");
    expect(out).not.toHaveProperty("paginationCappedAt");
    const staged = JSON.parse(await readFile(join(dir, out.staged!.resultsRef), "utf-8"));
    expect(staged.payload.results[0].primaryId).toBe("p_1");
    expect(staged.payload.query).toMatchObject({ surname: "Lincoln" });
    expect(staged.payload.paginationCappedAt).toBe(4999);
  });

  it("slims the inline stub when staged: no collectionUrl, no empty treeMatches, title hoisted", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    expect(out.staged).toBeTruthy();
    const r = out.results![0];
    // Derivable / repeated fields are gone from the INLINE projection.
    expect(r.collectionUrl).toBeUndefined();
    expect(r.collectionTitle).toBeUndefined();
    // …and the repeated title says the same thing once, response-level.
    expect(Object.keys(out.collections!)).toEqual([r.collectionId!]);
    expect(out.collections![r.collectionId!]).toBeTruthy();
    // This fixture carries hints, so treeMatches is real signal and is kept.
    expect(r.treeMatches?.length).toBeGreaterThan(0);
    // rank_search_matches reads primaryId from the staged file, not the answer.
    expect(r).not.toHaveProperty("primaryId");
  });

  it("ranks host-side when subjectId is supplied, and defaults count to 50", async () => {
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [{ id: "I1", names: [{ preferred: true, given: "A", surname: "B" }], facts: [{ type: "Birth", date: "1900", place: "X" }] }],
      }),
      "utf-8",
    );
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "I1" }, LOCAL);

    // The deep pool is requested only because ranking will cut it back.
    expect(mockFetch.mock.calls[0][0]).toContain("count=50");
    expect(out.ranked).toBeTruthy();
    expect(out.ranked!.subjectId).toBe("I1");
    expect(out.rankingError).toBeUndefined();
  });

  it.each([
    ["1900", true],
    ["4 Dec 1900", undefined],
  ])("carries ranked.subjectTooThin through the folded path (birth %j → %j)", async (date, flag) => {
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [{ id: "I1", names: [{ preferred: true, given: "A", surname: "B" }], facts: [{ type: "Birth", date, place: "X" }] }],
      }),
      "utf-8",
    );
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "I1" }, LOCAL);

    expect(out.rankingError).toBeUndefined();
    expect(out.ranked!.subjectTooThin).toBe(flag);
  });

  it("keeps count at 20 when there is no subject to rank against", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    // An unranked deep pool is just more stubs to read — the two are coupled.
    expect(mockFetch.mock.calls[0][0]).toContain("count=20");
  });

  it("a ranking failure never fails the search", async () => {
    // No tree.gedcomx.json in this project dir → buildSubjectDoc throws.
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "I1" }, LOCAL);

    expect(out.ranked).toBeUndefined();
    expect(out.rankingError).toBeTruthy();
    // The search itself is intact and usable unranked — the graceful
    // degradation the two-tool split originally existed to protect.
    expect(out.results).toHaveLength(1);
    expect(out.staged).toBeTruthy();
  });

  it("does not rank when nothing was staged", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", subjectId: "I1" }, LOCAL);

    expect(out.ranked).toBeUndefined();
    expect(out.rankingError).toBeUndefined();
  });

  it("drops treeMatches only when it is empty", async () => {
    const noHints = JSON.parse(JSON.stringify(lincolnEntry()));
    delete noHints.hints;
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 1, index: 0, entries: [noHints] }),
    );

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
    expect(out.results![0].treeMatches).toBeUndefined();
  });

  it("leaves the staged sidecar at full fidelity even though the inline copy is slimmed", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
    expect(out.results![0].collectionUrl).toBeUndefined();

    const staged = JSON.parse(
      await readFile(join(dir, out.staged!.resultsRef), "utf-8"),
    );
    const row = staged.payload.results![0];
    // The sidecar is what rank_search_matches, record_read and the viewer read.
    expect(row.gedcomx).toBeTruthy();
    expect(row.collectionUrl).toBeTruthy();
    expect(row.collectionTitle).toBeTruthy();
    expect(row.treeMatches).toBeDefined();
  });

  it("compacts the answer when staging returned null", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    // A non-existent projectPath makes stageSearchResults throw → staged: null.
    const out = await recordSearchTool({
      surname: "Lincoln",
      projectPath: join(dir, "does-not-exist"),
    }, LOCAL);

    expect(out.staged).toBeNull();
    expect(out.stagingError).toBeTruthy();
    // Every answer is compacted, staged or not (issue #4386).
    const r = out.results![0];
    expect(r.gedcomx).toBeUndefined();
    expect(r.collectionUrl).toBeUndefined();
    expect(r.collectionTitle).toBeUndefined();
    expect(out.collections).toEqual({ [r.collectionId!]: "Some Collection" });
  });

  it("compacts the answer of a search with no projectPath", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({
      surname: "Lincoln",
    }, LOCAL);

    expect(out.staged).toBeUndefined();
    const r = out.results![0];
    expect(r.gedcomx).toBeUndefined();
    expect(r.collectionUrl).toBeUndefined();
    expect(r.collectionTitle).toBeUndefined();
    expect(out.collections).toEqual({ [r.collectionId!]: "Some Collection" });
    // The flat stub fields a caller triages on, and record_read's input, stay.
    expect(r.recordId).toBe("ark:/61903/1:1:QPRC-WPBZ");
    expect(r).not.toHaveProperty("primaryId");
    expect(r.personName).toBe("Abraham Lincoln");
    // Nothing staged, so the query echo is the only copy and stays.
    expect(out.query).toEqual({ surname: "Lincoln" });
  });
});

// The overflow issue #4386 exists for: the Dixon 1840 Virginia census fixture is
// one 100-row page, and with per-result `gedcomx` it serializes past Claude
// Code's ~50k-character cutoff. Its rows are fed back through FamilySearch's
// raw entry shape so the page runs the tool end to end.
describe("recordSearchTool — the Dixon 100-row page", () => {
  const DIXON = new URL(
    "../../../../../eval/fixtures/mcp/record-search-dixon-virginia-1840-census.json",
    import.meta.url,
  );

  interface DixonRow {
    recordId: string;
    personName: string;
    score: number;
    sex: string;
    role: string;
    events: Array<{ type: string; date: string; place: string }>;
    collectionId: string;
    collectionTitle: string;
    recordArk: string;
    gedcomx: { persons: Array<{ id: string }> };
  }

  const dixonEntry = (row: DixonRow): FSSearchEntry => {
    const [given, ...rest] = row.personName.split(" ");
    return {
      id: row.recordId,
      score: row.score,
      content: {
        gedcomx: {
          persons: [
            {
              principal: true,
              id: row.gedcomx.persons[0].id,
              display: { name: row.personName, gender: row.sex, role: row.role },
              gender: { type: `http://gedcomx.org/${row.sex}` },
              names: [
                {
                  nameForms: [
                    {
                      fullText: row.personName,
                      parts: [
                        { type: "http://gedcomx.org/Given", value: given },
                        { type: "http://gedcomx.org/Surname", value: rest.join(" ") },
                      ],
                    },
                  ],
                },
              ],
              facts: row.events.map((e) => ({
                type: `http://gedcomx.org/${e.type}`,
                date: { original: e.date },
                place: { original: e.place },
              })),
              identifiers: {
                "http://gedcomx.org/Persistent": [
                  `https://familysearch.org/ark:/61903/1:1:${row.recordId}`,
                ],
              },
            },
          ],
          sourceDescriptions: [
            {
              resourceType: "http://gedcomx.org/Collection",
              about: `https://familysearch.org/collections/${row.collectionId}`,
              titles: [{ value: row.collectionTitle }],
            },
            {
              identifiers: {
                "http://gedcomx.org/Persistent": [`https://familysearch.org/${row.recordArk}`],
              },
            },
          ],
        },
      },
    } as unknown as FSSearchEntry;
  };

  const dixonPage = async (): Promise<FSSearchResponse> => {
    const fixture = JSON.parse(await readFile(DIXON, "utf-8")) as {
      response: { totalMatches: number; results: DixonRow[] };
    };
    return {
      results: fixture.response.totalMatches,
      index: 0,
      entries: fixture.response.results.map(dixonEntry),
      links: { next: { href: "https://www.familysearch.org/next" } },
    } as FSSearchResponse;
  };

  const DIXON_SEARCH = {
    surname: "Dixon",
    residenceYearFrom: 1840,
    residenceYearTo: 1840,
    count: 100,
  };

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-search-dixon-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("serializes the page under 40,000 characters with no projectPath", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(await dixonPage()));

    const out = await recordSearchTool(DIXON_SEARCH, LOCAL);

    expect(out.results).toHaveLength(100);
    // As server.ts sends it: compact JSON.
    expect(JSON.stringify(out).length).toBeLessThan(40_000);
    expect(out.results.every((r) => r.gedcomx === undefined)).toBe(true);
  });

  it("still stages full gedcomx for every row when a project is given", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify({ log: [] }), "utf-8");
    mockFetch.mockResolvedValueOnce(makeOkResponse(await dixonPage()));

    const out = await recordSearchTool({ ...DIXON_SEARCH, projectPath: dir }, LOCAL);

    expect(out.staged).toBeTruthy();
    expect(out.results.every((r) => r.gedcomx === undefined)).toBe(true);
    const staged = JSON.parse(
      await readFile(join(dir, out.staged!.resultsRef), "utf-8"),
    );
    expect(staged.payload.results).toHaveLength(100);
    for (const row of staged.payload.results) {
      expect(row.gedcomx.persons.length).toBeGreaterThan(0);
      expect(row.collectionTitle).toBe("United States Census, 1840");
    }
  });
});

// The largest replayed hosted page (issue #4386): a staged, unranked 100-row
// page of 46,837 characters AFTER the compaction main already did, so its rows
// are built in that shape (no gedcomx, collectionUrl or per-row title), not
// fed through the tool. What still made it big: primaryId, score, confidence,
// empty events, recordTitle repeating the collection, and the envelope's
// paginationCappedAt and query echo.
describe("record_search's answer — a synthetic 100-row page at the largest hosted row size", () => {
  const COLLECTION = "Virginia, Rockingham County, Personal Property Tax Lists, 1782-1850";
  const syntheticPage = (): RecordSearchToolResponse => {
    const results = Array.from({ length: 100 }, (_, i) => {
      const n = String(i).padStart(3, "0");
      const personName = `Mary Fenstermaker ${n}`;
      return {
        recordId: `ark:/61903/1:1:Q${n}-WPBZ`,
        personName,
        score: 5.4236,
        confidence: 4,
        sex: "Female",
        birthPlace: "Rockingham, Virginia, United States",
        collectionId: "1325221",
        // Nine rows in ten carry the record title FamilySearch writes most;
        // the rest a household title with the same trailing collection.
        recordTitle: i % 10 === 0
          ? `${personName} in household of John Fenstermaker, "${COLLECTION}"`
          : `Entry for ${personName}, "${COLLECTION}"`,
        recordArk: `ark:/61903/1:2:Q${n}-WPBZ`,
        primaryId: `p_${n}1736542891`,
        events: i % 4 === 0
          ? []
          : [{ type: "Residence", date: "1850", place: "Rockingham, Virginia, United States" }],
      };
    });
    return {
      query: { surname: "Fenstermaker", residencePlace: "Rockingham, Virginia, United States", count: 100, projectPath: "/p" },
      totalMatches: 1840,
      paginationCappedAt: 4999,
      returned: 100,
      offset: 0,
      hasMore: true,
      collections: { "1325221": COLLECTION },
      results,
      staged: { resultsRef: "results/.staging/x.json", returnedCount: 100 },
    } as unknown as RecordSearchToolResponse;
  };

  // 46,627 characters before (the hosted page: 46,837) and 28,560 after (29,743).
  it("is over 40,000 characters as main sends it, and under after this compaction", () => {
    const page = syntheticPage();
    const before = JSON.stringify(page).length;
    expect(before).toBeGreaterThan(40_000);
    const after = JSON.stringify(compactStagedRecordSearch(page)).length;
    expect(after).toBeLessThan(40_000);
  });
});

describe("recordSearchTool — jurisdiction hints on a nil marriage search", () => {
  let dir: string;

  // A couple who married in one place and later lived in another. The decisive
  // detail is that the EARLIER jurisdiction belongs to the husband, so a hint
  // that only consulted the subject would never surface it.
  const TREE = {
    persons: [
      {
        id: "I1",
        names: [{ given: "James", surname: "Neal" }],
        facts: [
          {
            type: "Birth",
            date: "1857",
            place: "Yell, Arkansas, United States",
            standard_place: "Yell, Arkansas, United States",
          },
        ],
      },
      {
        id: "I2",
        names: [{ given: "Martha", surname: "Wood" }],
        facts: [
          {
            type: "Residence",
            date: "1900",
            place: "Hill, Texas, United States",
            standard_place: "Hill, Texas, United States",
          },
        ],
      },
    ],
    relationships: [
      { id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [] },
    ],
  };

  const nilResult = (): FSSearchResponse => ({
    results: 0,
    index: 0,
    entries: [],
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-search-juris-"));
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(TREE),
      "utf-8",
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("points at the other spouse's earlier jurisdiction when the marriage search comes back nil", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints).toBeDefined();
    expect(out.jurisdictionHints?.searchedPlace).toBe(
      "Hill, Texas, United States",
    );
    const places = out.jurisdictionHints?.candidates.map((c) => c.place) ?? [];
    expect(places).toContain("Yell, Arkansas, United States");
    // The place already searched is not offered back.
    expect(places).not.toContain("Hill, Texas, United States");
  });

  // Widened deliberately after the verification run: a nil-only trigger fired
  // once, at 121 of 180 minutes, far too late to act on. A search that returns
  // rows but matches nobody is the same situation as a nil search — the subject
  // is not in this jurisdiction — so it gets the same hint.
  it("fires when the search returned rows but ranking matched nobody", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }))
      .mockResolvedValue(matchResponse(0.005));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.totalMatches).toBe(1);
    expect(out.ranked?.subjectResolvable).toBe(false);
    expect(out.jurisdictionHints).toBeDefined();
  });

  // A candidate the matcher could not score might be the subject, so a page
  // with one claims no negative and offers no other jurisdiction.
  it("stays silent when the ranking could not score the rows", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }),
    );

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.totalMatches).toBe(1);
    expect(out.ranked?.scoringErrors).toBe(1);
    expect(out.ranked?.subjectResolvable).toBeUndefined();
    expect(out.ranked?.diagnostic).toMatch(/^1 of the 1 candidates could not be scored/);
    expect(out.jurisdictionHints).toBeUndefined();
  });

  it("keeps the search and reports rankingError when the matcher service fails, never asking FamilySearch", async () => {
    matcherSettingsMock.mockResolvedValue({ backend: "service", url: "http://matcher.test", apiKey: "k".repeat(32) });
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }))
      .mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: { code: "unauthorized" } }) });

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.totalMatches).toBe(1);
    expect(out.results).toHaveLength(1);
    expect(out.ranked).toBeUndefined();
    expect(out.rankingError).toMatch(/matcher service rejected/);
    expect(out.jurisdictionHints).toBeUndefined();
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("matchTwoExamples"))).toBe(false);
    expect(urls.filter((u) => u === "http://matcher.test/v1/score")).toHaveLength(1);
  });

  // Review defect: the exclusion only read `marriagePlace`, but the caller scopes
  // marriage searches with recordCountry + recordSubdivision instead — 6 of 7
  // marriage searches in run 6, 4 of 5 in run 5. On that shape `searchedPlace` was
  // undefined, so nothing was excluded and the state that had just come back empty
  // was offered back as the top alternative.
  it("excludes the searched place when scoped by recordCountry + recordSubdivision", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      recordCountry: "United States",
      recordSubdivision: "Texas",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints).toBeDefined();
    expect(out.jurisdictionHints?.searchedPlace).toBe("Texas, United States");
    const places = out.jurisdictionHints?.candidates.map((c) => c.place) ?? [];
    expect(places.filter((p) => /Texas/.test(p))).toEqual([]);
  });

  // Review: `isMarriageSearch` is true on recordType alone, so nothing used to
  // require that a place had actually been scoped. Unscoped and country-wide are
  // the same situation — every candidate the tree can offer was already inside the
  // search — so the note's "in the place searched" would be false. 9 of 26
  // marriage-scoped searches across the six runlogs carried no place scope at all.
  it("stays silent when the marriage search scoped no place at all", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints).toBeUndefined();
  });

  it("stays silent when the marriage search was scoped only to a country", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      recordCountry: "United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints).toBeUndefined();
  });

  it("caps the candidate list so it cannot dominate the response", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Nowhere At All",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints?.candidates.length).toBeLessThanOrEqual(8);
  });

  it("stays silent on a nil search that was not about a marriage", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "census",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    expect(out.jurisdictionHints).toBeUndefined();
  });

  it("stays silent without a subjectId, since there is no one to reason about", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
    }, LOCAL);

    expect(out.jurisdictionHints).toBeUndefined();
  });

  it("does not fail the search when the project has no readable tree", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(nilResult()));
    await rm(join(dir, "tree.gedcomx.json"), { force: true });

    const out = await recordSearchTool({
      surname: "Wood",
      recordType: "marriage",
      marriagePlace: "Hill, Texas, United States",
      projectPath: dir,
      subjectId: "I2",
    }, LOCAL);

    // Advisory only: an unreadable tree must never turn a good search into an error.
    expect(out.jurisdictionHints).toBeUndefined();
    expect(out.totalMatches).toBe(0);
  });
});

// The parameter that gates ranking AND the jurisdiction hints above is supplied
// on 59 of 171 record_search calls across the six committed `jimmie-jewel-neal`
// runlogs — 0%, 0%, 0%, 100%, 55%, 39% by run. Both features therefore spend
// most of their life switched off with nothing in the response or the runlog to
// say so. `rankingSkipped` is the in-band nudge; these tests pin the exact
// condition and, critically, the key ORDER.
describe("recordSearchTool — rankingSkipped when no subject was named", () => {
  let dir: string;

  const oneResult = (): FSSearchResponse => ({
    results: 1,
    index: 0,
    entries: [lincolnEntry()],
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-search-skipped-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("emits the note when projectPath was given but subjectId was not", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    expect(out.rankingSkipped).toBeTruthy();
    expect(out.ranked).toBeUndefined();

    // Pin the wording, not just that a note exists. It rides two thirds of all
    // searches, and it has already been wrong once — an earlier draft narrowed
    // the schema's "omit it when" clause to a broad survey and dropped the
    // second legitimate reason, which is the phrasing that then gets reinforced.
    expect(out.rankingSkipped).toContain("subjectId");
    expect(out.rankingSkipped).toContain("broad survey");
    expect(out.rankingSkipped).toContain("not yet in the tree");
    // Names what was actually given up, so the note is actionable.
    expect(out.rankingSkipped).toContain("ranking");
    expect(out.rankingSkipped).toContain("jurisdiction");    // It rides two thirds of all searches, so it stays short (issue #4386).
    expect(out.rankingSkipped!.length).toBeLessThanOrEqual(200);
  });

  it("stays absent once a subject IS named", async () => {
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({
        persons: [{ id: "I1", names: [{ preferred: true, given: "A", surname: "B" }], facts: [{ type: "Birth", date: "1900", place: "X" }] }],
      }),
      "utf-8",
    );
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "I1" }, LOCAL);

    expect(out.rankingSkipped).toBeUndefined();
    expect(out.ranked).toBeTruthy();
  });

  it("stays absent with no projectPath — nothing was on offer to skip", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln" }, LOCAL);

    expect(out.rankingSkipped).toBeUndefined();
  });

  it("fires on a search that DID find results — the condition is the args, not the outcome", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    expect(out.totalMatches).toBeGreaterThan(0);
    expect(out.rankingSkipped).toBeTruthy();
  });

  it("stays silent on a nil search WITH a subject, even though ranking did not run", async () => {
    // The asymmetry worth pinning: ranking needs `out.staged` too, and a nil
    // search stages nothing, so ranking is skipped here and yet no note is
    // emitted — correctly, because the issue's condition is the args alone.
    // 4 of the 18 subject-carrying calls in run-2026-07-31_13-02-13 are this
    // case. Absence of the note means "a subject was named", NOT "ranking ran".
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 0, index: 0, entries: [] }),
    );

    const out = await recordSearchTool({
      surname: "Lincoln",
      projectPath: dir,
      subjectId: "I1",
    }, LOCAL);

    expect(out.totalMatches).toBe(0);
    expect(out.staged).toBeNull();
    expect(out.ranked).toBeUndefined();
    expect(out.rankingSkipped).toBeUndefined();
  });

  it("treats a falsy subjectId the same way the ranking gate does", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "" }, LOCAL);

    // The ranking gate is `input.subjectId &&`, so an empty string skips ranking.
    // The note has to agree with it or it would report the opposite of what ran.
    expect(out.ranked).toBeUndefined();
    expect(out.rankingSkipped).toBeTruthy();
  });

  it("is withheld from the staged sidecar, but kept on the live response", async () => {
    // The sidecar becomes results/<logId>.json: shared project state that moves
    // between machines, recording what the search RETURNED. A model-facing
    // instruction is not that, and would otherwise be retained on 112 of 171
    // searches. The live response must still carry it — that is where it is read.
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    expect(out.rankingSkipped).toBeTruthy();
    expect(out.staged).toBeTruthy();

    const staged = JSON.parse(await readFile(join(dir, out.staged!.resultsRef), "utf-8"));
    expect(staged.payload.rankingSkipped).toBeUndefined();
    // Withholding must not disturb the rest of the payload, key order included.
    expect(staged.payload.results).toHaveLength(1);
    const text = JSON.stringify(staged.payload);
    expect(text.indexOf('"query"')).toBeLessThan(text.indexOf('"results"'));
  });

  it("serializes BEFORE results, so a size-bounded runlog cannot drop it", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(oneResult()));

    const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

    // This is the whole point of the field's position. `results` is the largest
    // field in the response; anything after it is what a head bound cuts first,
    // which is why `ranked` appears 0 times across the 46 record_search calls in
    // run-2026-07-31_13-02-13 despite 14 of them being ranked.
    const keys = Object.keys(out);
    expect(keys.indexOf("rankingSkipped")).toBeGreaterThan(-1);
    expect(keys.indexOf("rankingSkipped")).toBeLessThan(keys.indexOf("results"));

    const serialized = JSON.stringify(out);
    expect(serialized.indexOf('"rankingSkipped"')).toBeLessThan(
      serialized.indexOf('"results"'),
    );
  });
});

// ─── #1324: relativeTerms ────────────────────────────────────────────────────
//
// A relative-anchored search keeps records that name no such relative, because
// FamilySearch reads the term as "must not contradict". These pin the per-result
// field that tells the two apart. The `absent` / `unknown` boundary is asserted
// from BOTH sides on purpose: two review rounds broke it in opposite directions
// — one reporting `absent` where the sex was merely unrecorded, the other making
// `absent` unreachable whenever the record named the other parent.

const GIVEN_URI = "http://gedcomx.org/Given";
const SURNAME_URI = "http://gedcomx.org/Surname";

function rawName(given: string, surname?: string) {
  const parts: { type: string; value: string }[] = [
    { type: GIVEN_URI, value: given },
  ];
  if (surname !== undefined) parts.push({ type: SURNAME_URI, value: surname });
  return { nameForms: [{ parts }] };
}

type ParentOpt = false | "male" | "female" | "no-gender" | "unknown-gender";

/**
 * A multi-person entry shaped like a real staged result: persona + ParentChild
 * parents + a Couple row. Every other fixture in this file is a lone person with
 * no relationships, on which every assertion would trivially resolve `unknown` —
 * so without this the suite cannot fail for any reason that matters.
 */
function householdEntry(opts?: {
  father?: ParentOpt;
  mother?: ParentOpt;
  spouses?: 0 | 1 | 2;
  spouseIsSelf?: boolean;
  personaHasId?: boolean;
  relationships?: "omit" | "empty";
  /** Facts put on every Couple row (#3695). */
  coupleFacts?: Record<string, unknown>[];
  /** Facts put on the persona itself. */
  personaFacts?: Record<string, unknown>[];
  /** Add a Couple between the two parents, which the persona is not part of. */
  parentsCouple?: boolean;
}): FSSearchEntry {
  const father = opts?.father ?? "male";
  const mother = opts?.mother ?? "female";
  const spouses = opts?.spouses ?? 1;
  const personaHasId = opts?.personaHasId ?? true;

  const genderFor = (o: ParentOpt) =>
    o === "male"
      ? { type: "http://gedcomx.org/Male" }
      : o === "female"
        ? { type: "http://gedcomx.org/Female" }
        : o === "unknown-gender"
          ? { type: "http://gedcomx.org/Intersex" }
          : undefined; // "no-gender" → no gender key at all

  const persons: Record<string, unknown>[] = [
    {
      principal: true,
      ...(personaHasId ? { id: "p_kid" } : {}),
      names: [rawName("Elisabetha", "Sugecz")],
      ...(opts?.personaFacts ? { facts: opts.personaFacts } : {}),
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/1:1:HHHH-1111",
        ],
      },
    },
  ];
  const relationships: Record<string, unknown>[] = [];

  if (father !== false) {
    const g = genderFor(father);
    persons.push({
      id: "p_dad",
      names: [rawName("Wm.", "Neal")],
      ...(g ? { gender: g } : {}),
    });
    relationships.push({
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#p_dad" },
      person2: { resource: "#p_kid" },
    });
  }
  if (mother !== false) {
    const g = genderFor(mother);
    persons.push({
      id: "p_mom",
      names: [rawName("Anna", "Kovacs")],
      ...(g ? { gender: g } : {}),
    });
    relationships.push({
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#p_mom" },
      person2: { resource: "#p_kid" },
    });
  }
  for (let i = 0; i < spouses; i++) {
    const id = `p_spouse${i}`;
    persons.push({ id, names: [rawName(`Spouse${i}`, "Toth")] });
    relationships.push({
      type: "http://gedcomx.org/Couple",
      // Persona deliberately on person2: a Couple row is symmetric, and reading
      // a fixed side would report the searched person as their own spouse.
      person1: opts?.spouseIsSelf
        ? { resource: "#p_kid" }
        : { resource: `#${id}` },
      person2: { resource: "#p_kid" },
      ...(opts?.coupleFacts ? { facts: opts.coupleFacts } : {}),
    });
  }
  if (opts?.parentsCouple) {
    relationships.push({
      type: "http://gedcomx.org/Couple",
      person1: { resource: "#p_dad" },
      person2: { resource: "#p_mom" },
      ...(opts?.coupleFacts ? { facts: opts.coupleFacts } : {}),
    });
  }

  return {
    id: "HHHH-1111",
    content: {
      gedcomx: {
        persons,
        ...(opts?.relationships === "omit"
          ? {}
          : opts?.relationships === "empty"
            ? { relationships: [] }
            : { relationships }),
      },
    },
  } as unknown as FSSearchEntry;
}

/** Run an entry through mapEntry and hand back just the resolved terms.
 *
 * Accepts bare prefixes for the four role-based terms (which ignore the queried
 * names) and full `{prefix, given, surname}` objects for `other`, which has no
 * relationship role and can only be answered by comparing names.
 */
function termsFor(
  entry: FSSearchEntry,
  terms: (KinPrefix | KinTerm)[],
) {
  const normalized: KinTerm[] = terms.map((t) =>
    typeof t === "string" ? { prefix: t } : t,
  );
  return mapEntry(entry, normalized)?.relativeTerms;
}

describe("#1324 relativeTerms", () => {
  it("35. reports father absent when the record names only the mother", () => {
    // The issue's exact case. The record DOES name a parent and it is provably
    // not the father, so this is real evidence no father was indexed — not an
    // inability to tell. Degrading it to `unknown` would destroy the signal on
    // the 20 surveyed results that sit in this cell.
    expect(termsFor(householdEntry({ father: false }), ["father"])).toEqual({
      father: { status: "absent" },
    });
  });

  it("36. reports father absent when the record names no parents at all", () => {
    expect(
      termsFor(householdEntry({ father: false, mother: false }), ["father"]),
    ).toEqual({ father: { status: "absent" } });
  });

  it("37. reports father present with the parent's name", () => {
    expect(termsFor(householdEntry(), ["father"])).toEqual({
      father: { status: "present", name: "Wm. Neal" },
    });
  });

  it("38. reports unknown, not absent, when the parent carries no gender key", () => {
    expect(
      termsFor(householdEntry({ father: "no-gender" }), ["father"]),
    ).toEqual({ father: { status: "unknown" } });
  });

  it("39. reports unknown, not absent, when the parent's gender is the literal Unknown", () => {
    // `simplifyGender` emits the string "Unknown" for any non-Male/Female URI.
    // Such a parent HAS a gender, so a rule phrased as "carries no gender"
    // misses it entirely and lands on `absent`.
    expect(
      termsFor(householdEntry({ father: "unknown-gender" }), ["father"]),
    ).toEqual({ father: { status: "unknown" } });
  });

  it("40. does not let the sex gate leak into the sex-agnostic parent prefix", () => {
    // Mother removed deliberately: with her present, `parent` would resolve on
    // her whether or not the gate leaked, and this would prove nothing.
    for (const father of ["no-gender", "unknown-gender"] as const) {
      expect(
        termsFor(householdEntry({ father, mother: false }), ["parent"]),
      ).toEqual({ parent: { status: "present", name: "Wm. Neal" } });
    }
  });

  it("41. reports unknown for every prefix when the persona has no id", () => {
    // Relationships intact — otherwise the no-graph rule alone would satisfy
    // this, and an implementation missing the primaryId short-circuit passes.
    expect(
      termsFor(householdEntry({ personaHasId: false }), ["father", "spouse"]),
    ).toEqual({ father: { status: "unknown" }, spouse: { status: "unknown" } });
  });

  it("42. reports unknown for every prefix when the anchor is the principal fallback", () => {
    const entry = householdEntry();
    // Break the ark match so only the `principal === true` fallback can fire.
    (entry as unknown as { id: string }).id = "ZZZZ-9999";
    expect(termsFor(entry, ["father", "mother"])).toEqual({
      father: { status: "unknown" },
      mother: { status: "unknown" },
    });
  });

  it("43. reports unknown when relationships are missing or empty", () => {
    // An empty array is not "resolves cleanly and yields nobody" — it cannot be
    // told apart from relationships never being returned. Both shapes occur.
    for (const relationships of ["omit", "empty"] as const) {
      expect(termsFor(householdEntry({ relationships }), ["father"])).toEqual({
        father: { status: "unknown" },
      });
    }
  });

  it("44. does not satisfy mother with a male parent", () => {
    expect(termsFor(householdEntry({ mother: false }), ["mother"])).toEqual({
      mother: { status: "absent" },
    });
  });

  it("45. reports the other Couple endpoint as the spouse, not the persona", () => {
    expect(termsFor(householdEntry(), ["spouse"])).toEqual({
      spouse: { status: "present", name: "Spouse0 Toth" },
    });
  });

  it("46. reports spouse unknown when both Couple endpoints are the persona", () => {
    expect(termsFor(householdEntry({ spouseIsSelf: true }), ["spouse"])).toEqual(
      { spouse: { status: "unknown" } },
    );
  });

  it("47. reports spouse absent when there is no Couple row", () => {
    expect(termsFor(householdEntry({ spouses: 0 }), ["spouse"])).toEqual({
      spouse: { status: "absent" },
    });
  });

  it("48. joins name from given + surname and tolerates a missing surname", () => {
    const entry = householdEntry();
    const gx = entry.content!.gedcomx as unknown as {
      persons: Record<string, unknown>[];
    };
    const dad = gx.persons.find((p) => p.id === "p_dad")!;
    dad.names = [rawName("Wm.")];
    expect(termsFor(entry, ["father"])).toEqual({
      father: { status: "present", name: "Wm." },
    });
  });

  it("49. emits relativeTerms only when a relative NAME was supplied", async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ results: 1, index: 0, entries: [householdEntry()] }),
    );

    const withTerm = await recordSearchTool({
      surname: "Sugecz",
      fatherGivenName: "Wm.",
    }, LOCAL);
    expect(withTerm.results![0].relativeTerms).toEqual({
      father: { status: "present", name: "Wm. Neal" },
    });

    const withoutTerm = await recordSearchTool({ surname: "Sugecz" }, LOCAL);
    expect(withoutTerm.results![0].relativeTerms).toBeUndefined();

    // An `*Exact` boolean alone sends no q.fatherGivenName, so no father
    // constraint was applied and there is nothing to report on.
    const exactOnly = await recordSearchTool({
      surname: "Sugecz",
      fatherGivenNameExact: true,
    }, LOCAL);
    expect(exactOnly.results![0].relativeTerms).toBeUndefined();
  });

  it("50. resolves `other` by name match against co-people on the record", async () => {
    mockFetch.mockResolvedValue(
      makeOkResponse({ results: 1, index: 0, entries: [householdEntry()] }),
    );
    const result = await recordSearchTool({
      surname: "Sugecz",
      fatherGivenName: "Wm.",
      otherGivenName: "Anna",
      otherSurname: "Kovacs",
    }, LOCAL);
    expect(result.results![0].relativeTerms).toEqual({
      father: { status: "present", name: "Wm. Neal" },
      other: { status: "present", name: "Anna Kovacs" },
    });
  });

  it("51. reports `other` unknown, not absent, when no co-person's name matches", () => {
    // We compare names exactly while FamilySearch matched fuzzily, so a miss
    // means "could not confirm", never "not on this record". Reporting `absent`
    // here would be the false disconfirmation this whole field exists to stop.
    expect(
      termsFor(householdEntry(), [{ prefix: "other", given: "Jozsef" }]),
    ).toEqual({ other: { status: "unknown" } });
  });

  it("52. matches `other` across case and punctuation", () => {
    // `Wm.` vs `wm` is the same indexed person spelled differently; an exact
    // string compare would call that a miss and downgrade a real positive.
    expect(
      termsFor(householdEntry(), [{ prefix: "other", given: "  wm ", surname: "NEAL" }]),
    ).toEqual({ other: { status: "present", name: "Wm. Neal" } });
  });

  it("53. reports `other` absent only when the record carries no co-person", () => {
    expect(
      termsFor(householdEntry({ father: false, mother: false, spouses: 0 }), [
        { prefix: "other", given: "Anna" },
      ]),
    ).toEqual({ other: { status: "absent" } });
  });

  it("54. answers `other` even when the relationship graph is missing", () => {
    // `other` reads persons[], not the relationship graph, so the no-graph
    // trigger that blinds the four role-based prefixes does not blind it.
    expect(
      termsFor(householdEntry({ relationships: "omit" }), [
        "father",
        { prefix: "other", given: "Anna", surname: "Kovacs" },
      ]),
    ).toEqual({
      father: { status: "unknown" },
      other: { status: "present", name: "Anna Kovacs" },
    });
  });

  it("55. survives the staged slim block, inline and in the sidecar on disk", async () => {
    // The integration the whole design turns on: `gedcomx` is deleted from the
    // staged rows and relativeTerms must outlive it in BOTH copies. Asserting a
    // surviving `unknown` here would prove nothing, so this asserts `present`.
    const dir = await mkdtemp(join(tmpdir(), "rt-"));
    try {
      mockFetch.mockResolvedValue(
        makeOkResponse({ results: 1, index: 0, entries: [householdEntry()] }),
      );
      const result = await recordSearchTool({
        surname: "Sugecz",
        fatherGivenName: "Wm.",
        projectPath: dir,
      }, LOCAL);

      expect(result.results![0].gedcomx).toBeUndefined();
      expect(result.results![0].relativeTerms).toEqual({
        father: { status: "present", name: "Wm. Neal" },
      });

      const staged = JSON.parse(
        await readFile(join(dir, result.staged!.resultsRef), "utf-8"),
      );
      expect(staged.payload.results![0].relativeTerms).toEqual({
        father: { status: "present", name: "Wm. Neal" },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// #1592 — record_search drops UdeBatchNbr, so batch enumeration has no way to
// obtain a batch number. Payload shapes below are the ones measured live on
// 2026-08-13 (dev/probe-batch-field.ts), including the two type spellings.
describe("#1592 batchNumber on results", () => {
  /** An entry whose gedcomx root carries the batch, in either type spelling. */
  const entryWithBatch = (
    typeSuffix: "UdeBatchNbr" | "UdeBatchNumber",
    text = "M01048-5",
  ): FSSearchEntry => {
    const entry = lincolnEntry();
    entry.content!.gedcomx!.fields = [
      {
        type: "http://familysearch.org/types/fields/BatchLocality",
        values: [{ labelId: "FS_BATCH_LOCALITY", text: "Kirkdale, Lancashire, England" }],
      },
      {
        type: `http://familysearch.org/types/fields/${typeSuffix}`,
        values: [{ labelId: "FS_UDE_BATCH_NBR", text }],
      },
    ];
    return entry;
  };

  it("reads the batch when the type is spelled UdeBatchNbr", () => {
    const r = mapEntry(entryWithBatch("UdeBatchNbr", "B01883-5"));
    expect(r!.batchNumber).toBe("B01883-5");
  });

  // The spelling that issue #1592's own quoted payload would have missed:
  // collection 1494474 and q.batchNumber=8317102 both return this one.
  it("reads the batch when the type is spelled UdeBatchNumber", () => {
    const r = mapEntry(entryWithBatch("UdeBatchNumber", "B05338-0"));
    expect(r!.batchNumber).toBe("B05338-0");
  });

  it("keys on labelId, so an unknown type spelling still yields the batch", () => {
    const entry = lincolnEntry();
    entry.content!.gedcomx!.fields = [
      {
        type: "http://familysearch.org/types/fields/SomeFutureSpelling",
        values: [{ labelId: "FS_UDE_BATCH_NBR", text: "V01311-7" }],
      },
    ];
    // Guards the failure mode this field exists to avoid: a batch that is
    // present upstream but unreadable here looks exactly like a record with
    // none, so the miss is silent.
    expect(mapEntry(entry)!.batchNumber).toBe("V01311-7");
  });

  it("ignores person-level fields, which carry PR_AGE and Role but never a batch", () => {
    const entry = lincolnEntry();
    entry.content!.gedcomx!.persons![0].fields = [
      { type: "http://familysearch.org/types/fields/Age", values: [{ labelId: "PR_AGE", text: "3" }] },
      { type: "http://familysearch.org/types/fields/Role", values: [{ text: "Principal" }] },
    ];
    expect(mapEntry(entry)!.batchNumber).toBeUndefined();
  });

  it("omits the field entirely on a record that traces to no batch", () => {
    // The common case: 0/10 census hits and 10/17 hits inside one marriage
    // collection carried none. Absence must not be reported as a value.
    expect(mapEntry(lincolnEntry())!.batchNumber).toBeUndefined();
    expect("batchNumber" in mapEntry(lincolnEntry())!).toBe(false);
  });

  it("takes the batch even when other root fields precede it", () => {
    const entry = lincolnEntry();
    entry.content!.gedcomx!.fields = [
      { type: "http://familysearch.org/types/fields/FilmNumber", values: [{ labelId: "FS_FILM_NBR", text: "329781" }] },
      { type: "http://familysearch.org/types/fields/RecordGroup", values: [{ labelId: "FS_RECORD_GROUP", text: "Germany-EASy" }] },
      { type: "http://familysearch.org/types/fields/UdeBatchNumber", values: [{ labelId: "FS_UDE_BATCH_NBR", text: "B93070-3" }] },
      { type: "http://familysearch.org/types/fields/UniqueId", values: [{ labelId: "FS_UNIQUE_ID", text: "251586213" }] },
    ];
    expect(mapEntry(entry)!.batchNumber).toBe("B93070-3");
  });

  it("survives the staged slim block, which is the only case that matters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "record-search-batch-"));
    try {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 1, index: 0, entries: [entryWithBatch("UdeBatchNbr")] }),
      );
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);

      // gedcomx is stripped inline — if the batch lived only in there, the
      // enumeration loop would work solely in unlogged exploratory searches.
      expect(out.staged).toBeTruthy();
      expect(out.results![0].gedcomx).toBeUndefined();
      expect(out.results![0].batchNumber).toBe("M01048-5");

      // …and it reaches the sidecar the viewer and rank_search_matches read.
      const ref = out.staged!.resultsRef;
      const staged = JSON.parse(
        await readFile(join(dir, ref.replace(/^\.\//, "")), "utf-8"),
      );
      expect(staged.payload.results![0].batchNumber).toBe("M01048-5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps treeMatches on the annotated row, the shape a subjectId search reads", async () => {
    // record_search advertises "Family-Tree-person match suggestions" in its own
    // tool description, and a subject-named search reads `ranked`, not
    // `results`. Before the stub carried treeMatches, the dominant call shape
    // silently had none.
    const dir = await mkdtemp(join(tmpdir(), "record-search-rank-hints-"));
    try {
      await writeFile(
        join(dir, "tree.gedcomx.json"),
        JSON.stringify({
          persons: [
            {
              id: "I1",
              names: [{ preferred: true, given: "Abraham", surname: "Lincoln" }],
              facts: [{ type: "Birth", date: "1809", place: "Hardin, Kentucky, United States" }],
            },
          ],
        }),
        "utf-8",
      );
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }),
      );

      const out = await recordSearchTool({
        surname: "Lincoln",
        projectPath: dir,
        subjectId: "I1",
      }, LOCAL);

      // Under the #1212 ruling the row IS the row: treeMatches stays where it
      // always was, and the row now also carries the score. `ranked` has no
      // matches list to carry it onto.
      expect(out.results[0].treeMatches?.length).toBeGreaterThan(0);
      expect(out.results[0].matchScore).not.toBeUndefined();
      expect((out.ranked as { matches?: unknown }).matches).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("survives the staged slim block alongside role", async () => {
    const dir = await mkdtemp(join(tmpdir(), "record-search-role-slim-"));
    try {
      const entry = lincolnEntry();
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 1, index: 0, entries: [entry] }),
      );
      const out = await recordSearchTool({ surname: "Lincoln", projectPath: dir }, LOCAL);
      expect(out.results[0].gedcomx).toBeUndefined();
      expect(out.results[0].role).toBe("Principal");

      const ref = out.staged!.resultsRef;
      const staged = JSON.parse(
        await readFile(join(dir, ref.replace(/^\.\//, "")), "utf-8"),
      );
      expect(staged.payload.results[0].role).toBe("Principal");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reaches the annotated row, the shape a subjectId search actually reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "record-search-batch-rank-"));
    try {
      await writeFile(
        join(dir, "tree.gedcomx.json"),
        JSON.stringify({
          persons: [
            {
              id: "I1",
              names: [{ preferred: true, given: "Abraham", surname: "Lincoln" }],
              facts: [{ type: "Birth", date: "1809", place: "Hardin, Kentucky, United States" }],
            },
          ],
        }),
        "utf-8",
      );
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 1, index: 0, entries: [entryWithBatch("UdeBatchNbr")] }),
      );

      const out = await recordSearchTool({
        surname: "Lincoln",
        projectPath: dir,
        subjectId: "I1",
      }, LOCAL);

      expect(out.ranked).toBeTruthy();
      expect(out.results[0].batchNumber).toBe("M01048-5");
      expect(out.results[0].matchRank).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("#2367/#2336 role on results", () => {
  it("populates role from display.role", () => {
    const r = mapEntry(lincolnEntry());
    expect(r!.role).toBe("Principal");
  });

  it("omits role when display.role is absent", () => {
    const entry = lincolnEntry();
    delete entry.content!.gedcomx!.persons![0].display!.role;
    const r = mapEntry(entry);
    expect(r!.role).toBeUndefined();
    expect("role" in r!).toBe(false);
  });

  it("carries a non-Principal role through unchanged", () => {
    const entry = lincolnEntry();
    entry.content!.gedcomx!.persons![0].display!.role = "Mother";
    const r = mapEntry(entry);
    expect(r!.role).toBe("Mother");
  });
});

// The rule for each part is unit-tested in tests/utils/search-advice.test.ts and
// census-note.test.ts. This is the tool-level half: the response carries them.
describe("recordSearchTool — search advice is attached to the response", () => {
  it("carries patronymicSearch, childrenSearch and census, in that order, before results", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const out = await recordSearchTool(
      { surname: "Moen", fatherGivenName: "Hans", recordCountry: "Norway", collectionId: "1401638" },
      LOCAL,
    );
    expect(out.patronymicSearch?.searched).toBe("Moen");
    expect(out.childrenSearch?.heldBy).toEqual(["collectionId"]);
    expect(out.census?.schedules[0].year).toBe(1850);
    const keys = Object.keys(out);
    const at = (k: string) => keys.indexOf(k);
    expect(at("patronymicSearch")).toBeGreaterThan(-1);
    expect([at("patronymicSearch"), at("childrenSearch"), at("census")]).toEqual([
      at("results") - 3,
      at("results") - 2,
      at("results") - 1,
    ]);
  });

  it("adds none of them to a search they do not apply to", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const out = await recordSearchTool({ surname: "Lincoln", givenName: "Abraham" }, LOCAL);
    expect(out.patronymicSearch).toBeUndefined();
    expect(out.childrenSearch).toBeUndefined();
    expect(out.census).toBeUndefined();
  });
});

// Issue #3054. The tool-level half of the proof the issue asks for: the hint is
// emitted for ut_search_records_023's exact inputs, and not for nils that do not
// qualify. The rule itself is unit-tested in tests/utils/surname-variant-hints.test.ts.
describe("recordSearchTool — surnameVariantHints on a search that did not find the subject", () => {
  it("emits the abbreviated forms for ut_search_records_023's inputs, with no project", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    const out = await recordSearchTool(
      { surname: "Halsteinsdatter", givenName: "Unna", collectionId: "1468080" },
      LOCAL,
    );

    expect(out.surnameVariantHints?.fields).toEqual([
      {
        field: "surname",
        searched: "Halsteinsdatter",
        variants: ["Halsteinsdr", "Halsteinsdtr", "Halsteinsd"],
      },
    ]);
  });

  // The shape the real index answers: the bride is not indexed as a principal,
  // only as the groom's spouse (eval/tests/e2e/anders-monsen-ancestry/README.md).
  it("emits on spouseSurname when the bride is the secondary party", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    const out = await recordSearchTool(
      {
        surname: "Monsen",
        givenName: "Anders",
        spouseSurname: "Halsteinsdatter",
        collectionId: "1468080",
      },
      LOCAL,
    );

    expect(out.surnameVariantHints?.fields.map((e) => e.field)).toEqual(["spouseSurname"]);
  });

  it("is serialized before results", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));

    const out = await recordSearchTool({ surname: "Halsteinsdatter" }, LOCAL);

    const keys = Object.keys(out);
    expect(keys.indexOf("surnameVariantHints")).toBeGreaterThan(-1);
    expect(keys.indexOf("surnameVariantHints")).toBe(keys.indexOf("results") - 1);
  });

  it("stays silent on a nil search whose surname is not a -datter/-dotter patronymic", async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const neal = await recordSearchTool({ surname: "Neal", recordType: "marriage" }, LOCAL);
    expect(neal.surnameVariantHints).toBeUndefined();

    // -son is deliberately not covered (it ends ordinary English surnames).
    mockFetch.mockResolvedValueOnce(makeOkResponse(emptyResponse()));
    const johnson = await recordSearchTool({ surname: "Johnson" }, LOCAL);
    expect(johnson.surnameVariantHints).toBeUndefined();
  });

  it("stays silent when the search found records and no ranking ran", async () => {
    mockFetch.mockResolvedValueOnce(
      makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }),
    );

    const out = await recordSearchTool({ surname: "Halsteinsdatter" }, LOCAL);

    expect(out.totalMatches).toBe(1);
    expect(out.surnameVariantHints).toBeUndefined();
  });

  describe("rows returned but ranking matched nobody", () => {
    let dir: string;
    const TREE = {
      persons: [
        {
          id: "I2",
          names: [{ given: "Unna", surname: "Halsteinsdatter" }],
          facts: [
            {
              type: "Birth",
              date: "May 1745",
              place: "Meland, Hordaland, Norway",
              standard_place: "Meland, Hordaland, Norway",
            },
          ],
        },
      ],
      relationships: [],
    };

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "record-search-surname-hint-"));
      await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE), "utf-8");
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    // The only branch that stages a sidecar, so the only one where "never staged"
    // can be shown. The note must not claim the rows are empty: one of them may
    // be the subject under a different spelling.
    it("fires, says 'did not identify the subject', precedes results, and is not staged", async () => {
      mockFetch
        .mockResolvedValueOnce(makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }))
        .mockResolvedValue(matchResponse(0.005));

      const out = await recordSearchTool(
        { surname: "Halsteinsdatter", projectPath: dir, subjectId: "I2" },
        LOCAL,
      );

      expect(out.totalMatches).toBe(1);
      expect(out.ranked?.subjectResolvable).toBe(false);
      expect(out.surnameVariantHints?.fields[0].variants[0]).toBe("Halsteinsdr");
      expect(out.surnameVariantHints?.note).toMatch(/did not identify the subject/);
      expect(out.surnameVariantHints?.note).not.toMatch(/found nobody|no results/i);
      const keys = Object.keys(out);
      expect(keys.indexOf("surnameVariantHints")).toBe(keys.indexOf("results") - 1);

      const staged = JSON.parse(
        await readFile(join(dir, out.staged!.resultsRef), "utf-8"),
      );
      expect(JSON.stringify(staged)).not.toContain("surnameVariantHints");
    });

    it("stays silent when the ranking could not score the rows", async () => {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({ results: 1, index: 0, entries: [lincolnEntry()] }),
      );

      const out = await recordSearchTool(
        { surname: "Halsteinsdatter", projectPath: dir, subjectId: "I2" },
        LOCAL,
      );

      expect(out.totalMatches).toBe(1);
      expect(out.ranked?.subjectResolvable).toBeUndefined();
      expect(out.ranked?.diagnostic).toMatch(/^1 of the 1 candidates could not be scored/);
      expect(out.surnameVariantHints).toBeUndefined();
    });
  });
});

describe("#3695 Couple-relationship facts in events", () => {
  const marriage = (date: string, place?: string) => ({
    type: "http://gedcomx.org/Marriage",
    date: { original: date },
    ...(place ? { place: { original: place } } : {}),
  });
  const undatedMarriage = (place: string) => ({
    type: "http://gedcomx.org/Marriage",
    place: { original: place },
  });
  const marriagesIn = (entry: FSSearchEntry) =>
    mapEntry(entry)!.events.filter((e) => e.type === "Marriage");

  it("73. a Marriage only on the persona's Couple reaches events", () => {
    const entry = householdEntry({
      coupleFacts: [marriage("15. Februar 1867", "Arsdorf")],
    });
    expect(mapEntry(entry)!.events).toEqual([
      { type: "Marriage", date: "15. Februar 1867", place: "Arsdorf" },
    ]);
  });

  it("74. a Couple the persona is not an endpoint of contributes nothing", () => {
    const entry = householdEntry({
      spouses: 0,
      parentsCouple: true,
      coupleFacts: [marriage("3 May 1840", "Arsdorf")],
    });
    expect(mapEntry(entry)!.events).toEqual([]);
  });

  it("75. a Marriage on both the persona and the Couple appears once, keeping the Couple's place", () => {
    const entry = householdEntry({
      personaFacts: [marriage("15. Februar 1867")],
      coupleFacts: [marriage("15. Februar 1867", "Arsdorf")],
    });
    expect(marriagesIn(entry)).toEqual([
      { type: "Marriage", date: "15. Februar 1867", place: "Arsdorf" },
    ]);
  });

  it("76. a Couple Marriage with a different date is kept beside the persona's", () => {
    const entry = householdEntry({
      personaFacts: [marriage("1860")],
      coupleFacts: [marriage("15. Februar 1867", "Arsdorf")],
    });
    expect(marriagesIn(entry)).toEqual([
      { type: "Marriage", date: "1860" },
      { type: "Marriage", date: "15. Februar 1867", place: "Arsdorf" },
    ]);
  });

  it("77. a projectPath search keeps the Couple-derived event, inline and in the sidecar", async () => {
    // Compaction deletes `gedcomx` from the inline rows, so there the
    // Couple's Marriage survives only if it was lifted into `events`.
    const dir = await mkdtemp(join(tmpdir(), "record-search-couple-"));
    try {
      mockFetch.mockResolvedValueOnce(
        makeOkResponse({
          results: 1,
          index: 0,
          entries: [householdEntry({ coupleFacts: [marriage("15. Februar 1867", "Arsdorf")] })],
        }),
      );
      const out = await recordSearchTool({ surname: "Sugecz", projectPath: dir }, LOCAL);
      const expected = [{ type: "Marriage", date: "15. Februar 1867", place: "Arsdorf" }];

      expect(out.staged).toBeTruthy();
      expect(out.results![0].gedcomx).toBeUndefined();
      expect(out.results![0].events).toEqual(expected);

      const staged = JSON.parse(
        await readFile(join(dir, out.staged!.resultsRef.replace(/^\.\//, "")), "utf-8"),
      );
      expect(staged.payload.results![0].events).toEqual(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("78. a persona with no id gets no Couple events, even from a ref-less Couple", () => {
    const entry = householdEntry({
      personaHasId: false,
      coupleFacts: [marriage("15. Februar 1867", "Arsdorf")],
    });
    // A missing `resource` must not compare equal to a missing persona id.
    const rels = entry.content!.gedcomx!.relationships!;
    for (const rel of rels) delete rel.person2;
    expect(mapEntry(entry)!.events).toEqual([]);
  });

  it("79. undated Marriages on two Couples at different places are both kept", () => {
    const entry = householdEntry({ spouses: 2 });
    const [first, second] = entry.content!.gedcomx!.relationships!.filter((r) =>
      r.type!.endsWith("/Couple"),
    );
    first.facts = [undatedMarriage("Arsdorf")];
    second.facts = [undatedMarriage("Wiltz")];
    expect(marriagesIn(entry)).toEqual([
      { type: "Marriage", place: "Arsdorf" },
      { type: "Marriage", place: "Wiltz" },
    ]);
  });

  it("80. an undated Marriage on both the persona and the Couple appears once", () => {
    const entry = householdEntry({
      personaFacts: [undatedMarriage("Arsdorf")],
      coupleFacts: [undatedMarriage("Arsdorf")],
    });
    expect(marriagesIn(entry)).toEqual([{ type: "Marriage", place: "Arsdorf" }]);
  });

  it("81. a repeated persona fact gets the Couple's place on every copy, so compaction collapses it", () => {
    const entry = householdEntry({
      personaFacts: [marriage("1867"), marriage("1867")],
      coupleFacts: [marriage("1867", "Arsdorf")],
    });
    const out = compactStagedRecordSearch({
      results: [mapEntry(entry)!],
    } as RecordSearchToolResponse);
    expect(out.results[0].events).toEqual([
      { type: "Marriage", date: "1867", place: "Arsdorf" },
    ]);
  });

  it("82. the persona on person1 of its Couple is matched too", () => {
    const entry = householdEntry({ coupleFacts: [marriage("15. Februar 1867", "Arsdorf")] });
    for (const rel of entry.content!.gedcomx!.relationships!) {
      if (!rel.type!.endsWith("/Couple")) continue;
      [rel.person1, rel.person2] = [rel.person2, rel.person1];
    }
    expect(marriagesIn(entry)).toEqual([
      { type: "Marriage", date: "15. Februar 1867", place: "Arsdorf" },
    ]);
  });

  it("83. a duplicate Couple fact fills the kept copy's missing value", () => {
    const entry = householdEntry({
      personaFacts: [marriage("1867")],
      coupleFacts: [{ ...marriage("1867"), value: "civil" }],
    });
    expect(marriagesIn(entry)).toEqual([
      { type: "Marriage", date: "1867", value: "civil" },
    ]);
  });

  it("84. a fact on the persona's ParentChild row is not an event", () => {
    const entry = householdEntry({ spouses: 0 });
    for (const rel of entry.content!.gedcomx!.relationships!) {
      if (rel.type!.endsWith("/ParentChild")) rel.facts = [marriage("1840", "Arsdorf")];
    }
    expect(mapEntry(entry)!.events).toEqual([]);
  });
});

// ─── Place expansion (issue #4067) ───────────────────────────────────────────
//
// A fake FamilySearch that answers each record search by the place it was
// given, and the Places API with Rieti's real representation listing (place
// 4662032, read live 2026-11-09). The resolver is the real one; only
// `placeSearchNames`' default "no expansion" mock is swapped for the actual
// function, so these tests run the whole path the live tool runs.
describe("recordSearchTool — searches every name of the place (issue #4067)", () => {
  const PERIOD = "Rieti, Perugia, Umbria, Italy";
  const MODERN = "Rieti, Rieti, Lazio, Italy";
  const PARENT = "Rieti, Lazio, Italy";
  const TARGET = "Q2HC-CWMP";

  function persona(id: string, given = "Anna"): FSSearchEntry {
    return {
      id,
      score: 1,
      content: {
        gedcomx: {
          persons: [
            {
              principal: true,
              id: `p_${id}`,
              display: { name: `${given} Marchetti`, gender: "Female", deathDate: "1913", role: "Principal" },
              facts: [{ type: "http://gedcomx.org/Death", date: { original: "1913" }, place: { original: `Rieti ${id}` } }],
              identifiers: { "http://gedcomx.org/Persistent": [`https://familysearch.org/ark:/61903/1:1:${id}`] },
            },
          ],
          sourceDescriptions: [
            { resourceType: "http://gedcomx.org/Collection", about: "https://familysearch.org/collections/2146202", titles: [{ value: "Italia, Rieti" }] },
          ],
        },
      },
    };
  }

  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}-AAAA`);

  /** Rows each search place returns, best first. Unlisted places return none. */
  let byPlace: Record<string, string[]>;
  let searchUrls: URL[];
  let placesCalls: number;
  let failPlace: string | undefined;
  let rejectPlace: string | undefined;

  const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) });

  function placesApi(url: string) {
    placesCalls++;
    if (url.includes("/places/search")) {
      return ok({
        entries: [{
          id: "11077059",
          score: 0.9,
          content: { gedcomx: { places: [{
            identifiers: { "http://gedcomx.org/Primary": ["https://api.familysearch.org/platform/places/4662032"] },
            display: { name: "Rieti", fullName: PERIOD, type: "Municipality" },
          }] } },
        }],
      });
    }
    if (url.endsWith("/places/4662032")) {
      const rep = (id: string, fullName: string, formal?: string) => ({
        id, place: { resourceId: "4662032" }, display: { fullName }, names: [{ value: "Rieti" }],
        ...(formal ? { temporalDescription: { formal } } : {}),
      });
      return ok({ places: [
        { id: "4662032" },
        rep("7065321", MODERN, "+1927/"),
        rep("7065322", "Rieti, Roma, Lazio, Italy", "+1923/+1927"),
        rep("11077059", PERIOD, "+1882/+1923"),
        rep("11077060", "Rieti, Umbria, Umbria, Italy", "+1861/+1882"),
        rep("13760867", "Rieti, Perugia, Umbria, Papal States", "+1370/+1860"),
        rep("12885240", "Rieti, Umbria, Papal States", "/+1860"),
      ] });
    }
    if (url.endsWith("/description/7065321")) {
      return ok({ places: [{ id: "7065321", identifiers: { "http://gedcomx.org/Primary": ["https://api.familysearch.org/platform/places/4662032"] }, display: { name: "Rieti", fullName: MODERN, type: "Municipality" }, jurisdiction: { resourceId: "425995" } }] });
    }
    if (url.endsWith("/description/425995")) {
      return ok({ places: [{ id: "425995", display: { name: "Rieti", fullName: PARENT, type: "Province" } }] });
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}), text: async () => "" };
  }

  function recordSearch(url: URL) {
    searchUrls.push(url);
    const place = url.searchParams.get("q.deathLikePlace") ?? "";
    const birth = url.searchParams.get("q.birthLikePlace");
    if (place === failPlace) return { ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}) };
    if (place === rejectPlace) return { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({}) };
    const rows = byPlace[birth === null ? place : `${place} | ${birth}`] ?? byPlace[place] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const count = Number(url.searchParams.get("count") ?? 20);
    const page = rows.slice(offset, offset + count);
    return ok({
      results: rows.length,
      index: offset,
      entries: page.map((id) => persona(id, id === TARGET ? "Giuseppa" : "Anna")),
      ...(offset + count < rows.length ? { links: { next: { href: "next" } } } : {}),
    });
  }

  beforeEach(async () => {
    byPlace = {};
    searchUrls = [];
    placesCalls = 0;
    failPlace = undefined;
    rejectPlace = undefined;
    const resolver = await vi.importActual<typeof import("../../src/utils/place-resolver.js")>("../../src/utils/place-resolver.js");
    resolver.__clearPlaceResolverCachesForTests();
    vi.mocked(placeSearchNames).mockImplementation(resolver.placeSearchNames);
    mockFetch.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.familysearch.org/platform/places")) return placesApi(url);
      if (url.startsWith("https://www.familysearch.org/service/search/hr/v2/personas")) return recordSearch(new URL(url));
      return matchResponse(0.1);
    });
  });
  afterEach(() => {
    vi.mocked(placeSearchNames).mockReset();
    vi.mocked(placeSearchNames).mockResolvedValue(null);
  });

  const MARCHETTI = { surname: "Marchetti", collectionId: "2146202", recordType: "death" as const, deathYearFrom: 1913, deathYearTo: 1913 };

  it("finds Giuseppa Marchetti's death from the period place name, which alone misses her", async () => {
    // The live sets of 2026-11-09: the period name's 33 do not hold her; the
    // modern name's 443 hold her first.
    byPlace[PERIOD] = ids("PER", 33);
    byPlace[MODERN] = [TARGET, ...ids("MOD", 40)];

    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);

    expect(out.results.map((r) => r.recordId)).toContain(`ark:/61903/1:1:${TARGET}`);
    const searched = new Set(searchUrls.map((u) => u.searchParams.get("q.deathLikePlace")));
    expect(searched).toEqual(new Set([
      PERIOD, MODERN, "Rieti, Roma, Lazio, Italy", "Rieti, Umbria, Umbria, Italy",
      "Rieti, Perugia, Umbria, Papal States", "Rieti, Umbria, Papal States",
    ]));
    const expansion = out.placeExpansion!;
    expect(expansion.searches[0]).toMatchObject({ places: { deathPlace: PERIOD }, totalMatches: 33 });
    expect(expansion.searches[1]).toMatchObject({ places: { deathPlace: MODERN }, totalMatches: 41 });
    expect(out.totalMatches).toBe(41);
    expect(out.query!.deathPlace).toBe(PERIOD);
  });

  it("interleaves by each search's rank, typed first, de-duplicated by record", async () => {
    byPlace[PERIOD] = ["A1AA-AAAA", "SHRD-AAAA", "A3AA-AAAA"];
    byPlace[MODERN] = ["SHRD-AAAA", "B2BB-BBBB"];

    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);

    expect(out.results.map((r) => r.recordId.split(":").pop())).toEqual(["A1AA-AAAA", "SHRD-AAAA", "B2BB-BBBB", "A3AA-AAAA"]);
    expect(out.placeExpansion?.mergedCount).toBe(4);
    expect(out.returned).toBe(4);
    expect(out.hasMore).toBe(false);
  });

  it("pages the one merged list: two pages concatenate with no gap and no repeat", async () => {
    byPlace[PERIOD] = ids("PER", 15);
    byPlace[MODERN] = [...ids("PER", 5), ...ids("MOD", 15)];
    const page1 = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10 }, LOCAL);
    const page2 = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10, offset: 10 }, LOCAL);
    const page3 = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10, offset: 20 }, LOCAL);
    const all = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 30 }, LOCAL);

    const got = [...page1.results, ...page2.results, ...page3.results].map((r) => r.recordId);
    expect(new Set(got).size).toBe(got.length);
    expect(got).toEqual(all.results.map((r) => r.recordId));
    expect(got).toHaveLength(30);
    expect(page1.hasMore).toBe(true);
    expect(page2.offset).toBe(10);
    expect(page3.hasMore).toBe(false);
  });

  it("stages exactly the page shown on an unranked expansion, starting at the merged offset", async () => {
    byPlace[PERIOD] = ids("PER", 15);
    byPlace[MODERN] = ids("MOD", 15);
    const dir = await mkdtemp(join(tmpdir(), "record-search-expand-page-"));
    try {
      const all = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 30 }, LOCAL);
      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10, offset: 10, projectPath: dir }, LOCAL);
      const sidecar = JSON.parse(await readFile(join(dir, out.staged!.resultsRef), "utf-8"));
      expect(sidecar.payload.results.map((r: { recordId: string }) => r.recordId)).toEqual(
        all.results.slice(10, 20).map((r) => r.recordId),
      );
      expect(sidecar.payload.returned).toBe(10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("standardizes only the rows shown on an unranked expansion", async () => {
    byPlace[PERIOD] = ids("PER", 15);
    byPlace[MODERN] = ids("MOD", 15);
    const resolve = vi.mocked((await import("../../src/utils/place-resolver.js")).resolveStandardPlace);
    resolve.mockClear();
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 5, offset: 5 }, LOCAL);
    const asked = new Set(resolve.mock.calls.map((c) => c[0]));
    expect(asked).toEqual(new Set(out.results.map((r) => `Rieti ${r.recordId.split(":").pop()}`)));
  });

  it("stops a further name's reads at the time limit and gives each request only the time left", async () => {
    byPlace[PERIOD] = [TARGET];
    byPlace[MODERN] = ids("MOD", 150);
    let now = 1_000_000;
    // The typed search and the first page of the modern one run at t=0; the
    // clock then jumps past the deadline before the modern search's second page.
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const res = await base(input, init);
      if (String(input).includes("personas") && String(input).includes(encodeURIComponent(MODERN))) now += 29_000;
      return res;
    });
    try {
      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 100, offset: 50 }, LOCAL);
      const modern = out.placeExpansion!.searches.find((s) => s.places.deathPlace === MODERN)!;
      expect(modern.returned).toBe(100);
      expect(modern.error).toMatch(/time limit for this call ran out after 100 rows/);
      expect(searchUrls.filter((u) => u.searchParams.get("q.deathLikePlace") === MODERN)).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("reads each search in pages of at most 100 when offset + count passes 100", async () => {
    byPlace[MODERN] = ids("MOD", 99).concat(ids("MOE", 60));
    await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 50, offset: 100 }, LOCAL);
    const modern = searchUrls.filter((u) => u.searchParams.get("q.deathLikePlace") === MODERN);
    expect(modern.map((u) => [u.searchParams.get("offset"), u.searchParams.get("count")])).toEqual([["0", "100"], ["100", "50"]]);
    expect(searchUrls.every((u) => Number(u.searchParams.get("count")) <= 100)).toBe(true);
  });

  it("refuses a page too deep to read every name, rather than switching orderings mid-paging", async () => {
    byPlace[PERIOD] = ids("PER", 3);
    // 6 names x 5 pages of 100 = 30 requests, past the 24 allowed.
    await expect(
      recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 100, offset: 400 }, LOCAL),
    ).rejects.toThrow(/too deep to search every name of the place: 6 names/);
    expect(searchUrls).toHaveLength(0);
    // 6 x 4 = 24 is still allowed.
    await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 100, offset: 300 }, LOCAL);
    expect(searchUrls.length).toBeGreaterThan(0);
  });

  it("does not report 'found nothing' when a name it could not search might hold the record", async () => {
    failPlace = MODERN;
    await expect(recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL)).rejects.toThrow(
      /did not complete for every name of the place \(Rieti, Rieti, Lazio, Italy: .*NOT an empty result/,
    );
  });

  it("stops starting further names past the time limit, and still answers from what it searched", async () => {
    byPlace[PERIOD] = [TARGET];
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 11_000));
    try {
      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);
      expect(out.results.map((r) => r.recordId)).toEqual([`ark:/61903/1:1:${TARGET}`]);
      const errors = (out.placeExpansion?.searches ?? []).filter((s) => s.error).map((s) => s.error);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((e) => /time limit/.test(e!))).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("starts no further search once the typed search has failed", async () => {
    failPlace = PERIOD;
    await expect(recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // The typed search plus at most the two that started beside it.
    expect(searchUrls.length).toBeLessThanOrEqual(3);
  });

  it("reports hasMore false when the rows past the page all fail mapping", async () => {
    byPlace[PERIOD] = ids("PER", 3);
    byPlace[MODERN] = ["NOID"];
    const base = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const res = await base(input, init);
      if (!String(input).includes(encodeURIComponent(MODERN).replace(/%20/g, "+")) && !String(input).includes(encodeURIComponent(MODERN))) return res;
      const body = await (res as { json: () => Promise<FSSearchResponse> }).json();
      // A row with no represented person: mapEntry drops it.
      body.entries = [{ id: "NOID", content: { gedcomx: { persons: [] } } } as unknown as FSSearchEntry];
      return { ...res, json: async () => body };
    });
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 3 }, LOCAL);
    expect(out.results).toHaveLength(3);
    expect(out.hasMore).toBe(false);
  });

  it("adds the modern parent under *PlaceExact and keeps .exact on every search", async () => {
    byPlace[PARENT] = [TARGET];
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, deathPlaceExact: true }, LOCAL);
    expect(searchUrls.map((u) => u.searchParams.get("q.deathLikePlace"))).toContain(PARENT);
    expect(searchUrls.every((u) => u.searchParams.get("q.deathLikePlace.exact") === "on")).toBe(true);
    expect(out.results.map((r) => r.recordId)).toContain(`ark:/61903/1:1:${TARGET}`);
  });

  it("keeps the merge when a further name's search fails, and reports it", async () => {
    byPlace[MODERN] = [TARGET];
    failPlace = "Rieti, Umbria, Papal States";
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);
    expect(out.results.map((r) => r.recordId)).toContain(`ark:/61903/1:1:${TARGET}`);
    const failed = out.placeExpansion!.searches
      .filter((s) => s.error !== undefined);
    expect(failed.map((s) => s.places.deathPlace)).toEqual(["Rieti, Umbria, Papal States"]);
  });

  it("fails the call when a further name's search is refused for the session (401)", async () => {
    byPlace[PERIOD] = [TARGET];
    rejectPlace = MODERN;
    await expect(recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL)).rejects.toThrow(/session not accepted/);
  });

  it("searches every combination of two expanded place fields", async () => {
    byPlace[`${MODERN} | ${MODERN}`] = [TARGET];
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, birthPlace: PERIOD }, LOCAL);
    // 6 x 6 = 36 is past the 12-search cap: the longer list loses names from
    // its end until the product fits (3 x 4 = 12), keeping typed and modern.
    const pairs = searchUrls.map((u) => [u.searchParams.get("q.deathLikePlace"), u.searchParams.get("q.birthLikePlace")]);
    expect(pairs).toHaveLength(12);
    expect(new Set(pairs.map((p) => p.join(" | "))).size).toBe(12);
    expect(pairs[0]).toEqual([PERIOD, PERIOD]);
    expect(pairs).toContainEqual([MODERN, MODERN]);
    const birthNames = new Set(pairs.map((p) => p[1]));
    const deathNames = new Set(pairs.map((p) => p[0]));
    expect(birthNames.size * deathNames.size).toBe(12);
    expect(deathNames.has("Rieti, Umbria, Papal States") || birthNames.has("Rieti, Umbria, Papal States")).toBe(false);
    expect(out.placeExpansion?.truncated).toBe(true);
    expect(out.results.map((r) => r.recordId)).toContain(`ark:/61903/1:1:${TARGET}`);
  });

  it("searches the full product with no truncation when it fits", async () => {
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, birthPlace: "Italy" }, LOCAL);
    // A country-only birth place does not expand: 6 x 1 = 6 searches.
    expect(searchUrls).toHaveLength(6);
    expect(new Set(searchUrls.map((u) => u.searchParams.get("q.birthLikePlace")))).toEqual(new Set(["Italy"]));
    expect(out.placeExpansion?.truncated).toBeUndefined();
  });

  it("fails the call as today when the typed place's own search fails", async () => {
    failPlace = PERIOD;
    await expect(recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL)).rejects.toThrow(/transient failure, NOT an empty result/);
  });

  it("makes no Places API call for a repeat search (resolver caches)", async () => {
    await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);
    const first = placesCalls;
    expect(first).toBeGreaterThan(0);
    await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL);
    expect(placesCalls).toBe(first);
  });

  it("issues exactly one search URL with no place, a country-only place, or expandPlaces: false", async () => {
    await recordSearchTool({ ...MARCHETTI }, LOCAL);
    await recordSearchTool({ ...MARCHETTI, deathPlace: "Italy" }, LOCAL);
    const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD }, LOCAL, { expandPlaces: false });
    expect(searchUrls).toHaveLength(3);
    expect(out.placeExpansion).toBeUndefined();
  });

  it("reports a nil search only when every name came back empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "record-search-expand-nil-"));
    try {
      const nil = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, projectPath: dir }, LOCAL);
      expect(nil.nilSearchNeedsLog).toBeDefined();
      byPlace["Rieti, Umbria, Papal States"] = [TARGET];
      const hit = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, projectPath: dir }, LOCAL);
      expect(hit.nilSearchNeedsLog).toBeUndefined();
      expect(hit.totalMatches).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe("with a named subject (ranked)", () => {
    let dir: string;
    const TREE = { persons: [{ id: "I1", names: [{ given: "Giuseppa", surname: "Marchetti" }], facts: [{ type: "Death", date: "15 June 1913", place: "Rieti" }] }], relationships: [] };

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "record-search-expand-rank-"));
      await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE), "utf-8");
      // The matcher scores the target high and everyone else low.
      const base = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
        if (String(input).includes("matchTwoExamples")) {
          return matchResponse(String(init?.body ?? "").includes(TARGET) ? 0.99 : 0.05);
        }
        return base(input, init);
      });
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("ranks the whole merged pool before cutting to count, so a deep record still surfaces", async () => {
      // Rank 8 of the modern search: with 6 names interleaved it sits near merged
      // position 48, past a 10-row page — only ranking the pool reaches it.
      byPlace[PERIOD] = ids("PER", 10);
      byPlace[MODERN] = [...ids("MOD", 7), TARGET, ...ids("MOE", 2)];
      for (const p of ["Rieti, Roma, Lazio, Italy", "Rieti, Umbria, Umbria, Italy", "Rieti, Perugia, Umbria, Papal States", "Rieti, Umbria, Papal States"]) {
        byPlace[p] = ids(p.slice(7, 10).toUpperCase().replace(/[^A-Z]/g, "X"), 10);
      }

      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10, projectPath: dir, subjectId: "I1" }, LOCAL);

      expect(out.results).toHaveLength(10);
      expect(out.results[0]!.recordId).toBe(`ark:/61903/1:1:${TARGET}`);
      expect(out.returned).toBe(10);
      expect(out.staged?.returnedCount).toBe(10);
      const sidecar = JSON.parse(await readFile(join(dir, out.staged!.resultsRef), "utf-8"));
      expect(sidecar.payload.results.length).toBeGreaterThan(10);
      expect(sidecar.payload.returned).toBe(10);
    });

    it("caps the ranked pool, keeping every name's best rows", async () => {
      byPlace[PERIOD] = ids("PER", 60);
      byPlace[MODERN] = [TARGET, ...ids("MOD", 59)];
      ["Rieti, Roma, Lazio, Italy", "Rieti, Umbria, Umbria, Italy", "Rieti, Perugia, Umbria, Papal States", "Rieti, Umbria, Papal States"]
        .forEach((p, i) => { byPlace[p] = ids(`X${i}Y`, 60); });
      // 6 names x 60 distinct rows = 360 merged, past the 300 ranked pool.
      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 60, projectPath: dir, subjectId: "I1" }, LOCAL);
      expect(out.placeExpansion?.rankedPoolCapped).toBe(true);
      expect(out.results[0]!.recordId).toBe(`ark:/61903/1:1:${TARGET}`);
      const sidecar = JSON.parse(await readFile(join(dir, out.staged!.resultsRef), "utf-8"));
      expect(sidecar.payload.results).toHaveLength(300);
    });

    it("describes the page shown, not the pool, in the ranking summary", async () => {
      byPlace[PERIOD] = ids("PER", 20);
      byPlace[MODERN] = ids("MOD", 20);
      const base = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) =>
        String(input).includes("matchTwoExamples") ? matchResponse(0.001) : base(input, init));
      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 10, projectPath: dir, subjectId: "I1" }, LOCAL);
      expect(out.results).toHaveLength(10);
      expect(out.ranked?.returnedCount).toBe(10);
      expect(out.hasMore).toBe(false);
      // Nobody scores above the floor here, so the no-match advice fires: it must
      // not tell the agent to page with an offset the tool refuses.
      expect(out.ranked?.diagnostic).toMatch(/raise `count` \(up to 100\) or narrow the query/);
      expect(out.ranked?.diagnostic).not.toMatch(/page deeper/);
    });

    it("refuses offset on a ranked expansion, which could skip a record between pages", async () => {
      byPlace[PERIOD] = ids("PER", 60);
      await expect(
        recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, offset: 50, projectPath: dir, subjectId: "I1" }, LOCAL),
      ).rejects.toThrow(/ranked search of every name of the place cannot page/);
      expect(searchUrls).toHaveLength(0);
      // Unranked paging, and a ranked first page, still run.
      await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, offset: 50, projectPath: dir }, LOCAL);
      await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, projectPath: dir, subjectId: "I1" }, LOCAL);
      expect(searchUrls.length).toBeGreaterThan(0);
    });

    it("still cuts to count, in merged order, when ranking fails", async () => {
      matcherSettingsMock.mockResolvedValue({ backend: "service", url: "http://matcher.test", apiKey: "k".repeat(32) });
      const base = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (input: string | URL, init?: RequestInit) => {
        if (String(input).startsWith("http://matcher.test")) {
          return { ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: { code: "unauthorized" } }) };
        }
        return base(input, init);
      });
      byPlace[PERIOD] = ids("PER", 10);
      byPlace[MODERN] = ids("MOD", 10);

      const out = await recordSearchTool({ ...MARCHETTI, deathPlace: PERIOD, count: 5, projectPath: dir, subjectId: "I1" }, LOCAL);

      expect(out.rankingError).toBeDefined();
      expect(out.results.map((r) => r.recordId.split(":").pop())).toEqual(["PER00-AAAA", "MOD00-AAAA", "PER01-AAAA", "MOD01-AAAA", "PER02-AAAA"]);
    });
  });
});
