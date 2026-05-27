import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  personRecordMatches,
  recordPersonMatches,
  personPersonMatches,
  recordRecordMatches,
} from "../../src/tools/match-by-id.js";
import { getValidToken } from "../../src/auth/refresh.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const EMPTY_BODY = { entries: [], results: 0, title: "x", updated: "2025-01-01T00:00:00Z" };

function mockJson(body: unknown, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    headers: new Headers({ "content-type": "application/json" }),
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

describe("URL construction", () => {
  it("person_record_matches builds the right URL", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.host).toBe("sg30p0.familysearch.org");
    expect(url.pathname).toBe("/search/match/resolutions/match/matches");
    expect(url.searchParams.get("collection")).toBe("records");
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
    expect(url.searchParams.get("minConfidence")).toBe("2");
    expect(url.searchParams.get("count")).toBe("20");
    expect(url.searchParams.get("includeSummary")).toBe("false");
    expect(url.searchParams.getAll("status")).toEqual(["accepted", "pending", "rejected"]);
    expect(url.searchParams.has("includeFlags")).toBe(false);
  });

  it("record_person_matches: collection=tree, ark prefix 1:1:", async () => {
    mockJson(EMPTY_BODY);
    await recordPersonMatches({ id: "QPTX-TMQ2" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("tree");
    expect(url.searchParams.get("id")).toBe("ark:/61903/1:1:QPTX-TMQ2");
  });

  it("person_person_matches: collection=tree, ark prefix 4:1:", async () => {
    mockJson(EMPTY_BODY);
    await personPersonMatches({ id: "KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("tree");
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
  });

  it("record_record_matches: collection=records, ark prefix 1:1:", async () => {
    mockJson(EMPTY_BODY);
    await recordRecordMatches({ id: "QPTX-TMQ2" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("collection")).toBe("records");
    expect(url.searchParams.get("id")).toBe("ark:/61903/1:1:QPTX-TMQ2");
  });

  it("sends Authorization, Accept, and User-Agent headers", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG" });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.headers.Accept).toBe("application/json");
    expect(typeof init.headers["User-Agent"]).toBe("string");
    expect((init.headers["User-Agent"] as string).length).toBeGreaterThan(10);
  });
});

describe("Input validation", () => {
  it("rejects empty id", async () => {
    await expect(personRecordMatches({ id: "" })).rejects.toThrow(/non-empty id/);
  });

  it("rejects whitespace-only id", async () => {
    await expect(personRecordMatches({ id: "   " })).rejects.toThrow(/non-empty id/);
  });

  it("person_record_matches rejects a 1:1: ARK with sibling hint", async () => {
    await expect(
      personRecordMatches({ id: "ark:/61903/1:1:QPTX-TMQ2" }),
    ).rejects.toThrow(/record_record_matches/);
  });

  it("record_person_matches rejects a 4:1: ARK with sibling hint", async () => {
    await expect(
      recordPersonMatches({ id: "ark:/61903/4:1:KNDX-MKG" }),
    ).rejects.toThrow(/person_person_matches/);
  });

  it("person_person_matches rejects a 1:1: ARK with sibling hint", async () => {
    await expect(
      personPersonMatches({ id: "ark:/61903/1:1:QPTX-TMQ2" }),
    ).rejects.toThrow(/record_person_matches/);
  });

  it("record_record_matches rejects a 4:1: ARK with sibling hint", async () => {
    await expect(
      recordRecordMatches({ id: "ark:/61903/4:1:KNDX-MKG" }),
    ).rejects.toThrow(/person_record_matches/);
  });

  it("rejects unrecognized id shape", async () => {
    await expect(personRecordMatches({ id: "not a pid" })).rejects.toThrow(/Unrecognized id/);
  });

  it("rejects out-of-range minConfidence", async () => {
    await expect(personRecordMatches({ id: "KNDX-MKG", minConfidence: 0 })).rejects.toThrow(/minConfidence/);
    await expect(personRecordMatches({ id: "KNDX-MKG", minConfidence: 6 })).rejects.toThrow(/minConfidence/);
  });

  it("rejects out-of-range count", async () => {
    await expect(personRecordMatches({ id: "KNDX-MKG", count: 0 })).rejects.toThrow(/count/);
    await expect(personRecordMatches({ id: "KNDX-MKG", count: 51 })).rejects.toThrow(/count/);
  });

  it("rejects unknown status value", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      personRecordMatches({ id: "KNDX-MKG", status: ["nope"] }),
    ).rejects.toThrow(/Unknown status/);
  });

  it("rejects empty status array", async () => {
    await expect(
      personRecordMatches({ id: "KNDX-MKG", status: [] }),
    ).rejects.toThrow(/non-empty array/);
  });

  it("accepts a full https:// ARK with the right prefix", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "https://familysearch.org/ark:/61903/4:1:KNDX-MKG" });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("id")).toBe("ark:/61903/4:1:KNDX-MKG");
  });

  it("custom status array is sent as-is and dedup'd", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", status: ["accepted", "accepted", "pending"] });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.getAll("status").sort()).toEqual(["accepted", "pending"]);
  });

  it("custom count and minConfidence are propagated", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", count: 7, minConfidence: 4 });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("count")).toBe("7");
    expect(url.searchParams.get("minConfidence")).toBe("4");
  });

  it("includeSummary=true is sent as the string 'true'", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", includeSummary: true });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get("includeSummary")).toBe("true");
  });

  it("never sends includeFlags", async () => {
    mockJson(EMPTY_BODY);
    await personRecordMatches({ id: "KNDX-MKG", includeSummary: true, minConfidence: 5, count: 50, status: ["accepted"] });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.has("includeFlags")).toBe(false);
  });
});

