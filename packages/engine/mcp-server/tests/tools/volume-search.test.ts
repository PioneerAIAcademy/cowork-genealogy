import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// The places-API conversion now lives in the shared resolver; mock it so the
// tool no longer fetches the places API (the fetch sequence is search,fulltext).
const mockResolveStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
const mockPlaceIdToRepIds = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    resolveStandardPlaceToPlaceId: mockResolveStandardPlaceToPlaceId,
    standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
    placeIdToRepIds: mockPlaceIdToRepIds,
    ambiguousPlaceError: real.ambiguousPlaceError,
  };
});

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  volumeSearchTool,
  fitToBudget,
  mergeCoverages,
  RESULT_CHAR_BUDGET,
} from "../../src/tools/volume-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  VolumeSearchInput,
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
} from "../../src/types/volume-search.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue("6137147");
  mockResolveStandardPlaceToPlaceId.mockReset();
  mockResolveStandardPlaceToPlaceId.mockResolvedValue({
    kind: "resolved",
    placeId: "6137147",
  });
  mockPlaceIdToRepIds.mockReset();
  mockPlaceIdToRepIds.mockResolvedValue(["2968392"]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fixtures ───────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<MetadataRmsGroup> = {}): MetadataRmsGroup {
  return {
    id: "DGS-004452257",
    groupName: "004452257",
    languages: ["en", "la"],
    // Inline counts — returned when returnChildCounts:true is sent
    childCount: 412,
    indexedChildCount: 366,
    noIndexableDataChildCount: 0,
    coverages: [
      {
        place: "Edensor, Derbyshire, England, United Kingdom",
        datesOrig: "1726–1812",
        recordTypeOrig: "Burial Records",
      },
    ],
    ...overrides,
  };
}

function makeSearchResponse(
  groups: MetadataRmsGroup[],
  overrides: Partial<MetadataRmsSearchResponse> = {}
): MetadataRmsSearchResponse {
  return {
    groups,
    numberReturned: groups.length,
    totalCount: groups.length,
    ...overrides,
  };
}

function makeOkResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status: number, statusText: string, body = "") {
  // `text` is what the non-OK arm reads. A real upstream 409 arrives with an
  // EMPTY body and an empty statusText, which is the shape that produced the
  // uninterpretable "409 ." the caller could do nothing with.
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => body,
  };
}

function makeFulltextResponse(ids: string[]) {
  return makeOkResponse({ ids });
}

