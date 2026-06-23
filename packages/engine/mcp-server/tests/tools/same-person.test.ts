import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { samePerson } from "../../src/tools/same-person.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { SamePersonApiResponse } from "../../src/types/same-person.js";

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

const matchResponse: SamePersonApiResponse = {
  entries: [
    { confidence: 5, id: CANDIDATE_ARK, score: 0.99983513 },
  ],
  links: { self: { href: "/match-ws/match/matchTwoExamples?minConfidence=0" } },
  results: 1,
  title: "Matches for ark:/61903/4:1:KGS8-LY1",
  updated: "2026-05-15T01:58:23.913Z",
};

const noMatchResponse: SamePersonApiResponse = {
  entries: [
    { id: "https://familysearch.org/ark:/61903/4:1:MMMM-MMM", score: 2.46e-8 },
  ],
  links: { self: { href: "/match-ws/match/matchTwoExamples?minConfidence=0" } },
  results: 1,
  title: "Matches for ark:/61903/4:1:KGS8-LY1",
  updated: "2026-05-15T02:03:48.073Z",
};

describe("samePerson", () => {
  describe("happy path", () => {
    it("returns matched=true with confidence + score + ARKs on a match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = await samePerson({
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

      const result = await samePerson({
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

      await samePerson({
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

      await samePerson({
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

    it("sends the Persistent identifier as a full canonical ARK (not a bare id)", async () => {
      // matchTwoExamples rejects a bare id ("KGS8-LY1") with 400 "Invalid Feed";
      // it requires the `ark:/61903/n:n:` prefix. The tool restores it from the
      // simplified `ark` even though the shared converter emits the bare id.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
      const persistent =
        body.entries[0].content.gedcomx.persons[0].identifiers[
          "http://gedcomx.org/Persistent"
        ];
      expect(persistent).toEqual(["ark:/61903/4:1:KGS8-LY1"]);
    });

    it("mints a random valid FS id for an ark whose id isn't 4-char-3-char vowel-free", async () => {
      // "I1" is not a valid FS persona id (vowel + wrong shape). The tool must
      // replace it with a random conforming id, keeping the ark prefix + type.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      await samePerson({
        gedcomx1: makeGedcomx("I1", "ark:/61903/4:1:I1"),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
      const [persistent] =
        body.entries[0].content.gedcomx.persons[0].identifiers[
          "http://gedcomx.org/Persistent"
        ];
      // Same type prefix, but a freshly-minted 4-3 vowel-free id (not "I1").
      expect(persistent).toMatch(
        /^ark:\/61903\/4:1:[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{3}$/,
      );
      expect(persistent).not.toContain("I1");
      // The local xml:id / anchor is untouched — only the FS-facing id changes.
      expect(body.entries[0].content.gedcomx.sourceDescriptions).toEqual([
        { id: "match-anchor", about: "#I1" },
      ]);
    });
  });

  describe("validation", () => {
    it("throws when primaryId is missing from gedcomx1.persons", async () => {
      await expect(
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I99",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx1/);
    });

    it("throws when primaryId is missing from gedcomx2.persons", async () => {
      await expect(
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I99",
        }),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx2/);
    });

    it("throws when gedcomx1 has no persons array", async () => {
      await expect(
        samePerson({
          gedcomx1: {},
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/gedcomx1 has no persons\[\]/);
    });

    it("lists available ids in the error message", async () => {
      await expect(
        samePerson({
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
        samePerson({
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
        samePerson({
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
        samePerson({
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
        samePerson({
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
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }),
      ).rejects.toThrow(/Could not reach FamilySearch matchTwoExamples API/);
    });
  });

  describe("matchRelatives mode", () => {
    // A household: focus person + three children on each side. The heuristic
    // should pair (Bob,Robert) (Mary,Mary) (John,John) → exactly 3 FS calls.
    function child(id: string, given: string, year: string) {
      return {
        id,
        gender: "Male",
        names: [{ preferred: true, given, surname: "Flynn" }],
        facts: [{ type: "Birth", standard_date: year }],
      };
    }
    function household(
      focusId: string,
      children: Array<{ id: string; given: string; year: string }>,
    ): SimplifiedGedcomX {
      return {
        persons: [
          { id: focusId, gender: "Male", names: [{ preferred: true, given: "Pat", surname: "Flynn" }] },
          ...children.map((c) => child(c.id, c.given, c.year)),
        ],
        relationships: children.map((c) => ({
          type: "ParentChild",
          parent: focusId,
          child: c.id,
        })),
      };
    }

    const side1 = household("I1", [
      { id: "t-bob", given: "Bob", year: "1810" },
      { id: "t-mary", given: "Mary", year: "1812" },
      { id: "t-john", given: "John", year: "1815" },
    ]);
    const side2 = household("I2", [
      { id: "c-robert", given: "Robert", year: "1810" },
      { id: "c-mary", given: "Mary", year: "1813" },
      { id: "c-john", given: "John", year: "1816" },
    ]);

    it("issues one FS call per heuristic-selected pair (3, not 9) and assembles matches", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => matchResponse });

      const result = await samePerson({
        gedcomx1: side1,
        primaryId1: "I1",
        gedcomx2: side2,
        primaryId2: "I2",
        matchRelatives: true,
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      if (!("matchRelatives" in result)) throw new Error("expected relatives result");
      expect(result.matchRelatives).toBe(true);
      expect(result.matches).toHaveLength(3);
      for (const m of result.matches) {
        expect(m.role).toBe("child");
        expect(m.score).toBeCloseTo(0.99983513);
        expect(m.confidence).toBe(5);
        expect(typeof m.preScore).toBe("number");
      }
      const pairings = result.matches
        .map((m) => [m.targetId, m.candidateId])
        .sort();
      expect(pairings).toEqual(
        [
          ["t-bob", "c-robert"],
          ["t-john", "c-john"],
          ["t-mary", "c-mary"],
        ].sort(),
      );
    });

    it("omits a pair whose FS call keeps failing without failing the batch", async () => {
      mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body);
        const about2: string =
          body.entries[1].content.gedcomx.sourceDescriptions[0].about;
        if (about2 === "#c-robert") throw new Error("transient FS failure");
        return { ok: true, json: async () => matchResponse };
      });

      const result = await samePerson({
        gedcomx1: side1,
        primaryId1: "I1",
        gedcomx2: side2,
        primaryId2: "I2",
        matchRelatives: true,
      });

      if (!("matchRelatives" in result)) throw new Error("expected relatives result");
      expect(result.matches).toHaveLength(2);
      expect(result.matches.map((m) => m.candidateId).sort()).toEqual(["c-john", "c-mary"]);
    });

    it("still validates the focus ids in relatives mode", async () => {
      await expect(
        samePerson({
          gedcomx1: side1,
          primaryId1: "BOGUS",
          gedcomx2: side2,
          primaryId2: "I2",
          matchRelatives: true,
        }),
      ).rejects.toThrow(/primaryId "BOGUS" not found in gedcomx1/);
    });
  });

  describe("queryArk parsing from title", () => {
    it("returns the canonical ARK when title contains a real ARK", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = await samePerson({
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

      const result = await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      });

      expect(result.queryArk).toBe("ark:/61903/4:1:MMMM-MMM");
    });
  });
});
