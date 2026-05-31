import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { imageSearchTool } from "../../src/tools/image-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import type {
  FSPlaceLookupResponse,
  RmsSearchResponse,
  RmsGroup,
} from "../../src/types/image-search.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------- fixtures ----------

// Shape of GET /places/{placeId}: bare place entry (no display) followed by
// representations whose top-level `place.resourceId` points back to the placeId.
function forwardPlacesResponse(
  placeId: string,
  repIds: string[]
): FSPlaceLookupResponse {
  return {
    places: [
      { id: placeId, names: [{ lang: "en", value: "Edensor" }] } as never,
      ...repIds.map((id) => ({
        id,
        place: {
          resource: `https://api.familysearch.org/platform/places/${placeId}`,
          resourceId: placeId,
        },
        identifiers: {
          "http://gedcomx.org/Primary": [
            `https://api.familysearch.org/platform/places/${placeId}`,
          ],
        },
        display: { name: "Edensor", fullName: "Edensor, Derbyshire", type: "Village" },
      })),
    ],
  };
}

// Shape of GET /places/description/{repId}: the representation with its Primary
// identifier resolving to the placeId.
function descriptionResponse(repId: string, placeId: string): FSPlaceLookupResponse {
  return {
    places: [
      {
        id: repId,
        identifiers: {
          "http://gedcomx.org/Primary": [
            `https://api.familysearch.org/platform/places/${placeId}`,
          ],
        },
        display: { name: "Edensor", fullName: "Edensor, Derbyshire", type: "Village" },
      },
    ],
  };
}

const sampleGroup: RmsGroup = {
  id: "DGS-004452257",
  groupName: "004452257",
  active: true,
  types: ["NATURAL", "DGS"],
  creators: ["Church of England. Parish Church of Edensor (Derbyshire)"],
  languages: ["en", "la"],
  coverages: [
    {
      place: "Edensor, Derbyshire, England, United Kingdom",
      placeRepId: 2968392,
      datesOrig: "1726–1812",
      recordTypeOrig: "Burial Records",
      placeRelevance: 94,
    },
  ],
};

// Routes mock fetch by URL so place mode (forward lookup + RMS + reverse
// lookups) works in one configuration.
function routeFetch(opts: {
  reps?: string[]; // placeRepIds returned by the forward lookup
  placeId?: string;
  rms?: RmsSearchResponse | { status: number; statusText?: string };
  rmsReject?: Error;
  repToPlaceId?: Record<string, string>;
}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/places/description/")) {
      const repId = url.split("/places/description/")[1].split("?")[0];
      const placeId = opts.repToPlaceId?.[repId];
      if (placeId == null) {
        return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => descriptionResponse(repId, placeId),
      });
    }
    if (url.includes("/group/search")) {
      if (opts.rmsReject) return Promise.reject(opts.rmsReject);
      const rms = opts.rms;
      if (rms && "status" in rms) {
        return Promise.resolve({
          ok: false,
          status: rms.status,
          statusText: rms.statusText ?? "Error",
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => rms ?? { groups: [], numberReturned: 0, totalCount: 0 },
      });
    }
    // forward /places/{placeId}
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () =>
        forwardPlacesResponse(opts.placeId ?? "6137147", opts.reps ?? []),
    });
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("imageSearchTool — happy paths", () => {
  it("returns groups for placeId + date range query", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392", "10609408"],
      rms: { groups: [sampleGroup], numberReturned: 1, totalCount: 1 },
      repToPlaceId: { "2968392": "6137147" },
    });

    const result = await imageSearchTool({
      placeId: "6137147",
      fromDate: "1730-01-01",
      toDate: "1810-12-31",
    });

    expect(result.totalGroups).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.groups[0].imageGroupNumber).toBe("004452257");
    expect(result.query).toEqual({
      placeId: "6137147",
      fromDate: "1730-01-01",
      toDate: "1810-12-31",
    });
  });

  it("returns groups for image group number query", async () => {
    routeFetch({ rms: { groups: [sampleGroup], numberReturned: 1, totalCount: 1 } });

    const result = await imageSearchTool({ imageGroupNumber: "004452257" });

    expect(result.totalGroups).toBe(1);
    expect(result.groups[0].id).toBe("DGS-004452257");
    expect(result.query).toEqual({ imageGroupNumber: "004452257" });
  });
});

