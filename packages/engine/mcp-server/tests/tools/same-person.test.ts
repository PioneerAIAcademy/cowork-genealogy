import { LOCAL } from "../../src/auth/principal.js";
import { mkdtemp, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  samePerson,
  buildRecordedScore,
  describeScoredPair,
  resolvePartyBySiblings,
} from "../../src/tools/same-person.js";
import { having, notHaving } from "../helpers/narrow.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../../src/types/gedcomx.js";
import type { SamePersonApiResponse } from "../../src/types/same-person.js";
import { socketFetchFailure } from "../helpers/fetch-failed.js";
import { findRecordedScore, readMatchScores } from "../../src/utils/match-scores.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const getValidTokenMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: getValidTokenMock,
}));

// The project-relative arm resolves the record side through record_read. Mocked
// so the tests choose the route: resolving returns the fetched persona document,
// throwing falls the arm through to the assertion projection. Defaults to
// throwing, so the explicit-form tests below are untouched by it.
const recordReadMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/record-read.js", () => ({
  recordReadTool: recordReadMock,
}));

beforeEach(() => {
  mockFetch.mockReset();
  getValidTokenMock.mockReset();
  getValidTokenMock.mockResolvedValue("test-token");
  recordReadMock.mockReset();
  recordReadMock.mockRejectedValue(new Error("no record_read in this test"));
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

/** The explicit arm's result: the member that carries the API echo fields.
 *  `samePerson`'s declared return is a union, and the project arm's member has
 *  none of them, so a test that reads `queryArk` has to say which arm it called. */
function explicit(r: Awaited<ReturnType<typeof samePerson>>) {
  return having(notHaving(r, "matchRelatives"), "queryArk");
}

/** The project arm's single-pair result: the member that names whom it scored. */
function projectResult(r: Awaited<ReturnType<typeof samePerson>>) {
  return having(notHaving(r, "matchRelatives"), "recordPersona");
}

describe("samePerson", () => {
  describe("happy path", () => {
    it("returns matched=true with confidence + score + ARKs on a match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = explicit(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL));

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

      const result = explicit(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", "https://familysearch.org/ark:/61903/4:1:NONMATCH"),
        primaryId2: "I1",
      }, LOCAL));

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
      }, LOCAL);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples",
      );
      expect(opts.method).toBe("POST");
      const headers = new Headers(opts.headers as HeadersInit);
      expect(headers.get("Authorization")).toBe("Bearer test-token");
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("User-Agent")).toContain("Mozilla");
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
      }, LOCAL);

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

    it("puts the focus person first, because matchTwoExamples scores persons[0]", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const household = makeGedcomx("I1", "ark:/61903/1:1:QBCD-FGH");
      household.persons!.push(
        { ...makeGedcomx("I2", "ark:/61903/1:1:QBCD-FGJ").persons![0] },
        { ...makeGedcomx("I3", "ark:/61903/1:1:QBCD-FGK").persons![0] },
      );

      await samePerson({
        gedcomx1: household,
        primaryId1: "I3",
        gedcomx2: makeGedcomx("I7", CANDIDATE_ARK),
        primaryId2: "I7",
      }, LOCAL);

      const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
      const entry1Gedcomx = body.entries[0].content.gedcomx;
      expect(entry1Gedcomx.persons.map((p: { id: string }) => p.id)).toEqual(["I3", "I1", "I2"]);
      expect(entry1Gedcomx.sourceDescriptions).toEqual([
        { id: "match-anchor", about: "#I3" },
      ]);
      expect(household.persons!.map((p) => p.id)).toEqual(["I1", "I2", "I3"]);
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
      }, LOCAL);

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
      }, LOCAL);

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
        }, LOCAL),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx1/);
    });

    it("throws when primaryId is missing from gedcomx2.persons", async () => {
      await expect(
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I99",
        }, LOCAL),
      ).rejects.toThrow(/primaryId "I99" not found in gedcomx2/);
    });

    it("throws when gedcomx1 has no persons array", async () => {
      await expect(
        samePerson({
          gedcomx1: {},
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }, LOCAL),
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
        }, LOCAL),
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
        }, LOCAL),
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
        }, LOCAL),
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
        }, LOCAL),
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
        }, LOCAL),
      ).rejects.toThrow(/returned no entries\[\]/);
    });

    it("wraps a network failure with a helpful message", async () => {
      mockFetch.mockRejectedValueOnce(socketFetchFailure());

      await expect(
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }, LOCAL),
      ).rejects.toThrow(/Could not reach FamilySearch matchTwoExamples API: fetch failed <- ETIMEDOUT/);
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
      }, LOCAL);

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
      }, LOCAL);

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
        }, LOCAL),
      ).rejects.toThrow(/primaryId "BOGUS" not found in gedcomx1/);
    });
  });

  describe("queryArk parsing from title", () => {
    it("returns the canonical ARK when title contains a real ARK", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = explicit(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL));

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

      const result = explicit(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL));

      expect(result.queryArk).toBe("ark:/61903/4:1:MMMM-MMM");
    });
  });
});

// ─── a fetched household: the worked case behind `recordRole` ────────────────
//
// One record that names three people: a child, her father and her mother.
// Persona ids, roles, names and the shape of the child's relationship
// assertions are those of record ark:/61903/1:1:6LYF-G8RJ: a relationship
// assertion's `structured_value` names the OTHER party's role and no name, and
// every assertion carries its own party's persona id. A fetched `persons[]`
// carries no role, so a role has to come from the assertions around it.

const HH_RECORD = "ark:/61903/1:1:6LYF-G8RJ";
const HH_CHILD = "p_300287854666";
const HH_FATHER = "p_300287854667";
const HH_MOTHER = "p_300287854668";

function hhDoc(extraPersons: SimplifiedPerson[] = []): SimplifiedGedcomX {
  return {
    persons: [
      { id: HH_CHILD, gender: "Female", names: [{ given: "Maria Elisabeth", surname: "Mouchang" }] },
      { id: HH_FATHER, gender: "Male", names: [{ given: "Pierre", surname: "Mouchang" }] },
      { id: HH_MOTHER, gender: "Female", names: [{ given: "Margreta", surname: "Metzeler" }] },
      ...extraPersons,
    ],
    relationships: [
      { type: "Couple", person1: HH_FATHER, person2: HH_MOTHER },
      { type: "ParentChild", parent: HH_FATHER, child: HH_CHILD },
      { type: "ParentChild", parent: HH_MOTHER, child: HH_CHILD },
    ],
  };
}

function hhAssertion(
  id: string,
  role: string,
  personaId: string | null,
  type: string,
  value: string,
  structured: Record<string, unknown> | null = null,
): Record<string, unknown> {
  return {
    id, record_id: HH_RECORD, record_role: role, record_persona_id: personaId,
    fact_type: type, value, structured_value: structured,
    record_basis: "stated", log_entry_id: "log_rr",
  };
}

/** The assertions an extraction of that record leaves: a name per party, and
 *  two relationship assertions on the child. */
function hhResearch(): any {
  return {
    log: [{ id: "log_rr", tool: "record_read", results_ref: "results/log_rr.json" }],
    assertions: [
      hhAssertion("a_031", "child", HH_CHILD, "name", "Maria Elisabeth Mouchang",
        { given: "Maria Elisabeth", surname: "Mouchang" }),
      hhAssertion("a_034", "father", HH_FATHER, "name", "Pierre Mouchang",
        { given: "Pierre", surname: "Mouchang" }),
      hhAssertion("a_036", "mother", HH_MOTHER, "name", "Margreta Metzeler",
        { given: "Margreta", surname: "Metzeler" }),
      hhAssertion("a_038", "child", HH_CHILD, "relationship", "child of Pierre Mouchang",
        { relationship_type: "child", related_person_role: "father" }),
      hhAssertion("a_039", "child", HH_CHILD, "relationship", "child of Margreta Metzeler",
        { relationship_type: "child", related_person_role: "mother" }),
    ],
  };
}

/** One assertion of an `hhResearch()`, by id. */
function hhRow(research: any, id: string): any {
  return (research.assertions as any[]).find((a) => a.id === id);
}

/** A fetched persons[] of personas known only by the names given. */
function docWithNames(...names: Array<[id: string, given: string, surname: string]>): SimplifiedGedcomX {
  return { persons: names.map(([id, given, surname]) => ({ id, names: [{ given, surname }] })) };
}

/** One tree person per persona. */
const HH_TREE: SimplifiedGedcomX = {
  persons: [
    { id: "I1", gender: "Male", names: [{ given: "Pierre", surname: "Mouchang", preferred: true }] },
    { id: "I2", gender: "Female", names: [{ given: "Margreta", surname: "Metzeler", preferred: true }] },
    { id: "I3", gender: "Female", names: [{ given: "Maria Elisabeth", surname: "Mouchang", preferred: true }] },
  ],
  relationships: [
    { type: "Couple", person1: "I1", person2: "I2" },
    { type: "ParentChild", parent: "I1", child: "I3" },
    { type: "ParentChild", parent: "I2", child: "I3" },
  ],
};

// ─── the project-relative arm (issue #1731 steps 1 + 2) ──────────────────────