// Helper: set up the standard 3-call sequence (places, search, fulltext)
function setupCalls(
  placeRepIds: number[],
  searchBody: MetadataRmsSearchResponse,
  fulltextIds: string[]
) {
  mockPlaceIdToRepIds.mockResolvedValueOnce(placeRepIds.map(String));
  mockFetch
    .mockResolvedValueOnce(makeOkResponse(searchBody))
    .mockResolvedValueOnce(makeFulltextResponse(fulltextIds));
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("volumeSearchTool", () => {
  // 1. Happy path
  it("returns results for placeId + year range", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()]),
      ["004452257"]
    );

    const result = await volumeSearchTool({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      startYear: 1730,
      endYear: 1810,
    }, LOCAL);

    expect(result.query).toEqual({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      startYear: 1730,
      endYear: 1810,
      pageSize: 50,
    });
    expect(result.totalResults).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].imageGroupNumber).toBe("004452257");
    expect(result.results[0].imageCount).toBe(412);
    expect(result.results[0].recordSearchablePercent).toBe(89);
    expect(result.results[0].fulltextSearchable).toBe(true);
    expect(result.results[0].languages).toEqual(["en", "la"]);
    expect(result.results[0].coverages).toEqual([
      {
        places: ["Edensor, Derbyshire, England, United Kingdom"],
        dateRange: "1726–1812",
        recordType: "Burial Records",
      },
    ]);
  });

  // 2. Missing placeId
  it("throws when standardPlace is missing", async () => {
    await expect(
      volumeSearchTool({ standardPlace: "" }, LOCAL)
    ).rejects.toThrow("volume_search requires a standardPlace.");
  });

  // 3. Year → ISO date string derivation
  it("derives fromDateString/toDateString from startYear/endYear", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      startYear: 1730,
      endYear: 1810,
    }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.coverage.fromDateString).toBe("1730-01-01");
    expect(body.coverage.toDateString).toBe("1810-12-31");
  });

  it("omits date bounds from the request when no years are given", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.coverage.fromDateString).toBeUndefined();
    expect(body.coverage.toDateString).toBeUndefined();
  });

  it("throws when endYear is before startYear", async () => {
    await expect(
      volumeSearchTool({
        standardPlace: "Edensor, Derbyshire, England, United Kingdom",
        startYear: 1810,
        endYear: 1730,
      }, LOCAL)
    ).rejects.toThrow("endYear must be greater than or equal to startYear.");
  });

  // 4. placeId → placeRepIds conversion
  it("converts placeId to placeRepIds in coverage.placeRepIds", async () => {
    setupCalls([2968392, 10609408], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);

    expect(mockResolveStandardPlaceToPlaceId).toHaveBeenCalledWith(
      "Edensor, Derbyshire, England, United Kingdom"
    );
    const searchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(searchCall[1].body);
    expect(body.coverage.placeRepIds).toEqual([2968392, 10609408]);
  });

  // 5. Fixed fields
  it("sends types NATURAL, active true, pageSize 50, returnChildCounts true", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.types).toEqual(["NATURAL"]);
    expect(body.active).toBe(true);
    expect(body.pageSize).toBe(50);
    expect(body.returnChildCounts).toBe(true);
  });

  // 6. The split group name is returned whole; no derived prefix
  it("returns a 3-segment groupName whole and no imageGroupPrefix", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "007621224_005_M99P-2TQ" })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].imageGroupNumber).toBe("007621224_005_M99P-2TQ");
    // record_search, fulltext_search and image_search all take the split name, so
    // the prefix was dead weight on every volume (issue #3611).
    expect(result.results[0]).not.toHaveProperty("imageGroupPrefix");
  });

  // 7. recordSearchablePercent calculation
  it("computes recordSearchablePercent correctly from inline counts", async () => {
    // 366 indexed / (412 total - 0 non-indexable) * 100 = ~88.8 → 89
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 412, indexedChildCount: 366, noIndexableDataChildCount: 0 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].recordSearchablePercent).toBe(89);
  });

  it("excludes non-indexable images from denominator", async () => {
    // 80 indexed / (100 - 20 non-indexable) * 100 = 100
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 100, indexedChildCount: 80, noIndexableDataChildCount: 20 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].recordSearchablePercent).toBe(100);
  });

  // 8. Zero denominator edge case
  it("sets recordSearchablePercent to null when denominator <= 0", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 10, indexedChildCount: 0, noIndexableDataChildCount: 10 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].recordSearchablePercent).toBeNull();
  });

  // 9. Missing counts in response → null
  it("sets imageCount and recordSearchablePercent to null when counts are absent from group", async () => {
    const groupNoCount = makeGroup();
    delete (groupNoCount as Partial<MetadataRmsGroup>).childCount;
    delete (groupNoCount as Partial<MetadataRmsGroup>).indexedChildCount;
    setupCalls([2968392], makeSearchResponse([groupNoCount]), []);

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].imageCount).toBeNull();
    expect(result.results[0].recordSearchablePercent).toBeNull();
  });

  // 10. fulltextSearchable true/false mapping
  it("sets fulltextSearchable true for groups in the fulltext response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "004452257" })]),
      ["004452257"]
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].fulltextSearchable).toBe(true);
  });

  it("sets fulltextSearchable false for groups not in the fulltext response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "004452257" })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].fulltextSearchable).toBe(false);
  });

  // 11. fulltextSearchable null on fulltext call failure
  it("sets fulltextSearchable to null when fulltext call fails 3 times", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makeSearchResponse([makeGroup()])))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"));

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].fulltextSearchable).toBeNull();
  });

  // 12. Fulltext batch URL includes all groupNames
  it("sends all groupNames in the fulltext batch call", async () => {
    const groups = [
      makeGroup({ id: "id-1", groupName: "111111111" }),
      makeGroup({ id: "id-2", groupName: "222222222" }),
    ];
    setupCalls([2968392], makeSearchResponse(groups), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);

    // calls: [0] search, [1] fulltext
    const fulltextCall = mockFetch.mock.calls[1];
    expect(fulltextCall[0]).toContain("111111111");
    expect(fulltextCall[0]).toContain("222222222");
  });

  // 13. Coverage mapping
  it("maps coverages to places, dateRange, recordType", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            { place: "Edensor", datesOrig: "1726–1812", recordTypeOrig: "Burial Records" },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.results[0].coverages[0]).toEqual({
      places: ["Edensor"],
      dateRange: "1726–1812",
      recordType: "Burial Records",
    });
  });

  // 14. recordType: opaque concept ids dropped, `title:` provenance prefix stripped
  it("drops concept-id: values but keeps the type behind a title: prefix", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            { place: "Edensor", recordTypeOrig: "concept-id:burial" },
            { place: "Edensor", recordTypeOrig: "title:Taxation" },
            { place: "Edensor", recordTypeOrig: "title: Probate records" },
            { place: "Edensor", recordTypeOrig: "Burial Records" },
            { place: "Edensor", recordTypeOrig: "title:" },
            // The same prefix lands on datesOrig, independently of the type:
            // live, `"title:1867-1908"` occurs beside a clean `"Death records"`.
            { place: "Edensor", datesOrig: "title:1683-1700", recordTypeOrig: "Court records" },
            { place: "Edensor", datesOrig: "1726-1812", recordTypeOrig: "Burial Records" },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    const coverages = result.results[0].coverages;
    // Opaque internal id — nothing a reader can use. A bare `title:` prefix
    // leaves nothing behind either, so both rows end with no type and no date
    // and merge into this first one.
    expect(coverages[0].recordType).toBeUndefined();
    expect(coverages).toHaveLength(6);
    // `title:` marks provenance, not a placeholder: the value is a real record
    // type and every live `title:`-prefixed value observed was one. Dropping
    // these hid the Swedish mantalslängder from volume_search (issue #572).
    expect(coverages[1].recordType).toBe("Taxation");
    expect(coverages[2].recordType).toBe("Probate records");
    // Unprefixed values are unaffected.
    expect(coverages[3].recordType).toBe("Burial Records");
    // dateRange carries the same provenance prefix and is stripped the same way.
    expect(coverages[4].dateRange).toBe("1683-1700");
    expect(coverages[4].recordType).toBe("Court records");
    // An unprefixed date range is untouched.
    expect(coverages[5].dateRange).toBe("1726-1812");
  });

  // 15. Empty result set
  it("handles empty totalCount:0 response", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ totalCount: 0 }));

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.totalResults).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  const EDENSOR_P = "Edensor, Derbyshire, England, United Kingdom";

  // 15a-15b. Structured coverage dates feed dateRange; the years are not emitted
  it("keeps datesOrig as dateRange and emits no startYear/endYear", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            {
              place: "Edensor",
              datesOrig: "1726-1812",
              fromdateString: "1726-01-01T00:00:00",
              todateString: "1812-12-31T23:59:59.999",
            },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P }, LOCAL);
    const c = result.results[0].coverages[0];
    // datesOrig present, so dateRange stays the archival display text.
    expect(c.dateRange).toBe("1726-1812");
    // dateRange already carries the span; the structured pair repeated it on
    // every row, which was a third of an oversized page (issue #3611).
    expect(c).not.toHaveProperty("startYear");
    expect(c).not.toHaveProperty("endYear");
  });

  it("says which side of a one-sided span is open", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            { place: "Edensor", todateString: "1812-12-31T23:59:59.999" },
            { place: "Edensor", fromdateString: "1870-01-01T00:00:00" },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P }, LOCAL);
    // With the structured years gone, dateRange is the only date on a row. A bare
    // "1870" would read as that one year, not as an open end.
    expect(result.results[0].coverages.map((c) => c.dateRange)).toEqual(["until 1812", "from 1870"]);
  });

  it("derives dateRange from the pair when datesOrig is absent", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            {
              place: "Edensor",
              fromdateString: "1683-01-01T00:00:00",
              todateString: "1700-12-31T23:59:59.999",
            },
            // Equal years still render as a range, matching collections_search
            // exactly — one span, one format across both tools.
            {
              place: "Edensor",
              fromdateString: "1873-01-01T00:00:00",
              todateString: "1873-12-31T23:59:59.999",
            },
            // Neither year present — the field stays absent rather than "".
            { place: "Edensor" },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P }, LOCAL);
    const [span, single, none] = result.results[0].coverages;
    expect(span.dateRange).toBe("1683-1700");
    expect(single.dateRange).toBe("1873-1873");
    expect(none.dateRange).toBeUndefined();
  });

  it("falls back to the pair when datesOrig strips to nothing", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            {
              place: "Edensor",
              // Strips to empty. Keying the fallback off presence rather than
              // emptiness would emit startYear/endYear with no dateRange.
              datesOrig: "title:",
              fromdateString: "1683-01-01T00:00:00",
              todateString: "1700-12-31T23:59:59.999",
            },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P }, LOCAL);
    expect(result.results[0].coverages[0].dateRange).toBe("1683-1700");
  });

  it("surfaces recordTypeConceptId only where recordType is missing", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            {
              place: "Edensor",
              // Locale-specific display text with an unusable placeholder sibling:
              // the id is the only stable identifier of the two.
              recordTypeOrig: "Konfirmationslängd",
              recordTypeConceptId: 101655,
            },
            { place: "Edensor", recordTypeOrig: "concept-id:124231", recordTypeConceptId: 124231 },
          ],
        }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P }, LOCAL);
    const [named, placeholder] = result.results[0].coverages;
    expect(named.recordType).toBe("Konfirmationslängd");
    // Readable text present: the id adds nothing a reader uses, so it is left off.
    expect(named).not.toHaveProperty("recordTypeConceptId");
    // recordType is dropped as an opaque id, but the concept id still identifies it.
    expect(placeholder.recordType).toBeUndefined();
    expect(placeholder.recordTypeConceptId).toBe(124231);
  });

  // 15c-15f. Record-type group filtering

  it("expands a group to its anchor and sends it inside coverage", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    // Marriage carries no strays, so this isolates the anchor path.
    await volumeSearchTool({ standardPlace: EDENSOR_P, recordTypeGroups: ["Marriage"] }, LOCAL);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Inside `coverage`, not at the top level — at the top level it is ignored.
    expect(body.coverage.recordTypeConceptIds).toEqual([104727]);
    expect(body.recordTypeConceptIds).toBeUndefined();
  });

  it("sends a group's strays alongside its anchor", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR_P, recordTypeGroups: ["Prison"] }, LOCAL);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // 131448 police records, 130086 criminal records and 126416 criminal case
    // files all sit outside 123478's subtree, so containment cannot reach them.
    expect(body.coverage.recordTypeConceptIds.sort((a: number, b: number) => a - b)).toEqual(
      [123478, 131448, 130086, 126416].sort((a, b) => a - b)
    );
  });

  it("ORs multiple groups into one id array", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({
      standardPlace: EDENSOR_P,
      recordTypeGroups: ["Tax", "Census"],
    }, LOCAL);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Tax anchor + Tax stray + Census anchor + Census stray.
    expect(body.coverage.recordTypeConceptIds.sort((a: number, b: number) => a - b)).toEqual(
      [124410, 129065, 123363, 104611].sort((a, b) => a - b)
    );
  });

  it("sends a parent's anchor plus its descendants' strays, not their anchors", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR_P, recordTypeGroups: ["Legal"] }, LOCAL);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Court, Probate, Wills and Land anchors are NOT enumerated — the API
    // expands 122797's subtree itself. Their strays are, because a stray sits
    // outside that subtree and containment cannot reach it.
    expect(body.coverage.recordTypeConceptIds.sort((a: number, b: number) => a - b)).toEqual(
      [122797, 127571, 127073, 129547].sort((a, b) => a - b)
    );
  });

  it("treats an empty recordTypeGroups array as no filter", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR_P, recordTypeGroups: [] }, LOCAL);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Upstream treats an empty id list as no filter; omit it rather than send a
    // no-op that reads like a filter.
    expect(body.coverage.recordTypeConceptIds).toBeUndefined();
  });

  it("throws on an unknown group name and names the valid set", async () => {
    await expect(
      volumeSearchTool({ standardPlace: EDENSOR_P, recordTypeGroups: ["Taxation"] }, LOCAL)
    ).rejects.toThrow(/Unknown record-type group\(s\): Taxation.*Tax/s);
    // Never falls through to an unfiltered search: upstream answers an
    // unrecognised id with totalCount 0 and status 200, which is
    // indistinguishable from a genuine absence of records.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects the sibling tools' singular recordType instead of ignoring it", async () => {
    // record_search and fulltext_search both take `recordType`, and nothing
    // validates input against the advertised schema, so without this guard the
    // field is dropped and the search silently returns everything.
    await expect(
      volumeSearchTool({
        standardPlace: EDENSOR_P,
        recordType: "probate",
      } as unknown as VolumeSearchInput, LOCAL)
    ).rejects.toThrow(/filters by recordTypeGroups.*not recordType/s);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resends recordTypeGroups unchanged on the paginated follow-up call", async () => {
    // Two real invocations: page 1 returns a cursor, page 2 sends it back. The
    // point is that the filter is identical across them — omitting it mid-
    // pagination would silently widen the search rather than error.
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()], { nextPageToken: "page-2-cursor" }),
      []
    );
    const first = await volumeSearchTool({
      standardPlace: EDENSOR_P,
      recordTypeGroups: ["Tax"],
    }, LOCAL);
    expect(first.nextPageToken).toBe("page-2-cursor");

    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({
      standardPlace: EDENSOR_P,
      recordTypeGroups: ["Tax"],
      pageToken: first.nextPageToken,
    }, LOCAL);

    // calls: [0] page-1 search, [1] page-1 fulltext, [2] page-2 search.
    const page1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const page2 = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(page2.nextPageToken).toBe("page-2-cursor");
    expect(page2.coverage.recordTypeConceptIds).toEqual(
      page1.coverage.recordTypeConceptIds
    );
    expect(page2.coverage.recordTypeConceptIds).toEqual([124410, 129065]);
  });

  it("rejects a non-array recordTypeGroups with a readable error", async () => {
    // The schema's enum is client-advisory — nothing validates input server-side
    // — so a bare string is a reachable mistake. Without this the tool would
    // throw "filter is not a function" from inside validate().
    await expect(
      volumeSearchTool({
        standardPlace: EDENSOR_P,
        recordTypeGroups: "Tax",
      } as unknown as VolumeSearchInput, LOCAL)
    ).rejects.toThrow(/recordTypeGroups must be an array/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("echoes recordTypeGroups in query", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    const result = await volumeSearchTool({
      standardPlace: EDENSOR_P,
      recordTypeGroups: ["Tax"],
    }, LOCAL);
    expect(result.query.recordTypeGroups).toEqual(["Tax"]);
  });

  // 16. Pagination — nextPageToken returned and used
  it("returns nextPageToken when present in the response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()], { nextPageToken: "abc123" }),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);
    expect(result.nextPageToken).toBe("abc123");
  });

  it("sends pageToken as nextPageToken in the request body", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageToken: "cursor-xyz" }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.nextPageToken).toBe("cursor-xyz");
  });

  // 17. 401 error
  it("throws re-login guidance on 401", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(401, "Unauthorized"));

    await expect(volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL)).rejects.toThrow(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  });

  // 18. Network error (retried by fetchWithRetry before surfacing)
  it("throws on network error", async () => {
    mockFetch.mockRejectedValue(socketFetchFailure());

    await expect(volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL)).rejects.toThrow(
      /Could not reach FamilySearch volume search API: fetch failed <- ETIMEDOUT/
    );
  });

  // 19. Correct headers sent
  it("sends Authorization, Content-Type, User-Agent, and FS-User-Agent-Chain headers", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL);

    const searchCall = mockFetch.mock.calls[0];
    const headers = new Headers(searchCall[1].headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
    expect(headers.get("FS-User-Agent-Chain")).toBe("chesworth");
  });

  // Bonus: unresolvable place
  // The bodyless 409 from the session behind issue #1988 rendered as
  // "FamilySearch volume search API error: 409 ." -- status, space, full stop.
  // No cause is asserted here: no 409 in this path is reproducible, and a
  // guessed upstream diagnosis is worse than none.
  it("gives a bodyless 409 a recovery instruction instead of a bare status", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(409, "", ""));

    const err = await volumeSearchTool(
      { standardPlace: "Pittsylvania, Virginia, United States", pageToken: "tok" },
      LOCAL
    ).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("re-issue this search from the first page");
    expect(err?.message).toContain("omitting pageToken");
    // The defect itself: a status followed by nothing actionable.
    expect(err?.message).not.toMatch(/409 \./);
  });

  it("includes the upstream body on a 409 that has one", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(409, "Conflict", "pageToken no longer valid")
    );

    const err = await volumeSearchTool(
      { standardPlace: "Pittsylvania, Virginia, United States", pageToken: "tok" },
      LOCAL
    ).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err?.message).toContain("pageToken no longer valid");
    expect(err?.message).toContain("re-issue this search from the first page");
  });

  // The generic arm was reached by no test before this one. 400 rather than
  // 500 deliberately: fetchWithRetry retries 5xx and the caller then sees its
  // exhaustion message, not this one.
  it("keeps the status/statusText shape on a non-409 non-OK, plus any body", async () => {
    mockFetch.mockResolvedValueOnce(
      makeErrorResponse(400, "Bad Request", "upstream exploded")
    );

    const err = await volumeSearchTool(
      { standardPlace: "Pittsylvania, Virginia, United States" },
      LOCAL
    ).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err?.message).toContain(
      "FamilySearch volume search API error: 400 Bad Request."
    );
    expect(err?.message).toContain("upstream exploded");
    // A 500 is not a paging problem; the pageToken advice must not leak into it.
    expect(err?.message).not.toContain("omitting pageToken");
  });

  it("throws when the standard place cannot be resolved", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({ kind: "unresolved" });

    await expect(
      volumeSearchTool({ standardPlace: "Nowhere" }, LOCAL)
    ).rejects.toThrow(/Could not resolve "Nowhere"/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // An ambiguous place used to raise the SAME "could not resolve" error as a
  // place that matches nothing, and the caller could not tell them apart. The
  // session behind issue #1988 dropped Franklin County from the research on
  // exactly that, then reported having searched it.
  it("names the candidates when the standard place is ambiguous", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: [
        "Franklin, Virginia, United States (County)",
        "Franklin, Virginia, United States (Independent City)",
      ],
    });

    await expect(
      volumeSearchTool(
        { standardPlace: "Franklin, Virginia, United States" },
        LOCAL
      )
    ).rejects.toThrow(
      /matches more than one place: Franklin, Virginia, United States \(County\); Franklin, Virginia, United States \(Independent City\)\..*including the parenthesised type/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The two arms must not converge on one string: an ambiguity that reads as
  // "could not resolve" is the bug, not the fix.
  it("does not reuse the unresolvable wording for an ambiguous place", async () => {
    mockResolveStandardPlaceToPlaceId.mockResolvedValueOnce({
      kind: "ambiguous",
      candidates: ["A (County)", "B (City)"],
    });

    // Captured rather than `.rejects.not.toThrow`, which passes vacuously when
    // the promise RESOLVES -- i.e. it would still be green if the ambiguity
    // check were deleted entirely.
    const err = await volumeSearchTool(
      { standardPlace: "Franklin" },
      LOCAL
    ).then(
      () => null,
      (e: unknown) => e as Error
    );
    expect(err, "an ambiguous place must still throw").toBeInstanceOf(Error);
    expect(err?.message).not.toMatch(/Could not resolve/);
    expect(err?.message).toContain("A (County)");
  });

  // Bonus: resolved place has no representations
  it("throws when the place has no representations", async () => {
    mockPlaceIdToRepIds.mockResolvedValueOnce([]);

    await expect(
      volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" }, LOCAL)
    ).rejects.toThrow(
      'No place representations found for "Edensor, Derbyshire, England, United Kingdom".'
    );
  });
});