describe("imageSearchTool — input validation", () => {
  it("throws when neither placeId nor imageGroupNumber provided", async () => {
    await expect(imageSearchTool({})).rejects.toThrow(
      "image_search requires either placeId or imageGroupNumber."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when both placeId and imageGroupNumber provided", async () => {
    await expect(
      imageSearchTool({ placeId: "6137147", imageGroupNumber: "004452257" })
    ).rejects.toThrow("Provide either placeId or imageGroupNumber, not both.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when fromDate is invalid format", async () => {
    await expect(
      imageSearchTool({ placeId: "6137147", fromDate: "1730" })
    ).rejects.toThrow("fromDate must be in YYYY-MM-DD format");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when fromDate/toDate provided without placeId", async () => {
    await expect(
      imageSearchTool({ imageGroupNumber: "004452257", fromDate: "1730-01-01" })
    ).rejects.toThrow("fromDate and toDate require placeId.");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when places API returns no placeRepIds", async () => {
    routeFetch({ placeId: "6137147", reps: [] });
    await expect(imageSearchTool({ placeId: "6137147" })).rejects.toThrow(
      "No place representations found for placeId 6137147."
    );
  });
});

describe("imageSearchTool — placeId conversion", () => {
  it("converts placeId to placeRepIds via the places API", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392", "10609408"],
      rms: { groups: [], numberReturned: 0, totalCount: 0 },
    });

    await imageSearchTool({ placeId: "6137147" });

    const forwardCall = mockFetch.mock.calls.find(
      (c) => (c[0] as string).endsWith("/platform/places/6137147")
    );
    expect(forwardCall).toBeDefined();
  });

  it("passes all placeRepIds in a single RMS call via coverage.placeRepIds", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392", "10609408"],
      rms: { groups: [], numberReturned: 0, totalCount: 0 },
    });

    await imageSearchTool({
      placeId: "6137147",
      fromDate: "1730-01-01",
      toDate: "1810-12-31",
    });

    const rmsCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/group/search")
    );
    const body = JSON.parse((rmsCall![1] as RequestInit).body as string);
    expect(body.coverage.placeRepIds).toEqual([2968392, 10609408]);
    expect(body.coverage.fromDateString).toBe("1730-01-01");
    expect(body.coverage.toDateString).toBe("1810-12-31");
    expect(body.types).toEqual(["NATURAL"]);
    expect(body.returnChildCounts).toBe(false);
    expect(body.active).toBe(true);
    // single RMS call
    const rmsCalls = mockFetch.mock.calls.filter((c) =>
      (c[0] as string).includes("/group/search")
    );
    expect(rmsCalls).toHaveLength(1);
  });
});

describe("imageSearchTool — request construction", () => {
  it("builds correct request body for place mode", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392"],
      rms: { groups: [], numberReturned: 0, totalCount: 0 },
    });

    await imageSearchTool({ placeId: "6137147" });

    const rmsCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/group/search")
    );
    const body = JSON.parse((rmsCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      coverage: { placeRepIds: [2968392] },
      types: ["NATURAL"],
      returnChildCounts: false,
      active: true,
    });
  });

  it("builds correct request body for image group number mode (appends wildcard)", async () => {
    routeFetch({ rms: { groups: [], numberReturned: 0, totalCount: 0 } });

    await imageSearchTool({ imageGroupNumber: "007621224" });

    const rmsCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/group/search")
    );
    const body = JSON.parse((rmsCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      name: "007621224*",
      types: ["NATURAL"],
      returnChildCounts: false,
      active: true,
    });
  });
});

