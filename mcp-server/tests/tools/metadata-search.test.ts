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

import { metadataSearchTool } from "../../src/tools/metadata-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  MetadataRmsSearchResponse,
  MetadataRmsGroup,
} from "../../src/types/metadata-search.js";

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

describe("metadataSearchTool", () => {
  // 1. Happy path
  it("returns groups for placeId + date range", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()]),
      ["004452257"]
    );

    const result = await metadataSearchTool({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      fromDate: "1730-01-01",
      toDate: "1810-12-31",
    });

    expect(result.query).toEqual({
      standardPlace: "Edensor, Derbyshire, England, United Kingdom",
      fromDate: "1730-01-01",
      toDate: "1810-12-31",
    });
    expect(result.totalGroups).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].imageGroupNumber).toBe("004452257");
    expect(result.groups[0].imageGroupPrefix).toBe("004452257");
    expect(result.groups[0].imageCount).toBe(412);
    expect(result.groups[0].recordSearchablePercent).toBe(89);
    expect(result.groups[0].fulltextSearchable).toBe(true);
    expect(result.groups[0].languages).toEqual(["en", "la"]);
    expect(result.groups[0].coverages).toEqual([
      {
        place: "Edensor, Derbyshire, England, United Kingdom",
        dateRange: "1726–1812",
        recordType: "Burial Records",
      },
    ]);
  });

  // 2. Missing placeId
  it("throws when placeId is missing", async () => {
    await expect(
      metadataSearchTool({ standardPlace: "" })
    ).rejects.toThrow("metadata_search requires a standardPlace.");
  });

  // 3. Malformed date
  it("throws when fromDate is malformed", async () => {
    await expect(
      metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", fromDate: "1730/01/01" })
    ).rejects.toThrow("fromDate must be in YYYY-MM-DD format");
  });

  it("throws when toDate is malformed", async () => {
    await expect(
      metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", toDate: "bad-date" })
    ).rejects.toThrow("toDate must be in YYYY-MM-DD format");
  });

  // 4. placeId → placeRepIds conversion
  it("converts placeId to placeRepIds in coverage.placeRepIds", async () => {
    setupCalls([2968392, 10609408], makeSearchResponse([makeGroup()]), []);

    await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    expect(mockStandardPlaceToPlaceId).toHaveBeenCalledWith(
      "Edensor, Derbyshire, England, United Kingdom"
    );
    const searchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(searchCall[1].body);
    expect(body.coverage.placeRepIds).toEqual(["2968392", "10609408"]);
  });

  // 5. Fixed fields
  it("sends types NATURAL, active true, pageSize 100, returnChildCounts true", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.types).toEqual(["NATURAL"]);
    expect(body.active).toBe(true);
    expect(body.pageSize).toBe(100);
    expect(body.returnChildCounts).toBe(true);
  });

  // 6. imageGroupPrefix derivation
  it("derives imageGroupPrefix for bare groupName", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup({ groupName: "004452257" })]), []);
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].imageGroupPrefix).toBe("004452257");
  });

  it("derives imageGroupPrefix for 3-segment groupName", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "007621224_005_M99P-2TQ" })]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].imageGroupNumber).toBe("007621224_005_M99P-2TQ");
    expect(result.groups[0].imageGroupPrefix).toBe("007621224");
  });

  // 7. recordSearchablePercent calculation
  it("computes recordSearchablePercent correctly from inline counts", async () => {
    // 366 indexed / (412 total - 0 non-indexable) * 100 = ~88.8 → 89
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 412, indexedChildCount: 366, noIndexableDataChildCount: 0 })]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].recordSearchablePercent).toBe(89);
  });

  it("excludes non-indexable images from denominator", async () => {
    // 80 indexed / (100 - 20 non-indexable) * 100 = 100
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 100, indexedChildCount: 80, noIndexableDataChildCount: 20 })]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].recordSearchablePercent).toBe(100);
  });

  // 8. Zero denominator edge case
  it("sets recordSearchablePercent to null when denominator <= 0", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ childCount: 10, indexedChildCount: 0, noIndexableDataChildCount: 10 })]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].recordSearchablePercent).toBeNull();
  });

  // 9. Missing counts in response → null
  it("sets imageCount and recordSearchablePercent to null when counts are absent from group", async () => {
    const groupNoCount = makeGroup();
    delete (groupNoCount as Partial<MetadataRmsGroup>).childCount;
    delete (groupNoCount as Partial<MetadataRmsGroup>).indexedChildCount;
    setupCalls([2968392], makeSearchResponse([groupNoCount]), []);

    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].imageCount).toBeNull();
    expect(result.groups[0].recordSearchablePercent).toBeNull();
  });

  // 10. fulltextSearchable true/false mapping
  it("sets fulltextSearchable true for groups in the fulltext response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "004452257" })]),
      ["004452257"]
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].fulltextSearchable).toBe(true);
  });

  it("sets fulltextSearchable false for groups not in the fulltext response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup({ groupName: "004452257" })]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].fulltextSearchable).toBe(false);
  });

  // 11. fulltextSearchable null on fulltext call failure
  it("sets fulltextSearchable to null when fulltext call fails 3 times", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(makeSearchResponse([makeGroup()])))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"));

    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].fulltextSearchable).toBeNull();
  });

  // 12. Fulltext batch URL includes all groupNames
  it("sends all groupNames in the fulltext batch call", async () => {
    const groups = [
      makeGroup({ id: "id-1", groupName: "111111111" }),
      makeGroup({ id: "id-2", groupName: "222222222" }),
    ];
    setupCalls([2968392], makeSearchResponse(groups), []);

    await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

    // calls: [0] places, [1] search, [2] fulltext
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
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].coverages[0]).toEqual({
      place: "Edensor",
      dateRange: "1726–1812",
      recordType: "Burial Records",
    });
  });

  // 14. Placeholder recordType filtering
  it("omits recordType when value starts with concept-id: or title:", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([
        makeGroup({
          coverages: [
            { place: "Edensor", recordTypeOrig: "concept-id:burial" },
            { place: "Edensor", recordTypeOrig: "title:burial" },
          ],
        }),
      ]),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.groups[0].coverages[0].recordType).toBeUndefined();
    expect(result.groups[0].coverages[1].recordType).toBeUndefined();
  });

  // 15. Empty result set
  it("handles empty totalCount:0 response", async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ totalCount: 0 }));

    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.totalGroups).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.groups).toHaveLength(0);
  });

  // 16. Pagination — nextPageToken returned and used
  it("returns nextPageToken when present in the response", async () => {
    setupCalls(
      [2968392],
      makeSearchResponse([makeGroup()], { nextPageToken: "abc123" }),
      []
    );
    const result = await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });
    expect(result.nextPageToken).toBe("abc123");
  });

  it("sends pageToken as nextPageToken in the request body", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom", pageToken: "cursor-xyz" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.nextPageToken).toBe("cursor-xyz");
  });

  // 17. 401 error
  it("throws re-login guidance on 401", async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(401, "Unauthorized"));

    await expect(metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })).rejects.toThrow(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  });

  // 18. Network error
  it("throws on network error", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })).rejects.toThrow(
      "Could not reach FamilySearch metadata search API: ECONNREFUSED."
    );
  });

  // 19. Correct headers sent
  it("sends Authorization, Content-Type, User-Agent, and FS-User-Agent-Chain headers", async () => {
    setupCalls([2968392], makeSearchResponse([makeGroup()]), []);

    await metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" });

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
      metadataSearchTool({ standardPlace: "Nowhere" })
    ).rejects.toThrow(/Could not resolve "Nowhere"/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Bonus: resolved place has no representations
  it("throws when the place has no representations", async () => {
    mockPlaceIdToRepIds.mockResolvedValueOnce([]);

    await expect(
      metadataSearchTool({ standardPlace: "Edensor, Derbyshire, England, United Kingdom" })
    ).rejects.toThrow(
      'No place representations found for "Edensor, Derbyshire, England, United Kingdom".'
    );
  });
});