// ─── Answer size (issue #3611) ───────────────────────────────────────────

// Over 50,000 characters Claude Code saves a tool result to a file the calling
// agents cannot Read. The fixture is the largest page measured in the hosted
// bundles: Freeborn, Minnesota 1870–1900, 100 volumes, a 99,517-character answer.
const FREEBORN: {
  response: MetadataRmsSearchResponse;
  fulltextIds: string[];
} = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "volume-search", "freeborn-1870-1900.json"),
    "utf8"
  )
);
const FREEBORN_P = "Freeborn, Minnesota, United States";
const HARD_LIMIT = 50_000;

function serveFreeborn(groups: MetadataRmsGroup[]) {
  mockFetch
    .mockResolvedValueOnce(
      makeOkResponse({ groups, numberReturned: groups.length, totalCount: 163, nextPageToken: "tok" })
    )
    .mockResolvedValueOnce(makeFulltextResponse(FREEBORN.fulltextIds));
}

function triples(groups: { coverages?: { place?: string; datesOrig?: string; recordTypeOrig?: string }[] }[]) {
  return new Set(
    groups.flatMap((g) =>
      (g.coverages ?? []).map((c) => JSON.stringify([c.place, c.datesOrig, c.recordTypeOrig]))
    )
  );
}

describe("volumeSearchTool answer size", () => {
  it("fits the real first page under the budget with no coverage cut", async () => {
    // At the default pageSize of 50 the first page is volumes 0–49, which holds
    // all seven statewide muster rolls (31–48 coverage rows each) and is the
    // worst 50-volume window of the fixture.
    serveFreeborn(FREEBORN.response.groups!.slice(0, 50));

    const result = await volumeSearchTool({ standardPlace: FREEBORN_P, startYear: 1870, endYear: 1900 }, LOCAL);

    expect(JSON.parse(mockFetch.mock.calls[0][1].body).pageSize).toBe(50);
    expect(result.results).toHaveLength(50);
    // Merging alone is what makes it fit: the budget net never fired.
    expect(result.results.filter((g) => g.coverageCount != null)).toEqual([]);
    expect(JSON.stringify(result).length).toBeLessThan(RESULT_CHAR_BUDGET);
  });

  it("loses no place, date range or record type when merging", async () => {
    const groups = FREEBORN.response.groups!.slice(0, 50);
    serveFreeborn(groups);

    const result = await volumeSearchTool({ standardPlace: FREEBORN_P }, LOCAL);

    const out = new Set(
      result.results.flatMap((g) =>
        g.coverages.flatMap((c) => c.places.map((p) => JSON.stringify([p, c.dateRange, c.recordType])))
      )
    );
    expect(out).toEqual(triples(groups));
  });

  it("keeps a full page of 100 under the limit by shortening coverages, never dropping a volume", async () => {
    serveFreeborn(FREEBORN.response.groups!);

    const result = await volumeSearchTool({ standardPlace: FREEBORN_P, pageSize: 100 }, LOCAL);

    expect(JSON.parse(mockFetch.mock.calls[0][1].body).pageSize).toBe(100);
    expect(result.results).toHaveLength(100);
    expect(result.nextPageToken).toBe("tok");
    const size = JSON.stringify(result).length;
    expect(size).toBeLessThan(HARD_LIMIT);
    expect(size).toBeLessThanOrEqual(RESULT_CHAR_BUDGET);
    const shortened = result.results.filter((g) => g.coverageCount != null);
    expect(shortened.length).toBeGreaterThan(0);
    for (const g of shortened) expect(g.coverageCount).toBeGreaterThan(g.coverages.length);
  });
});