describe("Response parsing", () => {
  const KNDX_RESPONSE = {
    title: "Matches for ark:/61903/4:1:KNDX-MKG",
    results: 1,
    updated: "2025-09-11T16:56:42.040Z",
    entries: [
      {
        confidence: 5,
        id: "https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4",
        published: "2024-09-19T20:07:47.508Z",
        score: 0.97402465,
        title: "BillionGraves Index",
        matchInfo: [
          {
            collection: "https://familysearch.org/platform/collections/records",
            status: "http://familysearch.org/v1/Accepted",
          },
        ],
        content: { gedcomx: { sourceDescriptions: [{ titles: [{ value: "BillionGraves Index" }] }] } },
      },
    ],
  };

  it("maps the happy-path response", async () => {
    mockJson(KNDX_RESPONSE);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.queryArk).toBe("ark:/61903/4:1:KNDX-MKG");
    expect(result.resultCount).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.title).toBe("Matches for ark:/61903/4:1:KNDX-MKG");
    expect(result.updated).toBe("2025-09-11T16:56:42.040Z");
    expect(result.matches).toHaveLength(1);
    const m = result.matches[0];
    expect(m.ark).toBe("https://familysearch.org/ark:/61903/1:1:QPZP-Y6G4");
    expect(m.pid).toBe("QPZP-Y6G4");
    expect(m.arkType).toBe("1:1:");
    expect(m.confidence).toBe(5);
    expect(m.score).toBeCloseTo(0.974, 3);
    expect(m.title).toBe("BillionGraves Index");
    expect(m.status).toBe("accepted");
    expect(m.collection).toBe("https://familysearch.org/platform/collections/records");
    expect(m.published).toBe("2024-09-19T20:07:47.508Z");
    expect(m.summary).toBeDefined();
  });

  it("omits summary when content.gedcomx is missing", async () => {
    const body = JSON.parse(JSON.stringify(KNDX_RESPONSE));
    delete body.entries[0].content;
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches[0].summary).toBeUndefined();
  });

  it("maps status URIs to lowercase across all three statuses", async () => {
    const body = {
      title: "x",
      results: 3,
      updated: "t",
      entries: [
        { id: "https://familysearch.org/ark:/61903/1:1:A1A1-A1A", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Pending", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:B2B2-B2B", confidence: 4, score: 0.4,
          matchInfo: [{ status: "http://familysearch.org/v1/Rejected", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:C3C3-C3C", confidence: 3, score: 0.3,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
      ],
    };
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches.map((m) => m.status)).toEqual(["pending", "rejected", "accepted"]);
  });

  it("drops entries with unknown status URI or malformed ARK", async () => {
    const body = {
      title: "x",
      results: 3,
      updated: "t",
      entries: [
        { id: "https://familysearch.org/ark:/61903/1:1:GOOD-PID", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
        { id: "no-ark-here", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
        { id: "https://familysearch.org/ark:/61903/1:1:BAD-STATUS", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://example.com/Unknown", collection: "c" }] },
      ],
    };
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].pid).toBe("GOOD-PID");
  });

  it("falls back to entries.length when body.results is missing", async () => {
    const body = {
      title: "x",
      updated: "t",
      entries: [
        { id: "https://familysearch.org/ark:/61903/1:1:GOOD-PID", confidence: 5, score: 0.5,
          matchInfo: [{ status: "http://familysearch.org/v1/Accepted", collection: "c" }] },
      ],
    };
    mockJson(body);
    const result = await personRecordMatches({ id: "KNDX-MKG" });
    expect(result.resultCount).toBe(1);
  });
});

describe("Error handling", () => {
  it("translates 401 to a login-instruction error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 401, statusText: "Unauthorized",
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/login tool/);
  });

  it("translates 403 to a login-instruction error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 403, statusText: "Forbidden",
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/login tool/);
  });

  it("translates 400 to a malformed-ARK message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400, statusText: "Bad Request",
      text: () => Promise.resolve('{"error":"Bad Request"}'),
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/malformed ARK/);
  });

  it("translates 500 to a generic upstream error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 500, statusText: "Server Error",
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/500/);
  });

  it("translates a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/Could not reach/);
  });

  it("rejects malformed JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      text: () => Promise.resolve("not json"),
      json: () => Promise.reject(new Error("bad json")),
      headers: new Headers({ "content-type": "application/json" }),
    });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/unexpected response body/);
  });

  it("rejects body with no entries array", async () => {
    mockJson({ results: 0, title: "x", updated: "t" });
    await expect(personRecordMatches({ id: "KNDX-MKG" })).rejects.toThrow(/unexpected response body/);
  });
});