describe("samePerson — project-relative arm", () => {
  let dir: string;

  const RECORD = "https://www.familysearch.org/ark:/61903/1:1:MARR-8T3";

  /** research.json with one marriage assertion whose record holds two parties. */
  function research(over: Record<string, unknown> = {}): any {
    return {
      log: [
        { id: "log_1", tool: "record_search", results_ref: "results/log_1.json" },
        { id: "log_ft", tool: "fulltext_search", results_ref: "results/log_ft.json" },
      ],
      assertions: [
        {
          id: "a_005", record_id: RECORD, record_role: "principal",
          fact_type: "name", value: "Thomas Flynn", record_persona_id: null,
          record_basis: "stated", log_entry_id: "log_1",
        },
        {
          id: "a_006", record_id: RECORD, record_role: "bride",
          fact_type: "name", value: "Mary Doyle", record_persona_id: null,
          record_basis: "stated", log_entry_id: "log_1",
        },
      ],
      ...over,
    };
  }

  const TREE = {
    persons: [
      { id: "I1", gender: "Male", names: [{ given: "Thomas", surname: "Flynn" }] },
      { id: "I2", gender: "Female", names: [{ given: "Mary", surname: "Doyle" }] },
    ],
    relationships: [{ type: "Couple", person1: "I1", person2: "I2" }],
  };

  async function project(r: any = research(), tree: any = TREE) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree), "utf8");
  }

  const okScore = () =>
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => matchResponse });

  async function scoresOnDisk(): Promise<any[]> {
    let names: string[];
    try {
      names = await readdir(join(dir, "results", ".scores"));
    } catch {
      return [];
    }
    return Promise.all(
      names.map(async (n) =>
        JSON.parse(await readFile(join(dir, "results", ".scores", n), "utf8")),
      ),
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "same-person-project-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("scores from three references and records what it computed", async () => {
    await project();
    okScore();

    const result = notHaving(
      await samePerson(
        { projectPath: dir, assertionId: "a_005", treePersonId: "I1" },
        LOCAL,
      ),
      "matchRelatives",
    );

    expect(result.score).toBeCloseTo(0.99983513);
    expect(result.recorded).toBe(true);
    expect(result.recordSource).toBe("projection");

    const [file] = await scoresOnDisk();
    expect(file.scores["a_005|I1"]).toMatchObject({
      record_id: RECORD,
      record_role: "principal",
      tree_person_id: "I1",
      assertion_id: "a_005",
      matched: true,
    });
  });

  it("sends the matching mob as the tree side, not the whole tree", async () => {
    await project();
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // I2 is I1's spouse, so it belongs in the mob; nothing else does.
    const treeSide = JSON.stringify(body).includes("Doyle");
    expect(treeSide).toBe(true);
  });

  it("leaves out tree facts and names sourced only from the record it scores", async () => {
    const OTHER = "https://www.familysearch.org/ark:/61903/1:1:CENS-1880";
    const r = research({
      sources: [
        { id: "src_001", gedcomx_source_description_id: "S50" },
        { id: "src_002", gedcomx_source_description_id: "S60" },
      ],
    });
    r.assertions = r.assertions.map((a: any) => ({ ...a, source_id: "src_001" }));
    r.assertions.push({
      id: "a_020", record_id: OTHER, record_role: "head", source_id: "src_002",
      fact_type: "residence", value: null, record_basis: "stated", log_entry_id: "log_1",
    });
    await project(r, {
      persons: [
        {
          id: "I1", gender: "Male",
          names: [
            { given: "Thomas", surname: "Flynn" },
            { given: "Thomas", surname: "Flinn", sources: [{ ref: "S50" }] },
          ],
          facts: [
            { type: "Residence", date: "1875", sources: [{ ref: "S50" }] },
            { type: "Residence", date: "1880", sources: [{ ref: "S60" }] },
            { type: "Birth", date: "1844", sources: [{ ref: "#S50" }, { ref: "S60" }] },
          ],
        },
        {
          id: "I2", gender: "Female",
          names: [{ given: "Mary", surname: "Doyle", sources: [{ ref: "S50" }] }],
          facts: [{ type: "Residence", date: "1877", sources: [{ ref: "S50" }] }],
        },
      ],
      relationships: [{ type: "Couple", person1: "I1", person2: "I2" }],
    });
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);

    const treeSide = JSON.stringify(JSON.parse(mockFetch.mock.calls[0][1].body).entries[1]);
    expect(treeSide).not.toContain("1875");
    expect(treeSide).not.toContain("1877");
    expect(treeSide).not.toContain("Flinn");
    expect(treeSide).toContain("1880");
    expect(treeSide).toContain("1844");
    expect(treeSide).toContain("Doyle");
  });

  it("keeps a fact whose source reaches the scored record and another one too", async () => {
    const OTHER = "https://www.familysearch.org/ark:/61903/1:1:CENS-1880";
    const r = research({ sources: [{ id: "src_001", gedcomx_source_description_id: "S50" }] });
    r.assertions = r.assertions.map((a: any) => ({ ...a, source_id: "src_001" }));
    r.assertions.push({
      id: "a_020", record_id: OTHER, record_role: "head", source_id: "src_001",
      fact_type: "residence", value: null, record_basis: "stated", log_entry_id: "log_1",
    });
    await project(r, {
      ...TREE,
      persons: [
        { ...TREE.persons[0], facts: [{ type: "Residence", date: "1875", sources: [{ ref: "S50" }] }] },
        TREE.persons[1],
      ],
    });
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);

    const treeSide = JSON.stringify(JSON.parse(mockFetch.mock.calls[0][1].body).entries[1]);
    expect(treeSide).toContain("1875");
  });

  it("prefers the record's own GedcomX, and names the persona it scored", async () => {
    recordReadMock.mockResolvedValue({
      persons: [
        { id: "MP1", names: [{ given: "Thomas", surname: "Flynn" }] },
        { id: "MP2", names: [{ given: "Mary", surname: "Doyle" }] },
      ],
      relationships: [{ type: "Couple", person1: "MP1", person2: "MP2" }],
    });
    await project();
    okScore();

    const result = notHaving(
      await samePerson(
        { projectPath: dir, assertionId: "a_005", treePersonId: "I1", recordPersonaId: "MP1" },
        LOCAL,
      ),
      "matchRelatives",
    );
    expect(result.recordSource).toBe("record_read");
    const [file] = await scoresOnDisk();
    // Keyed on the assertion; the resolved persona is still RECORDED on the entry,
    // which is what `recordPersonaId` was honoured means.
    expect(file.scores["a_005|I1"]).toBeTruthy();
    expect(file.scores["a_005|I1"]?.record_persona_id).toBe("MP1");
  });

  it("passes a record_search sidecar ref to record_read", async () => {
    recordReadMock.mockResolvedValue({ persons: [{ id: "MP1" }] });
    await project();
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);
    expect(recordReadMock.mock.calls[0][0].resultsRef).toBe("results/log_1.json");
  });

  it("never passes a fulltext_search sidecar ref — it carries no persona", async () => {
    // A fulltext_search entry has a results_ref too, but its results hold no
    // gedcomx and key on `id` rather than `recordId`, so handing it over would
    // look up nothing (PERSONA_BEARING_PRODUCERS). 300 corpus assertions sit
    // on exactly this shape.
    //
    // Its own test rather than a second half of the one above: sharing a
    // project and a record id there let the resolved-record memo serve the
    // second call from cache, so record_read was never called and the
    // assertion read undefined for the wrong reason.
    recordReadMock.mockResolvedValue({ persons: [{ id: "MP1" }] });
    const r = research();
    r.assertions[0].log_entry_id = "log_ft";
    await project(r);
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);
    expect(recordReadMock).toHaveBeenCalledTimes(1);
    expect(recordReadMock.mock.calls[0][0].resultsRef).toBeUndefined();
  });

  it("passes a record_read sidecar ref to record_read — persona-bearing", async () => {
    recordReadMock.mockResolvedValue({ persons: [{ id: "MP1" }] });
    const r = research();
    r.log.push({ id: "log_rr", tool: "record_read", results_ref: "results/log_rr.json" });
    r.assertions[0].log_entry_id = "log_rr";
    await project(r);
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);
    expect(recordReadMock).toHaveBeenCalledTimes(1);
    expect(recordReadMock.mock.calls[0][0].resultsRef).toBe("results/log_rr.json");
  });

  it("does not serve one project's resolved record to another", async () => {
    recordReadMock.mockResolvedValue({ persons: [{ id: "MP1" }] });
    await project();
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);

    const other = await mkdtemp(join(tmpdir(), "same-person-other-"));
    try {
      await writeFile(join(other, "research.json"), JSON.stringify(research()), "utf8");
      await writeFile(join(other, "tree.gedcomx.json"), JSON.stringify(TREE), "utf8");
      okScore();
      await samePerson({ projectPath: other, assertionId: "a_005", treePersonId: "I1" }, LOCAL);
      expect(recordReadMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("resolves the SECOND party of a relationship assertion via recordRole", async () => {
    await project();
    okScore();
    const result = notHaving(
      await samePerson(
        { projectPath: dir, assertionId: "a_005", treePersonId: "I2", recordRole: "bride" },
        LOCAL,
      ),
      "matchRelatives",
    );
    expect(result.recorded).toBe(true);
    const [file] = await scoresOnDisk();
    // The tree person is half the key, so the second party does not collide with
    // the first even though both share assertion a_005.
    expect(file.scores["a_005|I2"]?.record_role).toBe("bride");
    expect(file.scores["a_005|I1"]).toBeUndefined();
  });

  it("resolves one record ONCE across links — the memo", async () => {
    recordReadMock.mockResolvedValue({ persons: [{ id: "MP1" }] });
    await project();
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL);
    okScore();
    await samePerson({ projectPath: dir, assertionId: "a_006", treePersonId: "I2" }, LOCAL);
    // Two links, two scores, one fetch. Without the memo this arm would turn
    // the agent's one-fetch-per-record into one-fetch-per-link.
    expect(recordReadMock).toHaveBeenCalledTimes(1);
  });

  describe("answers, not crashes", () => {
    it("honours recordPersonaId on the PROJECTED route, not just the fetched one", async () => {
      // The ambiguity refusal tells the agent to pass recordPersonaId, and the
      // schema advertises it as the disambiguator. Route 2 selected purely by
      // role, so following that instruction produced the identical refusal for
      // ever, on the transcribed-register population the route exists for.
      const r = research();
      r.assertions[0].record_persona_id = "p_thomas";
      r.assertions.push({
        id: "a_007", record_id: RECORD, record_role: "principal",
        fact_type: "name", value: "Somebody Else", record_persona_id: "p_other",
        record_basis: "stated", log_entry_id: "log_1",
      });
      await project(r);
      okScore();
      const result = notHaving(
        await samePerson(
          { projectPath: dir, assertionId: "a_005", treePersonId: "I1", recordPersonaId: "p_thomas" },
          LOCAL,
        ),
        "matchRelatives",
      );
      expect(result.recorded).toBe(true);
      const [file] = await scoresOnDisk();
      expect(file.scores["a_005|I1"]).toBeTruthy();
      expect(file.scores["a_005|I1"]?.record_persona_id).toBe("p_thomas");
    });

    // Code review: an extraction that stamped one persona id on several roles
    // groups by role, so the assertion's own role picks the party.
    it("finds the party when recordPersonaId is worn by several roles", async () => {
      const r = research();
      r.assertions[0].record_persona_id = "p_shared";
      r.assertions.push({
        id: "a_007", record_id: RECORD, record_role: "informant",
        fact_type: "name", value: "Somebody Else", record_persona_id: "p_shared",
        record_basis: "stated", log_entry_id: "log_1",
      });
      await project(r);
      okScore();
      const result = notHaving(
        await samePerson(
          { projectPath: dir, assertionId: "a_005", treePersonId: "I1", recordPersonaId: "p_shared" },
          LOCAL,
        ),
        "matchRelatives",
      );
      expect(result.recorded).toBe(true);
    });

    it("files the role of the projected group, not the role a shared persona id lists first", async () => {
      // The id names no single party, so the group at the role asked is the party.
      // The entry names that role beside the persona the response names, not
      // `principal`, the first of the two roles the id's assertions carry.
      const r = research();
      r.assertions[0].record_persona_id = "p_shared";
      r.assertions.push({
        id: "a_007", record_id: RECORD, record_role: "informant",
        fact_type: "name", value: "Somebody Else", record_persona_id: "p_shared",
        record_basis: "stated", log_entry_id: "log_1",
      });
      await project(r);
      okScore();
      const result = projectResult(
        await samePerson(
          {
            projectPath: dir, assertionId: "a_005", treePersonId: "I1",
            recordRole: "informant", recordPersonaId: "p_shared",
          },
          LOCAL,
        ),
      );
      expect(result.recordPersona).toEqual({ id: null, name: "Somebody Else", role: "informant" });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_005|I1"]).toMatchObject({ record_persona_id: null, record_role: "informant" });
    });

    it("says so when recordPersonaId names no persona in the record", async () => {
      await project();
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_005", treePersonId: "I1", recordPersonaId: "p_nope" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona with record_persona_id 'p_nope'/);
    });

    it("refuses a projected role that names more than one person", async () => {
      const r = research();
      r.assertions.push({
        id: "a_007", record_id: RECORD, record_role: "principal",
        fact_type: "name", value: "Somebody Else", record_persona_id: null,
        record_basis: "stated", log_entry_id: "log_1",
      });
      await project(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/names more than one person/);
    });

    it("does NOT refuse one persona carrying two name spellings", async () => {
      // 18 of the 22 role-level name collisions in the corpus are alias
      // variants of a single persona (maiden name, scribal variant). The guard
      // above must not fire on the commonest shape it will see.
      const r = research();
      r.assertions[0].record_persona_id = "p_1";
      r.assertions.push({
        id: "a_007", record_id: RECORD, record_role: "principal",
        fact_type: "name", value: "Thomas Flinn", record_persona_id: "p_1",
        record_basis: "stated", log_entry_id: "log_1",
      });
      await project(r);
      okScore();
      const result = notHaving(
        await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
        "matchRelatives",
      );
      expect(result.recorded).toBe(true);
    });

    it("says so when the tree person does not exist", async () => {
      await project();
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I99" }, LOCAL),
      ).rejects.toThrow(/tree person 'I99' is not in tree\.gedcomx\.json/);
    });

    it("says so when the assertion does not exist", async () => {
      await project();
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_nope", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/no assertion 'a_nope'/);
    });

    it("says so when the record holds no persona for the requested role", async () => {
      await project();
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_005", treePersonId: "I1", recordRole: "witness_1" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'witness_1'/);
    });

    it("points at the explicit form outside a project", async () => {
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/gedcomx1\/primaryId1\/gedcomx2\/primaryId2/);
    });

    it("tells matchRelatives apart from 'paired and found nothing' on a projected record", async () => {
      await project();
      const result = await samePerson(
        { projectPath: dir, assertionId: "a_005", treePersonId: "I1", matchRelatives: true },
        LOCAL,
      );
      expect(result).toMatchObject({ matchRelatives: true, matches: [] });
      expect((result as any).note).toMatch(/no record relatives to pair/);
      // Nothing was scored, so nothing was recorded.
      expect(await scoresOnDisk()).toEqual([]);
    });
  });

  it("the explicit form records nothing — it has no project and no record id", async () => {
    await project();
    okScore();
    const result = notHaving(
      await samePerson(
        {
          gedcomx1: makeGedcomx("I1", QUERY_ARK), primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK), primaryId2: "I1",
        },
        LOCAL,
      ),
      "matchRelatives",
    );
    expect(result.recorded).toBeUndefined();
    expect(await scoresOnDisk()).toEqual([]);
  });

  it("names the projected group on the projection route: id null when the record names none, role the group's", async () => {
    await project();
    okScore();
    const first = projectResult(
      await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
    );
    expect(first.recordPersona).toEqual({ id: null, name: "Thomas Flynn", role: "principal" });
    expect(first.treePerson).toEqual({ id: "I1", name: "Thomas Flynn" });
    expect(first.recordSource).toBe("projection");

    // The second party of the same assertion is named for what it is, not for the
    // assertion's own party.
    okScore();
    const second = projectResult(
      await samePerson(
        { projectPath: dir, assertionId: "a_005", treePersonId: "I2", recordRole: "bride" },
        LOCAL,
      ),
    );
    expect(second.recordPersona).toEqual({ id: null, name: "Mary Doyle", role: "bride" });
    expect(second.treePerson).toEqual({ id: "I2", name: "Mary Doyle" });

    // A group the record gave a persona id names that id.
    const r = research();
    r.assertions[0].record_persona_id = "p_thomas";
    await project(r);
    okScore();
    const keyed = projectResult(
      await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
    );
    expect(keyed.recordPersona).toEqual({ id: "p_thomas", name: "Thomas Flynn", role: "principal" });
  });

  describe("a fetched household (recordRole)", () => {
    beforeEach(() => {
      recordReadMock.mockResolvedValue(hhDoc());
    });

    const hhProject = (r: any = hhResearch()) => project(r, HH_TREE);

    /** The focus persona the call sent to FamilySearch, and the anchor it named. */
    function sentFocus(call = 0): { first: string | undefined; anchor: string } {
      const raw = JSON.parse(mockFetch.mock.calls[call][1].body).entries[0].content.gedcomx;
      return { first: raw.persons[0].id, anchor: raw.sourceDescriptions.at(-1).about };
    }

    it("scores the father's persona when recordRole names the father on the child's relationship assertion", async () => {
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );

      expect(sentFocus()).toEqual({ first: HH_FATHER, anchor: `#${HH_FATHER}` });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_038|I1"]).toMatchObject({
        record_persona_id: HH_FATHER,
        record_role: "father",
      });
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
      expect(result.treePerson).toEqual({ id: "I1", name: "Pierre Mouchang" });
    });

    it("likewise scores the mother's persona for recordRole mother", async () => {
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_039", treePersonId: "I2", recordRole: "mother" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_MOTHER);
      expect(result.recordPersona).toEqual({ id: HH_MOTHER, name: "Margreta Metzeler", role: "mother" });
    });

    it("refuses a recordRole that no sibling assertion and no name resolves, instead of scoring the assertion's own persona", async () => {
      await hhProject();
      const call = samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "witness_1" },
        LOCAL,
      );
      await expect(call).rejects.toThrow(/holds no persona for role 'witness_1'/);
      // Nothing was scored and nothing was filed: the refusal comes before the call.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
      // ... and it says who IS on the record, each persona with the role its own assertions give.
      await expect(call).rejects.toThrow(
        `${HH_CHILD} (Maria Elisabeth Mouchang, child), ` +
          `${HH_FATHER} (Pierre Mouchang, father), ` +
          `${HH_MOTHER} (Margreta Metzeler, mother)`,
      );
    });

    it('lists every persona as "id (name, role)" when nothing resolves the party', async () => {
      // An assertion that names no persona and no one: nothing resolves the party.
      // Only the father has an assertion that carries a persona id, so only his
      // role is known; a fetched persons[] carries no role of its own.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_034", "father", HH_FATHER, "name", "Pierre Mouchang",
          { given: "Pierre", surname: "Mouchang" }),
        hhAssertion("a_090", "child", null, "relationship", "child of someone",
          { relationship_type: "child", related_person_role: "father" }),
      ];
      await hhProject(r);
      const call = samePerson({ projectPath: dir, assertionId: "a_090", treePersonId: "I3" }, LOCAL);
      await expect(call).rejects.toThrow(/could not tell which persona of record/);
      await expect(call).rejects.toThrow(
        `${HH_CHILD} (Maria Elisabeth Mouchang, role unknown), ` +
          `${HH_FATHER} (Pierre Mouchang, father), ` +
          `${HH_MOTHER} (Margreta Metzeler, role unknown)`,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses two siblings that carry the role under different persona ids, and lists both", async () => {
      recordReadMock.mockResolvedValue(
        hhDoc([{ id: "p_other", names: [{ given: "Johann", surname: "Mouchang" }] }]),
      );
      const r = hhResearch();
      r.assertions.push(hhAssertion("a_050", "father", "p_other", "name", "Johann Mouchang",
        { given: "Johann", surname: "Mouchang" }));
      await hhProject(r);
      const call = samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
        LOCAL,
      );
      await expect(call).rejects.toThrow(/role 'father' in record .* names more than one person/);
      await expect(call).rejects.toThrow(`${HH_FATHER} (Pierre Mouchang, father)`);
      await expect(call).rejects.toThrow("p_other (Johann Mouchang, father)");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("matches the joined given name and surname before the given name alone", async () => {
      // The child's relationship assertion gives the OTHER party's name in parts.
      // Two personas share its given name and two share its surname, so neither
      // part alone can choose; the whole name does.
      recordReadMock.mockResolvedValue({
        persons: [
          { id: "p_wrong", names: [{ given: "Pierre", surname: "Metzeler" }] },
          { id: "p_right", names: [{ given: "Pierre", surname: "Mouchang" }] },
          { id: "p_other", names: [{ given: "Johann", surname: "Mouchang" }] },
        ],
      });
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_070", "child", null, "relationship", "child of Pierre Mouchang",
          { relationship_type: "child", given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_070", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe("p_right");
      // Found by name for the role the caller asked, so it holds that role.
      expect(result.recordPersona).toEqual({ id: "p_right", name: "Pierre Mouchang", role: "father" });
    });

    it("ignores a sibling's persona id that is not on the fetched record", async () => {
      // The sibling's id is not on the record and the name it gives is on no
      // persona either: nothing resolves the role.
      const r = hhResearch();
      const father = (r.assertions as any[]).find((a) => a.id === "a_034");
      father.record_persona_id = "p_stale";
      father.value = "Somebody Else";
      father.structured_value = { given: "Somebody", surname: "Else" };
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to the sibling's name when its persona id is not on the fetched record", async () => {
      // The id is stale (the record was re-indexed under other ids), the name is not.
      const r = hhResearch();
      (r.assertions as any[]).find((a) => a.id === "a_034").record_persona_id = "p_stale";
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("keeps the assertion's own persona when recordRole equals the assertion's own role", async () => {
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I3", recordRole: "child" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_CHILD);
      expect(result.recordPersona).toEqual({ id: HH_CHILD, name: "Maria Elisabeth Mouchang", role: "child" });
    });

    it("keeps the assertion's own persona when recordRole is its own role and another persona holds that role too", async () => {
      // A register page holds several entries at one role. Asking for the role the
      // assertion already has is not asking for another party, so the siblings at
      // that role (two people here) must not be consulted.
      recordReadMock.mockResolvedValue(
        hhDoc([{ id: "p_child2", names: [{ given: "Anna", surname: "Mouchang" }] }]),
      );
      const r = hhResearch();
      r.assertions.push(hhAssertion("a_060", "child", "p_child2", "name", "Anna Mouchang",
        { given: "Anna", surname: "Mouchang" }));
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I3", recordRole: "child" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_CHILD);
      expect(result.recordPersona.id).toBe(HH_CHILD);
    });

    it("still honours recordPersonaId over a sibling's persona", async () => {
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          {
            projectPath: dir, assertionId: "a_038", treePersonId: "I2",
            recordRole: "father", recordPersonaId: HH_MOTHER,
          },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_MOTHER);
      // The persona is the mother; the response names her role, not the one asked.
      expect(result.recordPersona).toEqual({ id: HH_MOTHER, name: "Margreta Metzeler", role: "mother" });
      // ... and the attestation names the same role beside her id, not `father`.
      const [file] = await scoresOnDisk();
      expect(file.scores["a_038|I2"]).toMatchObject({ record_persona_id: HH_MOTHER, record_role: "mother" });
    });

    it("files the role a named persona holds when no role was asked, not the assertion's own", async () => {
      // a_038 is the child's. Naming the mother's persona must not leave `child`
      // beside her id.
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I2", recordPersonaId: HH_MOTHER },
          LOCAL,
        ),
      );
      expect(result.recordPersona.role).toBe("mother");
      const [file] = await scoresOnDisk();
      expect(file.scores["a_038|I2"]).toMatchObject({ record_persona_id: HH_MOTHER, record_role: "mother" });
    });

    it("files no role, and reports none, for a named persona that no assertion names", async () => {
      recordReadMock.mockResolvedValue(hhDoc([{ id: "p_unlisted", names: [{ given: "Anna", surname: "Zeller" }] }]));
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I2", recordPersonaId: "p_unlisted" },
          LOCAL,
        ),
      );
      expect(result.recordPersona).toEqual({ id: "p_unlisted", name: "Anna Zeller", role: null });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_038|I2"]).toMatchObject({ record_persona_id: "p_unlisted", record_role: null });
    });

    it("does not read negative evidence as a role the persona holds", async () => {
      // An `absent` row stamped with the father's id, listed before his own.
      const r = hhResearch();
      (r.assertions as any[]).unshift(hhAssertion("a_000", "absent", HH_FATHER, "name", ""));
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_039", treePersonId: "I1", recordPersonaId: HH_FATHER },
          LOCAL,
        ),
      );
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("lists a persona by the roles it holds, not by negative evidence about it", async () => {
      const r = hhResearch();
      (r.assertions as any[]).unshift(hhAssertion("a_000", "absent", HH_FATHER, "name", ""));
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "witness_1" },
          LOCAL,
        ),
      ).rejects.toThrow(`${HH_FATHER} (Pierre Mouchang, father)`);
    });

    it("refuses a recordPersonaId that names no persona on the fetched record", async () => {
      await hhProject();
      const call = samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordPersonaId: "p_nope" },
        LOCAL,
      );
      await expect(call).rejects.toThrow(/holds no persona with record_persona_id 'p_nope'/);
      await expect(call).rejects.toThrow(`${HH_FATHER} (Pierre Mouchang, father)`);
      // Not scored as the assertion's own persona.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
    });

    it("resolves a persona by the name the assertion gives that party when no sibling names it", async () => {
      // The father has no assertion of his own, so the child's relationship
      // assertion is the only place his name is written.
      const r = hhResearch();
      const rows = r.assertions as any[];
      r.assertions = rows.filter((a) => a.record_role !== "father");
      (r.assertions as any[]).find((a) => a.id === "a_038").structured_value = {
        relationship_type: "child", related_person_role: "father", father: "Pierre Mouchang",
      };
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      // No assertion names this persona, but the caller named the role and the name found it.
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("does not accept a name hit on the assertion's own persona when another role was asked", async () => {
      // The child's relationship assertion gives a name, and it is the child's own.
      // Nothing carries the father's id or name, so that name is all there is, and
      // it finds the assertion's own persona: the same wrong answer as the
      // fallback, through another door. The persona is left out of the candidates.
      recordReadMock.mockResolvedValue(
        docWithNames([HH_CHILD, "Maria Elisabeth", "Mouchang"], ["p_x", "Johann", "Zeller"]),
      );
      const r = hhResearch();
      r.assertions = (r.assertions as any[]).filter((a) => a.record_role !== "father");
      (r.assertions as any[]).find((a) => a.id === "a_038").structured_value = {
        relationship_type: "child", given: "Maria Elisabeth", surname: "Mouchang",
      };
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not read a name assertion's own name as the name of another party", async () => {
      // A name assertion is about one person. Its given name and surname are that
      // person's, so they say nothing about the father, however the persona id is
      // missing. Reading them as the father's scored the child as the father
      // whenever her assertion carried no persona id, which most name assertions
      // do not.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_031", "child", null, "name", "Maria Elisabeth Mouchang",
          { given: "Maria Elisabeth", surname: "Mouchang" }),
      ];
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_031", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
    });


    // ── a persona id the record stamps on more than one role ──

    it("does not resolve a role through a persona id the record stamps on more than one role", async () => {
      // The mother's persona id is on the father's assertion too, so that id names
      // no single party. It is not "the father's persona": the mother would be
      // scored as the father. The name his own assertion gives finds him.
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = HH_MOTHER;
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_038|I1"]).toMatchObject({ record_persona_id: HH_FATHER, record_role: "father" });
    });

    it("refuses a role whose only persona id is one the record stamps on several roles", async () => {
      // The same stamp, and no persona on the record bears the father's name:
      // the mother is all that is left, and she is the wrong answer.
      recordReadMock.mockResolvedValue(
        docWithNames([HH_CHILD, "Maria Elisabeth", "Mouchang"], [HH_MOTHER, "Margreta", "Metzeler"]),
      );
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = HH_MOTHER;
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
    });

    it("does not score the child as the father when her persona id is stamped on his assertion", async () => {
      // An extraction that wrote the searched persona's id on every party: the
      // child's id is on the father's assertion, and it is also the cited
      // assertion's own. Neither is the father.
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = HH_CHILD;
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona.id).toBe(HH_FATHER);
    });

    // ── the assertion's own persona id, when the record gives it to several roles ──

    it("does not trust the assertion's own persona id when the record gives it to several roles", async () => {
      // The child's id is on the father's own assertion too. That id names no single
      // party, so it is passed over as if his assertion carried none, and his name
      // finds him. Trusting it first scored the child as the father.
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = HH_CHILD;
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_034", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_034|I1"]).toMatchObject({ record_persona_id: HH_FATHER, record_role: "father" });
    });

    it("refuses, rather than scoring the persona a shared id names, when nothing else resolves the party", async () => {
      // The father's residence assertion carries the child's id, which her own name
      // assertion carries too, and gives no name of his: nothing is left to go on.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_050", "father", HH_CHILD, "residence", "Basel"),
        hhAssertion("a_051", "child", HH_CHILD, "name", "Maria Elisabeth Mouchang",
          { given: "Maria Elisabeth", surname: "Mouchang" }),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_050", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
    });

    it("keeps an own persona id that only one role carries, ahead of the name the assertion gives", async () => {
      // The other direction. a_034 carries the father's id (his alone) and, as a
      // stray, the child's name: the id is exact and comes first, as before.
      const r = hhResearch();
      hhRow(r, "a_034").structured_value = { given: "Maria Elisabeth", surname: "Mouchang" };
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_034", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona.id).toBe(HH_FATHER);
    });

    // ── the names the assertions give: another role, whole names, and parts ──

    it("reads the name a sibling name assertion gives the role, when no sibling carries a persona id", async () => {
      // The issue's worked case, with the extraction's persona ids gone: the
      // child's relationship assertion names a role and no name, and the father's
      // own name assertion is where his name is written.
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = null;
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("reads a sibling name assertion's given name and surname as well as its value", async () => {
      // `value` is the transcription ("Mouchang, Pierre"); the persona carries the
      // name as given then surname, which is what the structured value joins to.
      const r = hhResearch();
      const father = hhRow(r, "a_034");
      father.record_persona_id = null;
      father.value = "Mouchang, Pierre";
      await hhProject(r);
      okScore();
      await samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
        LOCAL,
      );
      expect(sentFocus().first).toBe(HH_FATHER);
    });

    it("takes a sibling's name only when exactly one persona bears it", async () => {
      // Two personas answer to the father's name, and nothing else says which.
      recordReadMock.mockResolvedValue(
        docWithNames(
          [HH_CHILD, "Maria Elisabeth", "Mouchang"],
          ["p_a", "Pierre", "Mouchang"],
          ["p_b", "Pierre", "Mouchang"],
        ),
      );
      const r = hhResearch();
      hhRow(r, "a_034").record_persona_id = null;
      await hhProject(r);
      const call = samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
        LOCAL,
      );
      await expect(call).rejects.toThrow(/holds no persona for role 'father'/);
      await expect(call).rejects.toThrow("p_a (Pierre Mouchang, role unknown), p_b (Pierre Mouchang, role unknown)");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not read the name a sibling gives ANOTHER role as the name of the role asked", async () => {
      // The mother's name assertion is a sibling too, and it names the mother.
      const r = hhResearch();
      r.assertions = (r.assertions as any[]).filter((a) => a.record_role !== "father");
      hhRow(r, "a_036").record_persona_id = null;
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("leaves the assertion's own persona out of a sibling name search", async () => {
      // The groom and his father are both John Flynn. The father's name assertion
      // carries no persona id, so only his name can find him, and the same name
      // finds the groom unless the groom's own persona is left out.
      recordReadMock.mockResolvedValue(docWithNames(["G1", "John", "Flynn"], ["F1", "John", "Flynn"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_004", "groom", "G1", "relationship", "son of John Flynn",
          { relationship_type: "child", related_person_role: "father_of_groom" }),
        hhAssertion("a_006", "father_of_groom", null, "name", "John Flynn",
          { given: "John", surname: "Flynn" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_004", treePersonId: "I1", recordRole: "father_of_groom" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe("F1");
      expect(result.recordPersona).toEqual({ id: "F1", name: "John Flynn", role: "father_of_groom" });
    });

    it("finds a father who shares his son's name, because the son's persona is left out first", async () => {
      // The groom's assertion names his father in its own words. Both personas bear
      // that name; the groom's persona is not a candidate for "the father", so one
      // is left. Rejecting the groom AFTER the name found him would end the search
      // there and refuse a call whose answer is on the record.
      recordReadMock.mockResolvedValue(docWithNames(["G1", "John", "Flynn"], ["F1", "John", "Flynn"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_004", "groom", "G1", "relationship", "son of John Flynn",
          { relationship_type: "child", father_of_groom: "John Flynn" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_004", treePersonId: "I1", recordRole: "father_of_groom" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe("F1");
      expect(result.recordPersona).toEqual({ id: "F1", name: "John Flynn", role: "father_of_groom" });
    });

    it("does not read a sibling's assertion that is not a name as a name", async () => {
      // The father's residence assertion happens to read like the mother's name.
      // Only a `name` assertion says what a party is called.
      const r = hhResearch();
      r.assertions = [
        hhRow(r, "a_038"),
        hhAssertion("a_034", "father", null, "residence", "Margreta Metzeler"),
      ];
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(["related_person_name", "person", "other"])(
      "reads the `%s` key of any assertion as the name of another party",
      async (key) => {
        // A birth assertion is about one person, yet it can name another under these keys.
        const r = hhResearch();
        r.assertions = [
          hhAssertion("a_041", "child", null, "birth", "", { [key]: "Pierre Mouchang" }),
        ];
        await hhProject(r);
        okScore();
        const result = projectResult(
          await samePerson(
            { projectPath: dir, assertionId: "a_041", treePersonId: "I1", recordRole: "father" },
            LOCAL,
          ),
        );
        expect(sentFocus().first).toBe(HH_FATHER);
        expect(result.recordPersona.role).toBe("father");
      },
    );

    it("reads the `name` of a two-party assertion as the other party's name", async () => {
      // `{ name, relation }` is how some extractions write the other party.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_042", "child", null, "relationship", "child of Pierre",
          { name: "Pierre Mouchang", relation: "father" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_042", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona.role).toBe("father");
    });

    it("reads the key its own role names as its own party's name, even on a two-party assertion", async () => {
      // The groom's marriage assertion writes both spouses by role. With no other
      // party asked for, the key for HIS role is his name, and `spouse` is not.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_043", "father", null, "marriage", "married",
          { father: "Pierre Mouchang", spouse: "Margreta Metzeler" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_043", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe(HH_FATHER);
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("does not count a persona with no id as one a name could find", async () => {
      // A persona with no id cannot be scored. It must not make a name ambiguous.
      recordReadMock.mockResolvedValue({
        persons: [
          { names: [{ given: "Pierre", surname: "Mouchang" }] },
          { id: "p_x", names: [{ given: "Pierre", surname: "Mouchang" }] },
        ],
      });
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL);
      expect(sentFocus().first).toBe("p_x");
    });

    it("reads the one key that names a second person as the other party's name", async () => {
      // The groom's marriage assertion names his spouse under `spouse`; nothing names a role.
      const r = hhResearch();
      r.assertions = [hhAssertion("a_040", "father", null, "marriage", "married", { spouse: "Margreta Metzeler" })];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_040", treePersonId: "I2", recordRole: "mother" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_MOTHER);
      expect(result.recordPersona).toEqual({ id: HH_MOTHER, name: "Margreta Metzeler", role: "mother" });
    });

    it("does not choose between two keys that each name a second person", async () => {
      // `father` and `mother` name two people. Neither is the "godparent" asked for.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_040", "child", null, "relationship", "child of two",
          { relationship_type: "child", father: "Pierre Mouchang", mother: "Margreta Metzeler" }),
      ];
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_040", treePersonId: "I1", recordRole: "godparent" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'godparent'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("reads the key named by the role asked before any second-person key", async () => {
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_040", "child", null, "relationship", "child of two",
          { relationship_type: "child", father: "Pierre Mouchang", mother: "Margreta Metzeler" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_040", treePersonId: "I2", recordRole: "mother" },
          LOCAL,
        ),
      );
      expect(sentFocus().first).toBe(HH_MOTHER);
      expect(result.recordPersona.role).toBe("mother");
    });

    it("takes the whole name exactly before it takes one that merely contains it", async () => {
      recordReadMock.mockResolvedValue(
        docWithNames(["p_sr", "Pierre", "Mouchang Sr"], ["p_pierre", "Pierre", "Mouchang"]),
      );
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL);
      expect(sentFocus().first).toBe("p_pierre");
    });

    it("takes the whole name loosely when no persona bears it exactly", async () => {
      // "Pierre Mouchang Sr" contains the whole name; neither part alone can choose
      // him, since another persona is a Pierre and another a Mouchang.
      recordReadMock.mockResolvedValue(
        docWithNames(
          ["p_sr", "Pierre", "Mouchang Sr"], ["p_pierre", "Pierre", "Metzeler"], ["p_johann", "Johann", "Mouchang"],
        ),
      );
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL);
      expect(sentFocus().first).toBe("p_sr");
    });

    it("refuses a whole name that two personas bear, instead of taking the first", async () => {
      recordReadMock.mockResolvedValue(
        docWithNames(["p_a", "Pierre", "Mouchang"], ["p_b", "Pierre", "Mouchang"], [HH_MOTHER, "Margreta", "Metzeler"]),
      );
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to the given name alone when the surname is spelled differently", async () => {
      // The register's "Flynn" is the index's "Flinn": no whole name matches, and
      // only one persona is a Patrick.
      recordReadMock.mockResolvedValue(docWithNames(["MP1", "Patrick", "Flinn"], ["MP2", "Mary", "Doyle"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Patrick Flynn", { given: "Patrick", surname: "Flynn" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe("MP1");
      expect(result.recordPersona).toEqual({ id: "MP1", name: "Patrick Flinn", role: "principal" });
    });

    it("falls back to the surname alone when the given name is spelled differently", async () => {
      recordReadMock.mockResolvedValue(docWithNames(["MP1", "Patrick", "Flynn"], ["MP2", "Mary", "Doyle"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Patrik Flynn", { given: "Patrik", surname: "Flynn" }),
      ];
      await hhProject(r);
      okScore();
      await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL);
      expect(sentFocus().first).toBe("MP1");
    });

    it("takes the surname alone when the given name fits two personas", async () => {
      // Two Pierres; one persona's name is written surname first. The given name
      // cannot choose, the surname can.
      recordReadMock.mockResolvedValue({
        persons: [
          { id: "p_wrong", names: [{ given: "Pierre", surname: "Metzeler" }] },
          { id: "p_right", names: [{ given: "Mouchang", surname: "Pierre" }] },
        ],
      });
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      await samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL);
      expect(sentFocus().first).toBe("p_right");
    });

    it("refuses a part of the name that fits two personas, instead of taking the first", async () => {
      // Two Patricks and two Flynns, and no whole name to tell them by: neither
      // part alone names one persona.
      recordReadMock.mockResolvedValue(
        docWithNames(
          ["MP1", "Patrick", "Doyle"], ["MP2", "Patrick", "Smith"],
          ["MP3", "Thomas", "Flynn"], ["MP4", "Anna", "Flynn"],
        ),
      );
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Patrick Flynn", { given: "Patrick", surname: "Flynn" }),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("matches a part of a name as a word of the persona's name, not as any run of letters", async () => {
      // "Ann" is inside "Hannah", who is not an Ann.
      recordReadMock.mockResolvedValue(docWithNames(["MP1", "Hannah", "Doyle"], ["MP2", "Mary", "Smith"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_001", "principal", null, "name", "Ann Zeller", { given: "Ann", surname: "Zeller" }),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
    });

    it("does not read a two-party assertion's given name and surname as its OWN party's name", async () => {
      // On the child's relationship assertion they name the other party, so with
      // no recordRole asked they say nothing about who the child is.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_070", "child", null, "relationship", "child of Pierre Mouchang",
          { relationship_type: "child", given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_070", treePersonId: "I3" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    // ── a record with one persona ──

    it("refuses the only persona of a record when the record's assertions know it as another role", async () => {
      // MP1 is the child by the extraction's own persona id, and the assertion
      // being scored is the father's: the one persona is not him.
      recordReadMock.mockResolvedValue(docWithNames(["MP1", "Maria", "Mouchang"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_005", "father", null, "residence", "Basel"),
        hhAssertion("a_009", "child", "MP1", "name", "Maria Mouchang"),
      ];
      await hhProject(r);
      await expect(
        samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
      ).rejects.toThrow(/could not tell which persona/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("scores the only persona of a record when the record's assertions know it as the assertion's own role", async () => {
      recordReadMock.mockResolvedValue(docWithNames(["MP1", "Pierre", "Mouchang"]));
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_005", "father", null, "residence", "Basel"),
        hhAssertion("a_009", "father", "MP1", "name", "Pierre Mouchang"),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe("MP1");
      expect(result.recordPersona).toEqual({ id: "MP1", name: "Pierre Mouchang", role: "father" });
    });

    it("scores the only persona of a record when the assertion names none, and gives it the assertion's role", async () => {
      recordReadMock.mockResolvedValue({
        persons: [{ id: "MP1", names: [{ given: "Thomas", surname: "Flynn" }] }],
      });
      await project();
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_005", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe("MP1");
      expect(result.recordPersona).toEqual({ id: "MP1", name: "Thomas Flynn", role: "principal" });
    });

    it("refuses a one-persona record when another role was asked, instead of scoring its only persona", async () => {
      // The only persona on the record is the assertion's own party, not the bride.
      recordReadMock.mockResolvedValue({
        persons: [{ id: "MP1", names: [{ given: "Thomas", surname: "Flynn" }] }],
      });
      await project();
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_005", treePersonId: "I2", recordRole: "bride" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'bride'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("anchors a matchRelatives walk on the persona the role names", async () => {
      await hhProject();
      mockFetch.mockResolvedValue({ ok: true, json: async () => matchResponse });
      const result = await samePerson(
        {
          projectPath: dir, assertionId: "a_038", treePersonId: "I1",
          recordRole: "father", matchRelatives: true,
        },
        LOCAL,
      );
      if (!("matchRelatives" in result)) throw new Error("expected a relatives result");
      // The father's relatives are his spouse and his child; the child's would
      // be two parents.
      expect(result.matches.map((m) => `${m.role}:${m.targetId}`).sort()).toEqual([
        `child:${HH_CHILD}`,
        `spouse:${HH_MOTHER}`,
      ]);
    });

    it("returns recordPersona and treePerson, and none of queryArk, candidateArk, apiTitle, updated", async () => {
      await hhProject();
      okScore();
      const match = notHaving(
        await samePerson({ projectPath: dir, assertionId: "a_034", treePersonId: "I1" }, LOCAL),
        "matchRelatives",
      );
      // An exact set, so a stray field fails as surely as a missing one.
      expect(Object.keys(match).sort()).toEqual(
        ["confidence", "matched", "recordPersona", "recordSource", "recorded", "score", "treePerson"],
      );
      expect(match).not.toHaveProperty("queryArk");
      expect(match).not.toHaveProperty("candidateArk");
      expect(match).not.toHaveProperty("apiTitle");
      expect(match).not.toHaveProperty("updated");

      // A non-match carries no confidence, and still names whom it scored.
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => noMatchResponse });
      const nonMatch = notHaving(
        await samePerson({ projectPath: dir, assertionId: "a_034", treePersonId: "I3" }, LOCAL),
        "matchRelatives",
      );
      expect(Object.keys(nonMatch).sort()).toEqual(
        ["matched", "recordPersona", "recordSource", "recorded", "score", "treePerson"],
      );
      expect(projectResult(nonMatch).treePerson).toEqual({ id: "I3", name: "Maria Elisabeth Mouchang" });
    });

    it("files the same persona samePerson resolved for that call", async () => {
      await hhProject();
      okScore();
      await samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
        LOCAL,
      );
      const [file] = await scoresOnDisk();
      const filed = file.scores["a_038|I1"];
      // The harness has no fetch, so it derives the attestation from the project
      // documents with the same lookup. The two must not disagree on a call.
      const derived = buildRecordedScore(
        hhResearch(), "a_038", "I1", "father", { score: filed.score, matched: filed.matched },
      );
      expect(derived?.record_persona_id).toBe(filed.record_persona_id);
      expect(derived?.record_persona_id).toBe(HH_FATHER);
      expect(derived?.record_role).toBe(filed.record_role);
    });
  });

  // The same household when the fetch fails (the default here): the record's own
  // assertions are the record, and its parties are the groups they fall into.
  describe("a projected household (recordRole)", () => {
    const hhProject = (r: any = hhResearch()) => project(r, HH_TREE);
    /** A second man at the role `father`, under a persona id of his own. */
    const otherFather = (id: string) =>
      hhAssertion(id, "father", "p_other", "name", "Johann Mouchang", { given: "Johann", surname: "Mouchang" });

    it("refuses a role that two groups hold, and lists them, instead of scoring the first", async () => {
      const r = hhResearch();
      (r.assertions as any[]).push(otherFather("a_050"));
      await hhProject(r);
      const call = samePerson(
        { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
        LOCAL,
      );
      await expect(call).rejects.toThrow(/role 'father' in record .* names more than one person/);
      await expect(call).rejects.toThrow(
        `${HH_FATHER} (Pierre Mouchang, father), p_other (Johann Mouchang, father)`,
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(await scoresOnDisk()).toEqual([]);
    });

    it("scores a role that one group holds", async () => {
      await hhProject();
      okScore();
      const result = projectResult(
        await samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      );
      expect(result.recordSource).toBe("projection");
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
    });

    it("scores the group the assertion itself falls in when its role holds two, whichever is first", async () => {
      // Two fathers, and the other one is listed first. The first group at the role
      // is not the cited assertion's, so the role alone would score the wrong man.
      const r = hhResearch();
      (r.assertions as any[]).unshift(otherFather("a_050"));
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_034", treePersonId: "I1" }, LOCAL),
      );
      expect(result.recordPersona).toEqual({ id: HH_FATHER, name: "Pierre Mouchang", role: "father" });
      const [file] = await scoresOnDisk();
      expect(file.scores["a_034|I1"]).toMatchObject({ record_persona_id: HH_FATHER, record_role: "father" });
    });

    it("scores an id-less party of an extraction that set ids, though another persona holds its role", async () => {
      // Inside an extraction that set ids a party without one is a different person,
      // so the record holds two groups at `father`. The cited assertion is in the
      // id-less one: its group is not a guess.
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_049", "father", null, "name", "Pierre Mouchang", { given: "Pierre", surname: "Mouchang" }),
        otherFather("a_050"),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_049", treePersonId: "I1" }, LOCAL),
      );
      expect(result.recordPersona).toEqual({ id: null, name: "Pierre Mouchang", role: "father" });
    });
  });
});

// ─── the score a production call records answers the writer's persona arm (#3552)
//
// The writer shares a score across a persona's facts only when the entry names
// the persona it compared, carries `party_resolved`, and a role the record gives
// that persona. These run the real project arm (record_read and the match API
// mocked) on the shape extraction now writes for an accepted hint, and check the
// entry it records against the lookup research_append makes.

describe("samePerson — the recorded entry answers for the persona's other facts (#3552)", () => {
  let dir: string;
  const RECORD = "https://www.familysearch.org/ark:/61903/1:1:HINT-001";
  const research = () => ({
    log: [
      { id: "log_h", tool: "person_record_matches", outcome: "positive", query: { recordId: RECORD }, results_ref: null },
    ],
    assertions: [
      { id: "a_010", record_id: RECORD, record_role: "principal", fact_type: "name", value: "John Smith", record_persona_id: "P1", record_basis: "stated", log_entry_id: "log_h" },
      { id: "a_011", record_id: RECORD, record_role: "principal", fact_type: "birth", value: "1850", record_persona_id: "P1", record_basis: "stated", log_entry_id: "log_h" },
      { id: "a_020", record_id: RECORD, record_role: "father", fact_type: "name", value: "Thomas Smith", record_persona_id: "F1", record_basis: "stated", log_entry_id: "log_h" },
    ],
  });
  const TREE = {
    persons: [
      { id: "I1", gender: "Male", names: [{ given: "John", surname: "Smith" }] },
      { id: "I2", gender: "Male", names: [{ given: "Thomas", surname: "Smith" }] },
    ],
    relationships: [],
  };
  const P1 = { personaId: "P1", roles: new Set(["principal"]) };
  const F1 = { personaId: "F1", roles: new Set(["father"]) };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "same-person-persona-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(research()), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE), "utf8");
    mockFetch.mockResolvedValue({ ok: true, json: async () => matchResponse });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fetched = () =>
    recordReadMock.mockResolvedValue({
      persons: [
        { id: "P1", names: [{ given: "John", surname: "Smith" }] },
        { id: "F1", names: [{ given: "Thomas", surname: "Smith" }] },
      ],
    });

  it("fetched: the assertion's own party covers the persona's other facts", async () => {
    fetched();
    await samePerson({ projectPath: dir, assertionId: "a_010", treePersonId: "I1" }, LOCAL);
    expect(recordReadMock.mock.calls[0][0].resultsRef).toBeUndefined();
    const file = await readMatchScores(dir, RECORD);
    expect(findRecordedScore(file, "a_011", "I1", P1)?.party_resolved).toBe(true);
  });

  it("fetched: a recordRole call covers the party it compared, not the assertion's own", async () => {
    fetched();
    await samePerson({ projectPath: dir, assertionId: "a_010", treePersonId: "I2", recordRole: "father" }, LOCAL);
    const file = await readMatchScores(dir, RECORD);
    expect(findRecordedScore(file, "a_020", "I2", F1)).not.toBeNull();
    expect(findRecordedScore(file, "a_011", "I2", P1)).toBeNull();
  });

  it("projected: the persona taken from the assertions covers its other facts", async () => {
    await samePerson({ projectPath: dir, assertionId: "a_010", treePersonId: "I1" }, LOCAL);
    const file = await readMatchScores(dir, RECORD);
    const entry = findRecordedScore(file, "a_011", "I1", P1);
    expect(entry?.record_source).toBe("projection");
  });
});

// ─── buildRecordedScore (#1731 PR B) ────────────────────────────────────────
//
// Extracted so the eval harness can write a truthful attestation on a
// fixture-served call: `same_person` is not in the unit harness's LIVE_TOOLS,
// so this file never runs there and `results/.scores/` never exists, which
// makes any writer-side gate that reads one untestable.
//
// `record_source` is the field that cannot be copied from the fetch, because a
// mock performs none, so it is derived from the same routes `personaReachable`
// encodes. These pin that derivation: a mutation making it constant passed the
// whole pre-existing suite.

describe("buildRecordedScore", () => {
  const RESULT = { score: 0.82, confidence: 7, matched: true };
  const research = (assertion: Record<string, unknown>, log: unknown[] = []) => ({
    assertions: [assertion],
    log,
  });

  it("returns null when the assertion is not in the project", () => {
    expect(buildRecordedScore(research({ id: "a_001", record_id: "r1" }),
      "a_999", "I1", undefined, RESULT)).toBeNull();
  });

  it("returns null when the assertion carries no record_id", () => {
    expect(buildRecordedScore(research({ id: "a_001" }),
      "a_001", "I1", undefined, RESULT)).toBeNull();
  });

  // ── record_source: the three routes that mean the record can be opened ──
  it("reads as record_read when the assertion carries a persona id", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", record_persona_id: "P1" }),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("record_read");
    expect(r?.record_persona_id).toBe("P1");
  });

  it("reads as record_read when the log entry is a record_read", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", log_entry_id: "log_1" },
               [{ id: "log_1", tool: "record_read" }]),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("record_read");
  });

  it("reads as record_read for a record_search that retained its sidecar", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", log_entry_id: "log_1" },
               [{ id: "log_1", tool: "record_search", results_ref: "results/log_1.json" }]),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("record_read");
  });

  it("reads as record_read for an accepted FamilySearch hint (search-hints, #2029)", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "ark:/61903/1:1:MABC", log_entry_id: "log_1" },
               [{ id: "log_1", tool: "person_record_matches" }]),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("record_read");
  });

  // ── and the cases that must NOT read as fetchable ──
  it("reads as projection for a full-text hit", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", log_entry_id: "log_1" },
               [{ id: "log_1", tool: "fulltext_search", results_ref: "results/log_1.json" }]),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("projection");
  });

  it("reads as projection for a record_search whose sidecar was not retained", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", log_entry_id: "log_1" },
               [{ id: "log_1", tool: "record_search" }]),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("projection");
  });

  it("reads as projection when the log entry is missing entirely", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", log_entry_id: "log_gone" }),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_source).toBe("projection");
  });

  // ── the rest of the record ──
  it("prefers an explicit role over the assertion's own", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", record_role: "groom" }),
      "a_001", "I1", "father_of_groom", RESULT);
    expect(r?.record_role).toBe("father_of_groom");
  });

  it("reads an empty role as none, and files the assertion's own", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", record_role: "groom" }),
      "a_001", "I1", "", RESULT);
    expect(r?.record_role).toBe("groom");
  });

  it("falls back to the assertion's record_role", () => {
    const r = buildRecordedScore(
      research({ id: "a_001", record_id: "r1", record_role: "groom" }),
      "a_001", "I1", undefined, RESULT);
    expect(r?.record_role).toBe("groom");
  });

  it("omits confidence when the API returned none", () => {
    const r = buildRecordedScore(research({ id: "a_001", record_id: "r1" }),
      "a_001", "I1", undefined, { score: 0.1, matched: false });
    expect(r).not.toHaveProperty("confidence");
    expect(r?.matched).toBe(false);
  });

  // ── the persona it files: the same one samePerson resolves for the call ──
  it("records the father's persona id for recordRole father", () => {
    const r = buildRecordedScore(hhResearch(), "a_038", "I1", "father", RESULT);
    expect(r?.record_persona_id).toBe(HH_FATHER);
    expect(r?.record_role).toBe("father");
  });

  it("records the assertion's own persona when the role asked is its own", () => {
    const r = buildRecordedScore(hhResearch(), "a_038", "I3", "child", RESULT);
    expect(r?.record_persona_id).toBe(HH_CHILD);
  });

  it("records no persona when another role was asked and no sibling carries one", () => {
    // Filing the assertion's own persona here is what the attestation did before:
    // a child's persona under the role father.
    const r = buildRecordedScore(hhResearch(), "a_038", "I1", "witness_1", RESULT);
    expect(r?.record_persona_id).toBeNull();
    expect(r?.record_role).toBe("witness_1");
  });

  it("records no persona when two siblings carry the role under different ids", () => {
    const r = hhResearch();
    r.assertions.push(hhAssertion("a_050", "father", "p_other", "name", "Johann Mouchang"));
    expect(buildRecordedScore(r, "a_038", "I1", "father", RESULT)?.record_persona_id).toBeNull();
  });

  it("records an explicit recordPersonaId over everything else", () => {
    const r = buildRecordedScore(hhResearch(), "a_038", "I2", "father", RESULT, HH_MOTHER);
    expect(r?.record_persona_id).toBe(HH_MOTHER);
  });

  it("records no persona when the record stamps the father's id on more than one role", () => {
    // The mother's id on the father's assertion names no single party, so it is
    // not "the persona of the father".
    const r = hhResearch();
    hhRow(r, "a_034").record_persona_id = HH_MOTHER;
    expect(buildRecordedScore(r, "a_038", "I1", "father", RESULT)?.record_persona_id).toBeNull();
  });

  it("records no persona for the assertion's own id when the record gives it to several roles", () => {
    // The child's id on the father's own assertion names no single party. Filing it
    // is filing the child as the father; only a fetch can say who the call is about.
    const r = hhResearch();
    hhRow(r, "a_034").record_persona_id = HH_CHILD;
    expect(buildRecordedScore(r, "a_034", "I1", undefined, RESULT)?.record_persona_id).toBeNull();
    // while an id one role carries is filed, as before
    expect(buildRecordedScore(hhResearch(), "a_034", "I1", undefined, RESULT)?.record_persona_id).toBe(HH_FATHER);
  });

  it("records the role the record gives a persona the caller named, not the role asked", () => {
    const named = buildRecordedScore(hhResearch(), "a_038", "I2", "father", RESULT, HH_MOTHER);
    expect(named?.record_persona_id).toBe(HH_MOTHER);
    expect(named?.record_role).toBe("mother");
    // with no role asked, not the assertion's own `child`
    expect(buildRecordedScore(hhResearch(), "a_038", "I2", undefined, RESULT, HH_MOTHER)?.record_role)
      .toBe("mother");
  });

  it("records no role for a named persona that no assertion names", () => {
    const r = buildRecordedScore(hhResearch(), "a_038", "I2", "father", RESULT, "p_unlisted");
    expect(r?.record_persona_id).toBe("p_unlisted");
    expect(r?.record_role).toBeNull();
  });
});