describe("imageSearchTool — response mapping", () => {
  it("maps API response to simplified output", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392"],
      rms: { groups: [sampleGroup], numberReturned: 1, totalCount: 1 },
      repToPlaceId: { "2968392": "6137147" },
    });

    const result = await imageSearchTool({ placeId: "6137147" });

    expect(result.groups[0]).toEqual({
      id: "DGS-004452257",
      imageGroupNumber: "004452257",
      types: ["NATURAL", "DGS"],
      creators: ["Church of England. Parish Church of Edensor (Derbyshire)"],
      languages: ["en", "la"],
      coverages: [
        {
          place: "Edensor, Derbyshire, England, United Kingdom",
          placeId: "6137147",
          dateRange: "1726–1812",
          recordType: "Burial Records",
          placeRelevance: 94,
        },
      ],
    });
  });

  it("handles groups with multiple coverages", async () => {
    const multi: RmsGroup = {
      id: "DGS-1",
      groupName: "1",
      types: ["NATURAL"],
      creators: [],
      languages: ["en"],
      coverages: [
        { place: "A", placeRepId: 100, placeRelevance: 90 },
        { place: "B", placeRepId: 200, placeRelevance: 80 },
      ],
    };
    routeFetch({
      placeId: "6137147",
      reps: ["2968392"],
      rms: { groups: [multi], numberReturned: 1, totalCount: 1 },
      repToPlaceId: { "100": "111", "200": "222" },
    });

    const result = await imageSearchTool({ placeId: "6137147" });

    expect(result.groups[0].coverages).toHaveLength(2);
    expect(result.groups[0].coverages[0].placeId).toBe("111");
    expect(result.groups[0].coverages[1].placeId).toBe("222");
  });

  it("converts placeRepId in coverage to placeId in output", async () => {
    routeFetch({
      placeId: "6137147",
      reps: ["2968392"],
      rms: { groups: [sampleGroup], numberReturned: 1, totalCount: 1 },
      repToPlaceId: { "2968392": "6137147" },
    });

    const result = await imageSearchTool({ placeId: "6137147" });

    expect(result.groups[0].coverages[0].placeId).toBe("6137147");
    const reverseCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/places/description/2968392")
    );
    expect(reverseCall).toBeDefined();
  });

  it("handles empty groups response", async () => {
    // API returns {"totalCount": 0} with no groups/numberReturned keys.
    routeFetch({ rms: { totalCount: 0 } });

    const result = await imageSearchTool({ imageGroupNumber: "nope" });

    expect(result.totalGroups).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.groups).toEqual([]);
  });
});

describe("imageSearchTool — error handling", () => {
  it("throws auth error when not authenticated", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("User is not logged in to FamilySearch. Call the login tool to authenticate.")
    );

    await expect(imageSearchTool({ imageGroupNumber: "004452257" })).rejects.toThrow(
      /not logged in/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on 401 with re-login guidance", async () => {
    routeFetch({ rms: { status: 401, statusText: "Unauthorized" } });

    await expect(imageSearchTool({ imageGroupNumber: "004452257" })).rejects.toThrow(
      "FamilySearch session not accepted; call the login tool to re-authenticate."
    );
  });

  it("throws on network error", async () => {
    routeFetch({ rmsReject: new Error("ECONNREFUSED") });

    await expect(imageSearchTool({ imageGroupNumber: "004452257" })).rejects.toThrow(
      "Could not reach FamilySearch image search API: ECONNREFUSED."
    );
  });
});

describe("imageSearchTool — header contract", () => {
  it("sends Authorization, Content-Type, User-Agent, FS-User-Agent-Chain on the RMS call", async () => {
    routeFetch({ rms: { groups: [], numberReturned: 0, totalCount: 0 } });

    await imageSearchTool({ imageGroupNumber: "004452257" });

    const rmsCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes("/group/search")
    );
    const init = rmsCall![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("PUT");
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
    expect(headers["FS-User-Agent-Chain"]).toBe("chesworth");
  });
});
