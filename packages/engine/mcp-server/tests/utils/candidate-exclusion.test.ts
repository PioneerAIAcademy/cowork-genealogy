import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getProjectStore } from "../../src/store/project-store.js";
import {
  CANDIDATE_PAGE_MAX,
  candidateExclusionRefusal,
  excludedCandidates,
} from "../../src/utils/candidate-exclusion.js";

const ANTOINE = {
  recordId: "ark:/61903/1:1:MFLB-F5N",
  personName: "Antoine Tyler",
  sex: "Female",
  birthDate: "1833",
  collectionId: "1438024",
};

function research(log: unknown[], extra: Record<string, unknown> = {}) {
  return {
    project: { id: "proj_test", title: "t", created: "2026-11-23" },
    questions: [],
    plans: [],
    log,
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

const logEntry = (id: string, outcome = "positive") => ({
  id,
  plan_item_id: "pli_002",
  performed: "2026-11-23",
  tool: "record_search",
  query: {},
  outcome,
  results_examined: 1,
  results_ref: `results/${id}.json`,
  external_site: null,
});

const sidecar = (
  id: string,
  subjectId: string | null,
  results: unknown[],
  query: Record<string, unknown> = {},
  totalMatches?: number,
) => ({
  log_id: id,
  tool: "record_search",
  retrieved: "2026-11-23T00:00:00Z",
  returned_count: results.length,
  payload: {
    query: { surname: "Tyler", givenName: "An*", collectionId: "1438024", ...query, ...(subjectId ? { subjectId } : {}) },
    ...(totalMatches === undefined ? {} : { totalMatches }),
    results,
  },
});

/** A tree holding I1 under the given names `names` (Ann and Antone by default), and I2. */
const tree = (names: string[] = ["Ann", "Antone"]) => ({
  persons: [
    {
      id: "I1",
      names: names.map((given, i) => ({ id: `N${i + 1}`, given, surname: "Tyler", type: i === 0 ? "BirthName" : "AlsoKnownAs" })),
      facts: [],
    },
    { id: "I2", names: [{ id: "N9", given: "Margaret", surname: "Tyler", type: "BirthName" }], facts: [] },
  ],
  relationships: [],
  sources: [],
});

describe("candidateExclusionRefusal (issue #4580)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "candidate-exclusion-"));
    await getProjectStore().writeJson(dir, "tree.gedcomx.json", tree());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(
    rows: unknown[],
    subjectId: string | null = "I1",
    extra: Record<string, unknown> = {},
    query: Record<string, unknown> = {},
    opts: { outcome?: string; totalMatches?: number } = {},
  ) {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001", opts.outcome)], extra));
    await getProjectStore().writeJson(dir, "results/log_001.json", sidecar("log_001", subjectId, rows, query, opts.totalMatches));
  }

  const ranged = (more: Record<string, unknown> = {}) => ({
    projectPath: dir,
    subjectId: "I1",
    birthYearFrom: 1848,
    birthYearTo: 1858,
    ...more,
  });

  it("refuses a birthYearFrom above an earlier candidate's birth year, naming it and the years to include", async () => {
    await seed([ANTOINE]);
    const refusal = await candidateExclusionRefusal(ranged());
    expect(refusal).toContain("Antoine Tyler (ark:/61903/1:1:MFLB-F5N), born 1833, from log_001");
    expect(refusal).toContain("includes 1833");
  });

  it("refuses a birthYearTo below the candidate's birth year, with no lower bound", async () => {
    await seed([{ ...ANTOINE, birthDate: "1870" }]);
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", birthYearTo: 1860 })).not.toBeNull();
  });

  it("allows a range that includes the candidate, and a search with no range", async () => {
    await seed([ANTOINE]);
    expect(await candidateExclusionRefusal(ranged({ birthYearFrom: 1830 }))).toBeNull();
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1" })).toBeNull();
  });

  it("allows a range whose bound is the candidate's year, at either end", async () => {
    await seed([ANTOINE]);
    expect(await excludedCandidates(ranged({ birthYearFrom: 1833 }))).toEqual([]);
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearTo: 1833 })).toEqual([]);
    expect(await excludedCandidates(ranged({ birthYearFrom: 1834 }))).toHaveLength(1);
    expect(await excludedCandidates({ projectPath: dir, subjectId: "I1", birthYearTo: 1832 })).toHaveLength(1);
  });

  describe("a call with no subjectId", () => {
    const subjects = (ids: unknown) => ({ project: { id: "proj_test", title: "t", created: "2026-11-23", subject_person_ids: ids } });
    const bare = (more: Record<string, unknown> = {}) => ({ projectPath: dir, birthYearFrom: 1848, birthYearTo: 1858, ...more });

    /** The tree with I1 born `birth` (no birth fact when null). */
    const bornIn = async (birth: string | null) => {
      const t: any = tree();
      t.persons[0].facts = birth === null ? [] : [{ id: "F1", type: "Birth", date: birth }];
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", t);
    };

    beforeEach(async () => {
      await bornIn("Apr 1853");
    });

    it("is not judged when its range leaves out the subject's own tree birth year: a daughter named for her", async () => {
      await seed([ANTOINE], "I1", subjects(["I1"]));
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: 1878, birthYearTo: 1884 }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: 1854, birthYearTo: undefined }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: undefined, birthYearTo: 1852 }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: undefined, birthYearTo: 1830 }))).toBeNull();
      expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", givenName: "Ann", birthYearTo: 1830 })).not.toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: 1853, birthYearTo: 1853 }))).not.toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann", birthYearFrom: 1840, birthYearTo: undefined }))).not.toBeNull();
    });

    it("is not judged for a subject the tree gives no birth year", async () => {
      await bornIn(null);
      await seed([ANTOINE], "I1", subjects(["I1"]));
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann" }))).toBeNull();
    });

    it("is judged as a search for the project subject whose given name it searches, and says so", async () => {
      await seed([ANTOINE], "I1", subjects(["I1"]));
      const refusal = await candidateExclusionRefusal(bare({ givenName: "Ann" }));
      expect(refusal).toContain("an earlier search for I1 already returned: Antoine Tyler");
      expect(refusal).toContain("This call names no subjectId; its range includes I1's tree birth year");
      expect(await candidateExclusionRefusal(bare({ givenNameAlt: "Antone" }))).not.toBeNull();
      expect(await excludedCandidates(bare({ givenName: "Ann" }))).toEqual([
        { subjectId: "I1", recordId: ANTOINE.recordId, personName: "Antoine Tyler", birthYear: 1833, logId: "log_001" },
      ]);
    });

    it("is not judged with no given name, under a name no subject holds, or as a search for a child", async () => {
      await seed([ANTOINE], "I1", subjects(["I1"]));
      expect(await candidateExclusionRefusal(bare())).toBeNull();
      expect(await candidateExclusionRefusal(bare({ surname: "Tyler" }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Margaret" }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ motherGivenName: "Ann" }))).toBeNull();
    });

    it("is not judged when the project names no subject, or only subjects whose candidates it is not", async () => {
      for (const ids of [undefined, null, [], ["I2"], ["I9"]]) {
        await seed([ANTOINE], "I1", subjects(ids));
        expect(await candidateExclusionRefusal(bare({ givenName: "Ann" })), JSON.stringify(ids)).toBeNull();
      }
    });

    it("is judged only for the subject of several whose tree birth year its range includes", async () => {
      const t: any = tree();
      t.persons[0].facts = [{ id: "F1", type: "Birth", date: "Apr 1853" }];
      t.persons[1].facts = [{ id: "F2", type: "Birth", date: "1820" }];
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", t);
      await seed([ANTOINE], "I1", subjects(["I2", "I1"]));
      expect((await excludedCandidates(bare({ givenName: "Ann" }))).map((c) => c.subjectId)).toEqual(["I1"]);
      expect(await excludedCandidates(bare({ givenName: "Margaret" }))).toEqual([]);
    });

    it("on a tree holding I1 only as 'Ann', is judged under the candidate's own spelling too", async () => {
      const t: any = tree(["Ann"]);
      t.persons[0].facts = [{ id: "F1", type: "Birth", date: "Apr 1853" }];
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", t);
      await seed([ANTOINE], "I1", subjects(["I1"]));
      expect(await candidateExclusionRefusal(bare({ givenName: "Antoine" }))).not.toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Antoinette" }))).not.toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Margaret" }))).toBeNull();
      expect(await candidateExclusionRefusal(bare({ givenName: "Antoine", birthYearFrom: 1878, birthYearTo: 1884 }))).toBeNull();
    });

    it("reads the subject's birth year from any birth-like fact that has one", async () => {
      const facts = async (fs: unknown[]) => {
        const t: any = tree();
        t.persons[0].facts = fs;
        await getProjectStore().writeJson(dir, "tree.gedcomx.json", t);
      };
      await seed([ANTOINE], "I1", subjects(["I1"]));
      await facts([{ id: "F1", type: "Birth" }, { id: "F2", type: "Christening", date: "1853" }]);
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann" }))).not.toBeNull();
      await facts([{ id: "F1", type: "Birth", date: "1833" }, { id: "F2", type: "Birth", date: "Apr 1853" }]);
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann" }))).not.toBeNull();
      await facts([{ id: "F1", type: "Residence", date: "1853" }]);
      expect(await candidateExclusionRefusal(bare({ givenName: "Ann" }))).toBeNull();
    });
  });

  it("allows the range when the earlier search was for another subject, or named none", async () => {
    await seed([ANTOINE], "I2");
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE], null);
    expect(await excludedCandidates(ranged())).toEqual([]);
  });

  it("allows narrowing a long page: its rows are a pool, not candidates", async () => {
    const pool = Array.from({ length: CANDIDATE_PAGE_MAX + 1 }, (_, i) => ({
      ...ANTOINE,
      recordId: `ark:/61903/1:1:POOL-${i}`,
    }));
    await seed(pool);
    expect(await excludedCandidates(ranged())).toEqual([]);
  });

  it("allows narrowing a short page of a long result: totalMatches above the cap is a pool", async () => {
    await seed([ANTOINE], "I1", {}, {}, { totalMatches: CANDIDATE_PAGE_MAX + 1 });
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE], "I1", {}, {}, { totalMatches: CANDIDATE_PAGE_MAX });
    expect(await excludedCandidates(ranged())).toHaveLength(1);
  });

  it("finds no candidates in a search logged negative", async () => {
    await seed([ANTOINE], "I1", {}, {}, { outcome: "negative" });
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE], "I1", {}, {}, { outcome: "partial" });
    expect(await excludedCandidates(ranged())).toHaveLength(1);
  });

  it("allows the range once the researcher rejected that record for the subject, not for someone else", async () => {
    const assertions = [{ id: "a_1", record_id: "https://familysearch.org/ark:/61903/1:1:MFLB-F5N" }];
    await seed([ANTOINE], "I1", {
      assertions,
      rejected_links: [{ id: "rj_1", assertion_id: "a_1", person_id: "I1", created: "2026-11-23" }],
    });
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE], "I1", {
      assertions,
      rejected_links: [{ id: "rj_1", assertion_id: "a_1", person_id: "I2", created: "2026-11-23" }],
    });
    expect(await excludedCandidates(ranged())).toHaveLength(1);
  });

  it("allows the range once the record is recorded as a namesake of the subject, not of someone else", async () => {
    const namesake = (person_id: string) => ({
      namesakes: [
        { id: "ns_001", person_id, name: "Antoine Tyler", place: "Fluvanna", record_ids: ["ark:/61903/1:1:MFLB-F5N"], created: "2026-11-23" },
      ],
    });
    await seed([ANTOINE], "I1", namesake("I1"));
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE], "I1", namesake("I2"));
    expect(await excludedCandidates(ranged())).toHaveLength(1);
  });

  it("ignores a row with no birth date, and allows the search when there is no project or no subject", async () => {
    await seed([{ ...ANTOINE, birthDate: undefined }]);
    expect(await excludedCandidates(ranged())).toEqual([]);
    expect(await excludedCandidates(ranged({ projectPath: join(dir, "nope") }))).toEqual([]);
    expect(await excludedCandidates({ projectPath: dir, birthYearFrom: 1848 })).toEqual([]);
  });

  it("allows the call when a logged sidecar is missing, or the tree cannot be read", async () => {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001")]));
    expect(await excludedCandidates(ranged())).toEqual([]);
    await seed([ANTOINE]);
    expect(await excludedCandidates(ranged())).toHaveLength(1);
    await rm(join(dir, "tree.gedcomx.json"));
    expect(await excludedCandidates(ranged())).toEqual([]);
  });

  it("lists a candidate once though two logged searches returned it", async () => {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001"), logEntry("log_002")]));
    await getProjectStore().writeJson(dir, "results/log_001.json", sidecar("log_001", "I1", [ANTOINE]));
    await getProjectStore().writeJson(dir, "results/log_002.json", sidecar("log_002", "I1", [ANTOINE]));
    const excluded = await excludedCandidates(ranged());
    expect(excluded.map((c) => c.logId)).toEqual(["log_001"]);
  });

  describe("the earlier search must have been for the subject, and the row a hit for its given name", () => {
    it("a wildcard the row's given name matches makes it a candidate (An* -> Antoine)", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: "An*" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    it("a prefix and a full reading each make it one (Ant, Antone -> Antoine)", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: "Ant" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
      await seed([ANTOINE], "I1", {}, { givenName: "Antone" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    it("a spelling variant matches by prefix and by Dice alone (Hermann -> Herman, Hrmann)", async () => {
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", tree(["Hermann"]));
      await seed([{ ...ANTOINE, personName: "Herman Goetjen" }], "I1", {}, { givenName: "Hermann" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
      await seed([{ ...ANTOINE, personName: "Hrmann Goetjen" }], "I1", {}, { givenName: "Hermann" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    it("a row whose given name is not the one searched is not a candidate (An* -> Margaret)", async () => {
      await seed([{ ...ANTOINE, personName: "Margaret Tyler" }], "I1", {}, { givenName: "An*" });
      expect(await excludedCandidates(ranged())).toEqual([]);
    });

    it("givenNameAlt counts too", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: "Mary", givenNameAlt: "Antoine" });
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    it("rows of a search for someone else under the subject's id are not candidates (Amelia -> Louis, Edward)", async () => {
      await seed(
        [
          { ...ANTOINE, recordId: "ark:/61903/1:1:M66G-SLL", personName: "Louis A. Grotjan", birthDate: "1876" },
          { ...ANTOINE, recordId: "ark:/61903/1:1:M66G-4BJ", personName: "Edward A. Grotjan", birthDate: "1854" },
        ],
        "I1",
        {},
        { givenName: "Amelia" },
      );
      expect(await excludedCandidates(ranged({ birthYearFrom: 1880 }))).toEqual([]);
    });

    it("rows of a surname-only search are not candidates: it swept households, not the subject", async () => {
      await seed([ANTOINE], "I1", {}, { givenName: undefined });
      expect(await excludedCandidates(ranged())).toEqual([]);
    });

    it("a subject the tree does not hold, or holds with no given name, allows the call", async () => {
      await seed([ANTOINE]);
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", { persons: [], relationships: [], sources: [] });
      expect(await excludedCandidates(ranged())).toEqual([]);
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", tree([""]));
      expect(await excludedCandidates(ranged())).toEqual([]);
    });
  });

  describe("the call judged must be a search for the subject", () => {
    it("refuses a search under one of the subject's given names, or none", async () => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Ann" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "Antone" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "Joseph", givenNameAlt: "Ann" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    it("allows a search for someone else under the subject's id (a parent)", async () => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Joseph", birthYearFrom: 1800, birthYearTo: 1815 }))).toEqual([]);
    });

    it("finds the subject by id, and reads each word of her given name (I1 after I2, 'Ann Tone')", async () => {
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", {
        persons: [
          { id: "I2", names: [{ id: "N9", given: "Margaret", surname: "Tyler", type: "BirthName" }], facts: [] },
          { id: "I1", names: [{ id: "N1", given: "Ann Tone", surname: "Tyler", type: "BirthName" }], facts: [] },
        ],
        relationships: [],
        sources: [],
      });
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Tone" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "Margaret" }))).toEqual([]);
    });
  });

  describe("a search for the subject's child, by a parent's name, is not judged", () => {
    it.each([
      ["motherGivenName", "Ann"],
      ["motherSurname", "Tyler"],
      ["fatherGivenName", "Joseph"],
      ["fatherSurname", "Tyler"],
      ["parentGivenName", "Ann"],
      ["parentSurname", "Tyler"],
    ])("allows a call with no given name and %s", async (key, value) => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ [key]: value, birthYearFrom: 1870, birthYearTo: 1890 }))).toEqual([]);
    });

    it("still refuses a call that also names the subject, a blank parent name, or a spouse or household member", async () => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Ann", motherGivenName: "Lucy" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ motherGivenName: "  " }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ spouseGivenName: "Joseph" } as any))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ otherGivenName: "Margaret" } as any))).toHaveLength(1);
    });
  });

  describe("a call under the candidate's own spelling is bound by that candidate", () => {
    beforeEach(async () => {
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", tree(["Ann"]));
    });

    it("on a tree holding only 'Ann', 'Antoine' and 'Antoinette' are refused and 'Margaret' is allowed", async () => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Antoine" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "Antoinette" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "Margaret" }))).toEqual([]);
    });
  });

  describe("an initial in the subject's tree name matches only an initial", () => {
    beforeEach(async () => {
      await getProjectStore().writeJson(dir, "tree.gedcomx.json", tree(["Ann E"]));
    });

    it("on 'Ann E', a search for Edwin is allowed, while 'Ann' and 'E' are refused", async () => {
      await seed([ANTOINE]);
      expect(await excludedCandidates(ranged({ givenName: "Edwin" }))).toEqual([]);
      expect(await excludedCandidates(ranged({ givenName: "Ann" }))).toHaveLength(1);
      expect(await excludedCandidates(ranged({ givenName: "E" }))).toHaveLength(1);
    });

    it("a logged search for Edwin under her id finds no candidate for her", async () => {
      await seed([{ ...ANTOINE, personName: "Edwin Tyler" }], "I1", {}, { givenName: "Edwin" });
      expect(await excludedCandidates(ranged())).toEqual([]);
    });
  });

  it("an unreadable sidecar is skipped and the rest are judged", async () => {
    await getProjectStore().writeJson(dir, "research.json", research([logEntry("log_001"), logEntry("log_002")]));
    await getProjectStore().writeJson(dir, "results/log_002.json", sidecar("log_002", "I1", [ANTOINE]));
    const excluded = await excludedCandidates(ranged());
    expect(excluded.map((c) => c.logId)).toEqual(["log_002"]);
  });

  describe("a record linked confident to another person is not a candidate", () => {
    const linked = (person_id: string, confidence: string, extra: Record<string, unknown> = {}) => ({
      assertions: [{ id: "a_1", record_id: "https://familysearch.org/ark:/61903/1:1:MFLB-F5N" }],
      person_evidence: [{ id: "pe_1", assertion_id: "a_1", person_id, confidence, ...extra }],
    });

    it("a confident link to I2 releases the row", async () => {
      await seed([ANTOINE], "I1", linked("I2", "confident"));
      expect(await excludedCandidates(ranged())).toEqual([]);
    });

    it("a probable link to I2, a superseded confident one, or a confident link to I1 does not", async () => {
      await seed([ANTOINE], "I1", linked("I2", "probable"));
      expect(await excludedCandidates(ranged())).toHaveLength(1);
      await seed([ANTOINE], "I1", linked("I2", "confident", { superseded_by: "pe_2" }));
      expect(await excludedCandidates(ranged())).toHaveLength(1);
      await seed([ANTOINE], "I1", linked("I1", "confident"));
      expect(await excludedCandidates(ranged())).toHaveLength(1);
    });

    describe("only a link of the candidate's own entry in the record releases it", () => {
      const REC = "https://familysearch.org/ark:/61903/1:1:MFLB-F5N";
      const household = (linkedId: string, persona = true) => ({
        assertions: [
          { id: "a_h", record_id: REC, record_role: "head_of_household", fact_type: "name", value: "Antoine Tyler", ...(persona ? { record_persona_id: "p_1" } : {}) },
          { id: "a_hb", record_id: REC, record_role: "head_of_household", fact_type: "birth", value: "1833", ...(persona ? { record_persona_id: "p_1" } : {}) },
          { id: "a_c", record_id: REC, record_role: "child_1", fact_type: "name", value: "Joseph Tyler", ...(persona ? { record_persona_id: "p_2" } : {}) },
        ],
        person_evidence: [{ id: "pe_1", assertion_id: linkedId, person_id: "I7", confidence: "confident" }],
      });

      it("a household member's confident link to I7 does not release the head, by persona or by role", async () => {
        await seed([ANTOINE], "I1", household("a_c"));
        expect(await excludedCandidates(ranged())).toHaveLength(1);
        await seed([ANTOINE], "I1", household("a_c", false));
        expect(await excludedCandidates(ranged())).toHaveLength(1);
      });

      it("a confident link of any of the head's own assertions does", async () => {
        await seed([ANTOINE], "I1", household("a_h"));
        expect(await excludedCandidates(ranged())).toEqual([]);
        await seed([ANTOINE], "I1", household("a_hb"));
        expect(await excludedCandidates(ranged())).toEqual([]);
        await seed([ANTOINE], "I1", household("a_hb", false));
        expect(await excludedCandidates(ranged())).toEqual([]);
      });

      it("a rejected link of a household member does not release the head either", async () => {
        const extra: any = household("a_c");
        extra.person_evidence = [];
        extra.rejected_links = [{ id: "rj_1", assertion_id: "a_c", person_id: "I1", created: "2026-11-26" }];
        await seed([ANTOINE], "I1", extra);
        expect(await excludedCandidates(ranged())).toHaveLength(1);
        extra.rejected_links[0].assertion_id = "a_h";
        await seed([ANTOINE], "I1", extra);
        expect(await excludedCandidates(ranged())).toEqual([]);
      });
    });
  });
});