// ─── resolvePartyBySiblings: the lookup both callers share ──────────────────

describe("resolvePartyBySiblings", () => {
  const own = { id: "a_038", record_id: HH_RECORD, record_role: "child", record_persona_id: HH_CHILD };

  it("says `own` when no role was asked, or the role asked is the assertion's own", () => {
    for (const asked of [undefined, null, "", "child"]) {
      expect(resolvePartyBySiblings(hhResearch(), own, asked as any)).toEqual({ kind: "own" });
    }
  });

  it("resolves the one persona id the siblings carry for the role asked", () => {
    expect(resolvePartyBySiblings(hhResearch(), own, "father")).toEqual({
      kind: "resolved", personaId: HH_FATHER,
    });
  });

  it("reports two distinct persona ids as ambiguous, in record order", () => {
    const r = hhResearch();
    r.assertions.push(hhAssertion("a_050", "father", "p_other", "name", "Johann Mouchang"));
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({
      kind: "ambiguous", personaIds: [HH_FATHER, "p_other"],
    });
  });

  it("does not count one persona id carried by several siblings as two", () => {
    const r = hhResearch();
    r.assertions.push(hhAssertion("a_035", "father", HH_FATHER, "sex", "Male"));
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "resolved", personaId: HH_FATHER });
  });

  it("is unresolved when nothing carries the role, or only without a persona id", () => {
    expect(resolvePartyBySiblings(hhResearch(), own, "witness_1")).toEqual({ kind: "unresolved" });
    const r = hhResearch();
    (r.assertions as any[]).find((a) => a.id === "a_034").record_persona_id = null;
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "unresolved" });
  });

  it("ignores a sibling of a different record", () => {
    const r = hhResearch();
    for (const a of r.assertions as any[]) {
      if (a.record_role === "father") a.record_id = "ark:/61903/1:1:ZZZZ-ZZZ";
    }
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "unresolved" });
  });

  it("matches the record whichever spelling of its id each assertion carries", () => {
    const r = hhResearch();
    for (const a of r.assertions as any[]) {
      if (a.record_role === "father") a.record_id = "https://www.familysearch.org/ark:/61903/1:1:6LYF-G8RJ";
    }
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "resolved", personaId: HH_FATHER });
  });

  it("keeps only the persona ids the fetched record holds", () => {
    expect(resolvePartyBySiblings(hhResearch(), own, "father", [HH_CHILD, HH_MOTHER])).toEqual({
      kind: "unresolved",
    });
    expect(resolvePartyBySiblings(hhResearch(), own, "father", [HH_FATHER])).toEqual({
      kind: "resolved", personaId: HH_FATHER,
    });
  });

  it("skips a persona id the record gives to more than one role", () => {
    // The mother's id is on the father's assertion as well as hers. It is not the
    // cited assertion's own id, so only the shared-id rule keeps it from answering.
    const r = hhResearch();
    hhRow(r, "a_034").record_persona_id = HH_MOTHER;
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "unresolved" });
  });

  it("does not make an id shared by an `absent` row that carries it", () => {
    // Negative evidence is no role a persona holds, so the father's id is still his.
    const r = hhResearch();
    (r.assertions as any[]).push(hhAssertion("a_099", "absent", HH_FATHER, "name", ""));
    expect(resolvePartyBySiblings(r, own, "father")).toEqual({ kind: "resolved", personaId: HH_FATHER });
  });

  it("skips the assertion's own persona id, even when its role is unknown", () => {
    // With no record_role on the cited assertion its id counts as no role of
    // anyone's, so only the rule against its own id keeps it from answering.
    const roleless = { id: "a_x", record_id: HH_RECORD, record_role: null, record_persona_id: HH_FATHER };
    expect(resolvePartyBySiblings(hhResearch(), roleless, "father")).toEqual({ kind: "unresolved" });
  });

  it("reads an assertion with no record_role as asking for any role named", () => {
    const noRole = { id: "a_x", record_id: HH_RECORD, record_role: null, record_persona_id: null };
    expect(resolvePartyBySiblings(hhResearch(), noRole, "father")).toEqual({
      kind: "resolved", personaId: HH_FATHER,
    });
    expect(resolvePartyBySiblings(hhResearch(), noRole, undefined)).toEqual({ kind: "own" });
  });
});