describe("fitToBudget", () => {
  const coverage = (n: number) => ({ places: [`Town ${n}, Somewhere, United States`], dateRange: `${1800 + n}`, recordType: "Muster rolls" });
  const volume = (id: string, rows: number) => ({
    imageGroupNumber: id,
    imageCount: 10,
    recordSearchablePercent: null,
    fulltextSearchable: null,
    languages: ["en"],
    coverages: Array.from({ length: rows }, (_, i) => coverage(i)),
  });
  const page = (vols: ReturnType<typeof volume>[]) => ({
    query: { standardPlace: "X", pageSize: vols.length },
    totalResults: vols.length,
    results: vols,
  });

  it("returns an answer already under budget unchanged", () => {
    const input = page([volume("a", 3)]);
    expect(fitToBudget(input, 10_000)).toBe(input);
  });

  it("shortens only the volumes over the cap and marks exactly those", () => {
    const input = page([volume("big", 40), volume("small", 2)]);
    const budget = JSON.stringify(input).length - 100;

    const out = fitToBudget(input, budget);

    expect(JSON.stringify(out).length).toBeLessThanOrEqual(budget);
    expect(out.results.map((g) => g.imageGroupNumber)).toEqual(["big", "small"]);
    expect(out.results[0].coverageCount).toBe(40);
    expect(out.results[0].coverages.length).toBeLessThan(40);
    expect(out.results[1]).not.toHaveProperty("coverageCount");
    expect(out.results[1].coverages).toHaveLength(2);
  });

  it("shortens the longest volume first and leaves neighbours it has room for whole", () => {
    // Capping only "big" at 20 frees ~12,000 characters, so the 25-row neighbours
    // must keep all their rows even though they are over the first cap too.
    const input = page([volume("m1", 25), volume("big", 200), volume("m2", 25)]);
    const budget = JSON.stringify(input).length - 1_000;

    const out = fitToBudget(input, budget);

    expect(JSON.stringify(out).length).toBeLessThanOrEqual(budget);
    expect(out.results.map((g) => g.imageGroupNumber)).toEqual(["m1", "big", "m2"]);
    expect(out.results[1].coverages).toHaveLength(20);
    expect(out.results[1].coverageCount).toBe(200);
    for (const g of [out.results[0], out.results[2]]) {
      expect(g.coverages).toHaveLength(25);
      expect(g).not.toHaveProperty("coverageCount");
    }
  });

  it("keeps every volume and returns the most-shortened answer when nothing fits", () => {
    const input = page([volume("a", 5), volume("b", 5)]);
    const out = fitToBudget(input, 10);
    expect(out.results).toHaveLength(2);
    expect(out.results.every((g) => g.coverages.length === 1 && g.coverageCount === 5)).toBe(true);
  });
});

