import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// The places-API conversion now lives in the shared resolver; mock it so the
// tool no longer fetches the places API (the fetch sequence is search,fulltext).
const mockStandardPlaceToPlaceId = vi.hoisted(() => vi.fn());
const mockPlaceIdToRepIds = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", () => ({
  standardPlaceToPlaceId: mockStandardPlaceToPlaceId,
  placeIdToRepIds: mockPlaceIdToRepIds,
}));

import { volumeSearchTool } from "../../src/tools/volume-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  VolumeSearchInput,
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
} from "../../src/types/volume-search.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
  mockStandardPlaceToPlaceId.mockReset();
  mockStandardPlaceToPlaceId.mockResolvedValue("6137147");
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

function makeErrorResponse(status: number, statusText: string) {
  return { ok: false, status, statusText, json: async () => ({}) };
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
    });

    expect(result.query).toEqual({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      startYear: 1730,
      endYear: 1810,
    });
    expect(result.totalResults).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].imageGroupNumber).toBe("004452257");
    expect(result.results[0].imageGroupPrefix).toBe("004452257");
    expect(result.results[0].imageCount).toBe(412);
    expect(result.results[0].recordSearchablePercent).toBe(89);
    expect(result.results[0].fulltextSearchable).toBe(true);
    expect(result.results[0].languages).toEqual(["en", "la"]);
    expect(result.results[0].coverages).toEqual([
      {
        place: "Edensor, Derbyshire, England, United Kingdom",
        dateRange: "1726–1812",
        recordType: "Burial Records",
      },
    ]);
  });

  // 2. Missing placeId
  it("throws when standardPlace is missing", async () => {
    await expect(
      volumeSearchTool({ standardPlace: "" })
    ).rejects.toThrow("volume_search requires a standardPlace.");
  });

  // 3. Year → ISO date string derivation
  it("derives fromDateString/toDateString from startYear/endYear", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      startYear: 1730,
      endYear: 1810,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.coverage.fromDateString).toBe("1730-01-01");
    expect(body.coverage.toDateString).toBe("1810-12-31");
  });

  it("omits date bounds from the request when no years are given", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

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
      })
    ).rejects.toThrow("endYear must be greater than or equal to startYear.");
  });

  // 4. placeId → placeRepIds conversion
  it("converts placeId to placeRepIds in coverage.placeRepIds", async () => {
    setupCalls([2968392, 10609408], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    expect(mockStandardPlaceToPlaceId).toHaveBeenCalledWith(
      "Edensor, Derbyshire, England, United Kingdom"
    );
    const searchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(searchCall[1].body);
    expect(body.coverage.placeRepIds).toEqual([2968392, 10609408]);
  });

  // 5. Fixed fields
  it("sends types NATURAL, active true, pageSize 100, returnChildCounts true", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.types).toEqual(["NATURAL"]);
    expect(body.active).toBe(true);
    expect(body.pageSize).toBe(100);
    expect(body.returnChildCounts).toBe(true);
  });

  // 6. imageGroupPrefix derivation
  it("derives imageGroupPrefix for bare groupName", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup({ groupName: "004452257" })]), []);
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].imageGroupPrefix).toBe("004452257");
  });

  it("derives imageGroupPrefix for 3-segment groupName", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "007621224_005_M99P-2TQ" })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].imageGroupNumber).toBe("007621224_005_M99P-2TQ");
    expect(result.results[0].imageGroupPrefix).toBe("007621224");
  });

  // 7. recordSearchablePercent calculation
  it("computes recordSearchablePercent correctly from inline counts", async () => {
    // 366 indexed / (412 total - 0 non-indexable) * 100 = ~88.8 → 89
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 412, indexedChildCount: 366, noIndexableDataChildCount: 0 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].recordSearchablePercent).toBe(89);
  });

  it("excludes non-indexable images from denominator", async () => {
    // 80 indexed / (100 - 20 non-indexable) * 100 = 100
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 100, indexedChildCount: 80, noIndexableDataChildCount: 20 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].recordSearchablePercent).toBe(100);
  });

  // 8. Zero denominator edge case
  it("sets recordSearchablePercent to null when denominator <= 0", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 10, indexedChildCount: 0, noIndexableDataChildCount: 10 })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].recordSearchablePercent).toBeNull();
  });

  // 9. Missing counts in response → null
  it("sets imageCount and recordSearchablePercent to null when counts are absent from group", async () => {
    const groupNoCount = makeGroup();
    delete (groupNoCount as Partial<MetadataRmsGroup>).childCount;
    delete (groupNoCount as Partial<MetadataRmsGroup>).indexedChildCount;
    setupCalls([2968392], makeSearchResponse([groupNoCount]), []);

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
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
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].fulltextSearchable).toBe(true);
  });

  it("sets fulltextSearchable false for groups not in the fulltext response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "004452257" })]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].fulltextSearchable).toBe(false);
  });

  // 11. fulltextSearchable null on fulltext call failure
  it("sets fulltextSearchable to null when fulltext call fails 3 times", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makeSearchResponse([makeGroup()])))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"));

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].fulltextSearchable).toBeNull();
  });

  // 12. Fulltext batch URL includes all groupNames
  it("sends all groupNames in the fulltext batch call", async () => {
    const groups = [
      makeGroup({ id: "id-1", groupName: "111111111" }),
      makeGroup({ id: "id-2", groupName: "222222222" }),
    ];
    setupCalls([2968392], makeSearchResponse(groups), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    // calls: [0] search, [1] fulltext
    const fulltextCall = mockFetch.mock.calls[1];
    expect(fulltextCall[0]).toContain("111111111");
    expect(fulltextCall[0]).toContain("222222222");
  });

  // 13. Coverage mapping
  it("maps coverages to place, dateRange, recordType", async () => {
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
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.results[0].coverages[0]).toEqual({
      place: "Edensor",
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
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    const coverages = result.results[0].coverages;
    // Opaque internal id — nothing a reader can use.
    expect(coverages[0].recordType).toBeUndefined();
    // `title:` marks provenance, not a placeholder: the value is a real record
    // type and every live `title:`-prefixed value observed was one. Dropping
    // these hid the Swedish mantalslängder from volume_search (issue #572).
    expect(coverages[1].recordType).toBe("Taxation");
    expect(coverages[2].recordType).toBe("Probate records");
    // Unprefixed values are unaffected.
    expect(coverages[3].recordType).toBe("Burial Records");
    // A bare prefix leaves nothing behind, so the field stays absent.
    expect(coverages[4].recordType).toBeUndefined();
    // dateRange carries the same provenance prefix and is stripped the same way.
    expect(coverages[5].dateRange).toBe("1683-1700");
    expect(coverages[5].recordType).toBe("Court records");
    // An unprefixed date range is untouched.
    expect(coverages[6].dateRange).toBe("1726-1812");
  });

  // 15. Empty result set
  it("handles empty totalCount:0 response", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ totalCount: 0 }));

    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.totalResults).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  const EDENSOR_P = "Edensor, Derbyshire, England, United Kingdom";

  // 15a-15b. Structured coverage dates
  it("parses startYear/endYear from the ISO date pair", async () => {
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
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P });
    const c = result.results[0].coverages[0];
    expect(c.startYear).toBe(1726);
    expect(c.endYear).toBe(1812);
    // datesOrig present, so dateRange stays the archival display text.
    expect(c.dateRange).toBe("1726-1812");
  });

  it("omits startYear/endYear when the date pair is absent", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({ coverages: [{ place: "Edensor", datesOrig: "1726-1812" }] }),
      ]),
      []
    );
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P });
    const c = result.results[0].coverages[0];
    expect(c.startYear).toBeUndefined();
    expect(c.endYear).toBeUndefined();
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
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P });
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
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P });
    expect(result.results[0].coverages[0].dateRange).toBe("1683-1700");
  });

  it("surfaces recordTypeConceptId, the stable key behind recordType", async () => {
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
    const result = await volumeSearchTool({ standardPlace: EDENSOR_P });
    const [named, placeholder] = result.results[0].coverages;
    expect(named.recordType).toBe("Konfirmationslängd");
    expect(named.recordTypeConceptId).toBe(101655);
    // recordType is dropped as an opaque id, but the concept id still identifies it.
    expect(placeholder.recordType).toBeUndefined();
    expect(placeholder.recordTypeConceptId).toBe(124231);
  });

  // 15c-15f. Record-type group filtering
  const EDENSOR = "Edensor, Derbyshire, England, United Kingdom";

  it("expands a group to its anchor and sends it inside coverage", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    // Marriage carries no strays, so this isolates the anchor path.
    await volumeSearchTool({ standardPlace: EDENSOR, recordTypeGroups: ["Marriage"] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Inside `coverage`, not at the top level — at the top level it is ignored.
    expect(body.coverage.recordTypeConceptIds).toEqual([104727]);
    expect(body.recordTypeConceptIds).toBeUndefined();
  });

  it("sends a group's strays alongside its anchor", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR, recordTypeGroups: ["Prison"] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // 131448 police records, 130086 criminal records and 126416 criminal case
    // files all sit outside 123478's subtree, so containment cannot reach them.
    expect(body.coverage.recordTypeConceptIds.sort()).toEqual(
      [123478, 131448, 130086, 126416].sort()
    );
  });

  it("ORs multiple groups into one id array", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({
      standardPlace: EDENSOR,
      recordTypeGroups: ["Tax", "Census"],
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Tax anchor + Tax stray + Census anchor + Census stray.
    expect(body.coverage.recordTypeConceptIds.sort()).toEqual(
      [124410, 129065, 123363, 104611].sort()
    );
  });

  it("sends a parent's anchor plus its descendants' strays, not their anchors", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR, recordTypeGroups: ["Legal"] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Court, Probate, Wills and Land anchors are NOT enumerated — the API
    // expands 122797's subtree itself. Their strays are, because a stray sits
    // outside that subtree and containment cannot reach it.
    expect(body.coverage.recordTypeConceptIds.sort()).toEqual(
      [122797, 127571, 127073, 129547].sort()
    );
  });

  it("treats an empty recordTypeGroups array as no filter", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({ standardPlace: EDENSOR, recordTypeGroups: [] });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Upstream treats an empty id list as no filter; omit it rather than send a
    // no-op that reads like a filter.
    expect(body.coverage.recordTypeConceptIds).toBeUndefined();
  });

  it("throws on an unknown group name and names the valid set", async () => {
    await expect(
      volumeSearchTool({ standardPlace: EDENSOR, recordTypeGroups: ["Taxation"] })
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
        standardPlace: EDENSOR,
        recordType: "probate",
      } as unknown as VolumeSearchInput)
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
      standardPlace: EDENSOR,
      recordTypeGroups: ["Tax"],
    });
    expect(first.nextPageToken).toBe("page-2-cursor");

    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    await volumeSearchTool({
      standardPlace: EDENSOR,
      recordTypeGroups: ["Tax"],
      pageToken: first.nextPageToken,
    });

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
        standardPlace: EDENSOR,
        recordTypeGroups: "Tax",
      } as unknown as VolumeSearchInput)
    ).rejects.toThrow(/recordTypeGroups must be an array/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("echoes recordTypeGroups in query", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);
    const result = await volumeSearchTool({
      standardPlace: EDENSOR,
      recordTypeGroups: ["Tax"],
    });
    expect(result.query.recordTypeGroups).toEqual(["Tax"]);
  });

  // 16. Pagination — nextPageToken returned and used
  it("returns nextPageToken when present in the response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()], { nextPageToken: "abc123" }),
      []
    );
    const result = await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.nextPageToken).toBe("abc123");
  });

  it("sends pageToken as nextPageToken in the request body", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageToken: "cursor-xyz" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.nextPageToken).toBe("cursor-xyz");
  });

  // 17. 401 error
  it("throws re-login guidance on 401", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(401, "Unauthorized"));

    await expect(volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })).rejects.toThrow(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  });

  // 18. Network error
  it("throws on network error", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })).rejects.toThrow(
      "Could not reach FamilySearch volume search API: ECONNREFUSED."
    );
  });

  // 19. Correct headers sent
  it("sends Authorization, Content-Type, User-Agent, and FS-User-Agent-Chain headers", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    const searchCall = mockFetch.mock.calls[0];
    const headers = searchCall[1].headers;
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
    expect(headers["FS-User-Agent-Chain"]).toBe("chesworth");
  });

  // Bonus: unresolvable place
  it("throws when the standard place cannot be resolved", async () => {
    mockStandardPlaceToPlaceId.mockResolvedValueOnce(null);

    await expect(
      volumeSearchTool({ standardPlace: "Nowhere" })
    ).rejects.toThrow(/Could not resolve "Nowhere"/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Bonus: resolved place has no representations
  it("throws when the place has no representations", async () => {
    mockPlaceIdToRepIds.mockResolvedValueOnce([]);

    await expect(
      volumeSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })
    ).rejects.toThrow(
      'No place representations found for "Edensor, Derbyshire, England, United Kingdom".'
    );
  });
});