// ─── describeScoredPair: whom a project-arm call is about, from the documents ─

describe("describeScoredPair", () => {
  const RESULT_ARGS = [hhResearch(), HH_TREE] as const;

  it("names the assertion's own persona and the tree person", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_034", "I1", undefined)).toEqual({
      recordPersona: { id: HH_FATHER, name: "Pierre Mouchang", role: "father" },
      treePerson: { id: "I1", name: "Pierre Mouchang" },
    });
  });

  it("names the persona the role asked for, not the assertion's own", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_038", "I2", "mother")).toEqual({
      recordPersona: { id: HH_MOTHER, name: "Margreta Metzeler", role: "mother" },
      treePerson: { id: "I2", name: "Margreta Metzeler" },
    });
  });

  it("names an explicit recordPersonaId by what the record says that persona is", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_038", "I2", "father", HH_MOTHER)?.recordPersona).toEqual({
      id: HH_MOTHER, name: "Margreta Metzeler", role: "mother",
    });
  });

  it("gives a null id and the group's own name for a party the record gave no persona id", () => {
    const research = {
      assertions: [
        { id: "a_005", record_id: "ark:/61903/1:1:MARR-8T3", record_role: "principal",
          fact_type: "name", value: "Thomas Flynn", record_persona_id: null, record_basis: "stated" },
        { id: "a_006", record_id: "ark:/61903/1:1:MARR-8T3", record_role: "bride",
          fact_type: "name", value: "Mary Doyle", record_persona_id: null, record_basis: "stated" },
      ],
    };
    expect(describeScoredPair(research, HH_TREE, "a_005", "I1", undefined)?.recordPersona).toEqual({
      id: null, name: "Thomas Flynn", role: "principal",
    });
    expect(describeScoredPair(research, HH_TREE, "a_005", "I2", "bride")?.recordPersona).toEqual({
      id: null, name: "Mary Doyle", role: "bride",
    });
  });

  it("leaves the name empty when the record carries none for that party", () => {
    const research = {
      assertions: [
        { id: "a_005", record_id: "r1", record_role: "principal", fact_type: "marriage",
          value: "married", record_persona_id: null, record_basis: "stated" },
      ],
    };
    expect(describeScoredPair(research, HH_TREE, "a_005", "I1", undefined)?.recordPersona).toEqual({
      id: null, name: "", role: "principal",
    });
  });

  it("names nobody for a role that two groups hold, as production refuses to choose between them", () => {
    const r = hhResearch();
    (r.assertions as any[]).push(hhAssertion("a_050", "father", "p_other", "name", "Johann Mouchang"));
    expect(describeScoredPair(r, HH_TREE, "a_038", "I1", "father")?.recordPersona).toEqual({
      id: null, name: "", role: "father",
    });
  });

  it("names no one for a persona id that no group holds", () => {
    // Production refuses such an id; it does not name the group that holds the role.
    expect(describeScoredPair(...RESULT_ARGS, "a_038", "I1", "father", "p_nope")?.recordPersona).toEqual({
      id: "p_nope", name: "", role: null,
    });
  });

  it("names the one group at the role when no persona id says which", () => {
    // The record stamps the mother's id on the father's assertion, so no id resolves
    // him. His own group is the only one at the role, and production finds the same
    // man by his name.
    const r = hhResearch();
    hhRow(r, "a_034").record_persona_id = HH_MOTHER;
    expect(describeScoredPair(r, HH_TREE, "a_038", "I1", "father")?.recordPersona).toEqual({
      id: null, name: "Pierre Mouchang", role: "father",
    });
  });

  it("names the one group at the role for an assertion whose own id the record gives to several roles", () => {
    const r = hhResearch();
    hhRow(r, "a_034").record_persona_id = HH_CHILD;
    expect(describeScoredPair(r, HH_TREE, "a_034", "I1", undefined)?.recordPersona).toEqual({
      id: null, name: "Pierre Mouchang", role: "father",
    });
  });

  it("leaves a tree person's name empty when the tree does not hold them", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_034", "I99", undefined)?.treePerson).toEqual({
      id: "I99", name: "",
    });
  });

  it("is null when the assertion is not in the project", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_999", "I1", undefined)).toBeNull();
  });
});