describe("mergeCoverages", () => {
  it("merges rows that differ only by place, in first-seen order without duplicates", () => {
    expect(
      mergeCoverages([
        { place: "Albert Lea", dateRange: "1881-1884", recordType: "Muster rolls" },
        { place: "Austin", dateRange: "1881-1884", recordType: "Muster rolls" },
        { place: "Albert Lea", dateRange: "1881-1884", recordType: "Muster rolls" },
        { place: "Albert Lea", dateRange: "1890", recordType: "Muster rolls" },
      ])
    ).toEqual([
      { places: ["Albert Lea", "Austin"], dateRange: "1881-1884", recordType: "Muster rolls" },
      { places: ["Albert Lea"], dateRange: "1890", recordType: "Muster rolls" },
    ]);
  });

  it("merges on the visible recordType even when the concept ids differ", () => {
    // Keyed on the id, these would print as two identical-looking rows.
    const out = mergeCoverages([
      { place: "A", dateRange: "1900", recordType: "Census", recordTypeConceptId: 1 },
      { place: "B", dateRange: "1900", recordType: "Census", recordTypeConceptId: 2 },
    ]);
    expect(out).toEqual([{ places: ["A", "B"], dateRange: "1900", recordType: "Census" }]);
  });

  it("keeps rows with no recordType apart when their concept ids differ, and shows the ids", () => {
    const out = mergeCoverages([
      { place: "A", dateRange: "1900", recordTypeConceptId: 1 },
      { place: "B", dateRange: "1900", recordTypeConceptId: 2 },
    ]);
    expect(out).toEqual([
      { places: ["A"], dateRange: "1900", recordTypeConceptId: 1 },
      { places: ["B"], dateRange: "1900", recordTypeConceptId: 2 },
    ]);
  });

  it("merges one span written with an en-dash and with a hyphen, keeping the first text", () => {
    // datesOrig writes "1881–1884"; the fallback from the structured pair writes "1881-1884".
    const out = mergeCoverages([
      { place: "A", dateRange: "1881–1884", recordType: "Muster rolls" },
      { place: "B", dateRange: "1881-1884", recordType: "Muster rolls" },
    ]);
    expect(out).toEqual([{ places: ["A", "B"], dateRange: "1881–1884", recordType: "Muster rolls" }]);
  });

  it("merges one span written with an em-dash or a spaced hyphen", () => {
    const out = mergeCoverages([
      { place: "A", dateRange: "1881—1884", recordType: "Muster rolls" },
      { place: "B", dateRange: "1881 - 1884", recordType: "Muster rolls" },
      { place: "C", dateRange: "1881-1884", recordType: "Muster rolls" },
    ]);
    expect(out).toEqual([{ places: ["A", "B", "C"], dateRange: "1881—1884", recordType: "Muster rolls" }]);
  });

  it("leaves places empty rather than listing a blank place", () => {
    expect(mergeCoverages([{ place: "", dateRange: "1900" }])).toEqual([{ places: [], dateRange: "1900" }]);
  });
});

