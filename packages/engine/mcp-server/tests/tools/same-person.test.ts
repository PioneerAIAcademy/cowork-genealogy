import { LOCAL } from "../../src/auth/principal.js";
import { mkdtemp, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { samePerson } from "../../src/tools/same-person.js";
import { notHaving } from "../helpers/narrow.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";
import type { SamePersonApiResponse } from "../../src/types/same-person.js";

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

describe("samePerson", () => {
  describe("happy path", () => {
    it("returns matched=true with confidence + score + ARKs on a match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => matchResponse,
      });

      const result = notHaving(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL), "matchRelatives");

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

      const result = notHaving(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", "https://familysearch.org/ark:/61903/4:1:NONMATCH"),
        primaryId2: "I1",
      }, LOCAL), "matchRelatives");

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
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(
        samePerson({
          gedcomx1: makeGedcomx("I1", QUERY_ARK),
          primaryId1: "I1",
          gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
          primaryId2: "I1",
        }, LOCAL),
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

      const result = notHaving(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL), "matchRelatives");

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

      const result = notHaving(await samePerson({
        gedcomx1: makeGedcomx("I1", QUERY_ARK),
        primaryId1: "I1",
        gedcomx2: makeGedcomx("I1", CANDIDATE_ARK),
        primaryId2: "I1",
      }, LOCAL), "matchRelatives");

      expect(result.queryArk).toBe("ark:/61903/4:1:MMMM-MMM");
    });
  });
});

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
          evidence_type: "direct", log_entry_id: "log_1",
        },
        {
          id: "a_006", record_id: RECORD, record_role: "bride",
          fact_type: "name", value: "Mary Doyle", record_persona_id: null,
          evidence_type: "direct", log_entry_id: "log_1",
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
    expect(file.scores["principal|I1"]).toMatchObject({
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
    expect(file.scores["MP1|I1"]).toBeTruthy();
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
    expect(file.scores["bride|I2"]?.record_role).toBe("bride");
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
        evidence_type: "direct", log_entry_id: "log_1",
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
      expect(file.scores["p_thomas|I1"]).toBeTruthy();
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
        evidence_type: "direct", log_entry_id: "log_1",
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
        evidence_type: "direct", log_entry_id: "log_1",
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
});
