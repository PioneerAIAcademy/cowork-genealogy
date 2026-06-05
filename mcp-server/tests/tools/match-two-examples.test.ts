import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchTwoExamples } from "../../src/tools/match-two-examples.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { MatchTwoExamplesApiResponse } from "../../src/types/match-two-examples.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const getValidTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: getValidTokenMock,
}));

beforeEach(() => {
  mockFetch.mockReset();
  getValidTokenMock.mockReset();
  getValidTokenMock.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const QUERY_ARK = "https://familysearch.org/ark:/61903/4:1:KGS8-LY1";
const CANDIDATE_ARK = "https://familysearch.org/ark:/61903/4:1:KCWM-J9H";

function makeGedcomx(personId: string, ark: string): SimplifiedGedcomX {
  return {
    persons: [{
      id: personId,
      ark,
      gender: "Male",
      names: [{
        preferred: true,
        type: "BirthName",
        given: "Johann Georg",
        surname: "Hufenreuter",
      }],
      facts: [{
        type: "Birth",
        date: "11Jan1758",
        place: "Biesenrode, Schsn, Prss",
      }],
    }],
  };
}

const matchResponse: MatchTwoExamplesApiResponse = {
  entries: [
    { confidence: 5, id: CANDIDATE_ARK, score: 0.99983513 },
  ],
  links: { self: { href: "/match-ws/match/matchTwoExamples?minConfidence=0" } },
  results: 1,
  title: "Matches for ark:/61903/4:1:KGS8-LY1",
  updated: "2026-05-15T01:58:23.913Z",
};

const noMatchResponse: MatchTwoExamplesApiResponse = {
  entries: [
    { id: "https://familysearch.org/ark:/61903/4:1:MMMM-MMM", score: 2.46e-8 },
  ],
  links: { self: { href: "/match-ws/match/matchTwoExamples?minConfidence=0" } },
  results: 1,
  title: "Matches for ark:/61903/4:1:KGS8-LY1",
  updated: "2026-05-15T02:03:48.073Z",
};

describe("matchTwoExamples", () => {
  describe("happy path", () => {
    it("returns matched=true with confidence + score + ARKs on a match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      expect(result.matched).toBe(true);
      expect(result.confidence).toBe(5);
      expect(result.score).toBeCloseTo(0.99983513);
      expect(result.queryArk).toBe("ark:/61903/4:1:KGS8-LY1");
      expect(result.candidateArk).toBe("ark:/61903/4:1:KCWM-J9H");
      expect(result.apiTitle).toBe("Matches for ark:/61903/4:1:KGS8-LY1");
      expect(result.updated).toBe("2026-05-15T01:58:23.913Z");
    });

    it("returns matched=false when entries[0] has no confidence field", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => noMatchResponse,
      });

      const result = await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", "https://familysearch.org/ark:/61903/4:1:NONMATCH"),
        primaryId2: "I1",
      });

      expect(result.matched).toBe(false);
      expect(result.confidence).toBeUndefined();
      expect(result.score).toBeCloseTo(2.46e-8);
      expect(result.candidateArk).toContain("MMMM-MMM");
    });

    it("POSTs to the FS production URL with the right headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples",
      );
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer test-token");
      expect(opts.headers.Accept).toBe("application/json");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["User-Agent"]).toContain("Mozilla");
    });

    it("appends a sourceDescription with about=#<primaryId> to each entry", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I7", CANDIDATE_ARK),
        primaryId2: "I7",
      });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
      const entry1Gedcomx = body.entries[0].content.gedcomx;
      const entry2Gedcomx = body.entries[1].content.gedcomx;

      expect(entry1Gedcomx.sourceDescriptions).toEqual([
        { id: "match-anchor", about: "#I1" },
      ]);
      expect(entry2Gedcomx.sourceDescriptions).toEqual([
        { id: "match-anchor", about: "#I7" },
      ]);
    });
  });

  describe("validation", () => {
    it("throws when primaryId is missing from gedcomx1.persons", async () => {
      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I99",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx1/);
    });

    it("throws when primaryId is missing from gedcomx2.persons", async () => {
      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I99",
        }),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx2/);
    });

    it("throws when gedcomx1 has no persons array", async () => {
      await expect(
        matchTwoExamples({
          gedcomx1: {},
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/gedcomx1 has no persons\[\]/);
    });

    it("lists available ids in the error message", async () => {
      await expect(
        matchTwoExamples({
          gedcomx1: {
            persons: [
              { id: "I1", gender: "Male", names: [{ preferred: true, given: "A", surname: "B" }] },
              { id: "I2", gender: "Male", names: [{ preferred: true, given: "C", surname: "D" }] },
            ],
          },
          primaryId1: "wrong",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/Available ids in gedcomx1: I1, I2/);
    });
  });

  describe("error handling", () => {
    it("throws a re-login error on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({}),
      });

      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/call the login tool/i);
    });

    it("throws a WAF error on 403 with Imperva errorCode 15", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ errorCode: "15", description: "This request was blocked by our security service" }),
      });

      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/blocked by WAF/i);
    });

    it("throws with the API's detail message on 400", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ detail: "Required header 'Authorization' is not present." }),
      });

      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/Required header 'Authorization' is not present/);
    });

    it("throws on empty entries[] in the response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...matchResponse, entries: [] }),
      });

      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/returned no entries\[\]/);
    });

    it("wraps a network failure with a helpful message", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        matchTwoExamples({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/Could not reach FamilySearch matchTwoExamples API/);
    });
  });

  describe("queryArk parsing from title", () => {
    it("returns the canonical ARK when title contains a real ARK", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      expect(result.queryArk).toBe("ark:/61903/4:1:KGS8-LY1");
    });

    it("returns the MMMM-MMM placeholder when title contains one", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...matchResponse,
          title: "Matches for ark:/61903/4:1:MMMM-MMM",
        }),
      });

      const result = await matchTwoExamples({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      expect(result.queryArk).toBe("ark:/61903/4:1:MMMM-MMM");
    });
  });
});