describe("pageSize", () => {
  it("sends a caller's pageSize and echoes it in query", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    const result = await volumeSearchTool(
      { standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageSize: 20 },
      LOCAL
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).pageSize).toBe(20);
    expect(result.query.pageSize).toBe(20);
  });

  it.each([0, 101, 2.5, "50", -1, Number.NaN])("refuses pageSize %s before any request", async (pageSize) => {
    await expect(
      volumeSearchTool(
        { standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageSize: pageSize as number },
        LOCAL
      )
    ).rejects.toThrow("pageSize must be a whole number from 1 to 100.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts the bounds 1 and 100", async () => {
    for (const pageSize of [1, 100]) {
      setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
      await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageSize }, LOCAL);
    }
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).pageSize).toBe(1);
    expect(JSON.parse(mockFetch.mock.calls[2][1].body).pageSize).toBe(100);
  });

  it("names pageSize in the 409 recovery instruction", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(409, "", ""));
    await expect(
      volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageToken: "stale" }, LOCAL)
    ).rejects.toThrow(/recordTypeGroups and pageSize/);
  });
});

describe("volumeSearchTool — summary", () => {
  // The page call and the rollup's own 1,000-a-page call run together, so the
  // fetch mock answers by request body rather than by call order.
  function routeFetch(rollupSearch: () => unknown) {
    mockFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url.includes("/fulltext/")) return makeFulltextResponse([]);
      const body = JSON.parse(init?.body ?? "{}");
      if (body.pageSize === 1000) return rollupSearch();
      return makeOkResponse(makeSearchResponse([makeGroup()]));
    });
  }

  it("refuses summary alongside pageToken, before any call", async () => {
    await expect(
      volumeSearchTool({ standardPlace: "Edensor", summary: true, pageToken: "abc" }, LOCAL)
    ).rejects.toThrow(/first page only/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("adds the rollup when asked", async () => {
    routeFetch(() =>
      makeOkResponse(
        makeSearchResponse([
          makeGroup({ coverages: [{ recordTypeConceptId: 123363, recordTypeConceptIdHierarchy: [123363] }] }),
        ])
      )
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor", summary: true }, LOCAL);
    expect(result.results).toHaveLength(1);
    expect(result.summary).toMatchObject({
      totalVolumes: 1,
      complete: true,
      byRecordType: [{ group: "Census", volumes: 1, browseOnly: 0 }],
    });
    expect(result.summaryError).toBeUndefined();
  });

  it("still returns the page, with summaryError, when the rollup fails", async () => {
    routeFetch(() => makeErrorResponse(400, "Bad Request", "pageSize too large"));
    const result = await volumeSearchTool({ standardPlace: "Edensor", summary: true }, LOCAL);
    expect(result.results).toHaveLength(1);
    expect(result.summary).toBeUndefined();
    expect(result.summaryError).toMatch(/400.*pageSize too large/);
  });

  it("makes no rollup call when summary is not asked for", async () => {
    routeFetch(() => {
      throw new Error("rollup must not run");
    });
    const result = await volumeSearchTool({ standardPlace: "Edensor" }, LOCAL);
    expect(result.summary).toBeUndefined();
    expect(result.summaryError).toBeUndefined();
  });
});
