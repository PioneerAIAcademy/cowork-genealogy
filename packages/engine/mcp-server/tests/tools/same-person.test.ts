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
      // The first persona whose name merely CONTAINS "pierre" is the wrong one.
      recordReadMock.mockResolvedValue({
        persons: [
          { id: "p_wrong", names: [{ given: "Pierre", surname: "Metzeler" }] },
          { id: "p_right", names: [{ given: "Pierre", surname: "Mouchang" }] },
        ],
      });
      const r = hhResearch();
      r.assertions = [
        hhAssertion("a_070", "father", null, "relationship", "child of Pierre Mouchang",
          { given: "Pierre", surname: "Mouchang" }),
      ];
      await hhProject(r);
      okScore();
      const result = projectResult(
        await samePerson({ projectPath: dir, assertionId: "a_070", treePersonId: "I1" }, LOCAL),
      );
      expect(sentFocus().first).toBe("p_right");
      // Found by name as the assertion's own party, so it holds the assertion's role.
      expect(result.recordPersona).toEqual({ id: "p_right", name: "Pierre Mouchang", role: "father" });
    });

    it("ignores a sibling's persona id that is not on the fetched record", async () => {
      const r = hhResearch();
      (r.assertions as any[]).find((a) => a.id === "a_034").record_persona_id = "p_stale";
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_038", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
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

    it("resolves a persona by name when another role was asked and no sibling carries a persona id", async () => {
      const r = hhResearch();
      const rows = r.assertions as any[];
      rows.find((a) => a.id === "a_034").record_persona_id = null;
      rows.find((a) => a.id === "a_038").structured_value = {
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
      // a_031 is the child's own name assertion, so its name hint is the child.
      // With no sibling carrying the father's persona id, that hint would resolve
      // the asked role to the assertion's own persona by name: the same wrong
      // answer as the fallback, through another door.
      const r = hhResearch();
      (r.assertions as any[]).find((a) => a.id === "a_034").record_persona_id = null;
      await hhProject(r);
      await expect(
        samePerson(
          { projectPath: dir, assertionId: "a_031", treePersonId: "I1", recordRole: "father" },
          LOCAL,
        ),
      ).rejects.toThrow(/holds no persona for role 'father'/);
      expect(mockFetch).not.toHaveBeenCalled();
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

  it("leaves a tree person's name empty when the tree does not hold them", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_034", "I99", undefined)?.treePerson).toEqual({
      id: "I99", name: "",
    });
  });

  it("is null when the assertion is not in the project", () => {
    expect(describeScoredPair(...RESULT_ARGS, "a_999", "I1", undefined)).toBeNull();
  });
});
