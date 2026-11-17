import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { materializeFacts } from "../../src/tools/materialize-facts.js";
import { LINK_REVIEW_NOISE_TYPES, introducedByLink, warningsIfLinked, warningSentence } from "../../src/utils/persona-copy.js";
import { writeProjectFile } from "../helpers/project-files.js";

// `warningsIfLinked` answers, before a link exists, what `materialize_facts`
// will refuse once it does. These tests hold the two to the same answer.

const REC = "https://www.familysearch.org/ark:/61903/1:1:CENS-1880";

function assertion(id: string, over: Record<string, unknown>) {
  return {
    id,
    source_id: "src_001",
    record_id: REC,
    record_role: "head",
    record_persona_id: null,
    value: "",
    date: null,
    place: null,
    standard_place: null,
    information_quality: "primary",
    informant: "unknown",
    informant_proximity: "official_duty",
    record_basis: "stated",
    extracted_for_question_ids: [],
    ...over,
  };
}

function research(links: any[] = []) {
  return {
    project: {
      id: "rp_001", objective: "Test", status: "active",
      created: "2026-01-01", updated: "2026-01-01", subject_person_ids: ["I1"],
    },
    questions: [], plans: [], log: [],
    sources: [{
      id: "src_001", gedcomx_source_description_id: "S1", citation: "1880 census",
      citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
      source_classification: "original", repository: "Test Repository", access_date: "2026-01-01",
    }],
    assertions: [
      assertion("a_001", { fact_type: "name", value: "John Smith" }),
      assertion("a_002", { fact_type: "residence", value: "Boston", date: "1880", place: "Boston, Massachusetts" }),
      assertion("a_003", { record_role: "wife", fact_type: "name", value: "Ann Smith" }),
    ],
    person_evidence: links,
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

function tree(johnFacts: any[]) {
  return {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }], facts: johnFacts },
    ],
    relationships: [],
    sources: [{ id: "S1", title: "1880 census" }],
  };
}

const DIED_1850 = [
  { id: "F1", type: "Birth", date: "1820" },
  { id: "F2", type: "Death", date: "1850" },
];
const LINK = {
  id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "confident",
  rationale: "test", match_score: 0.9, core_identifier_conflict: null, superseded_by: null,
};

describe("warningsIfLinked", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "warnings-if-linked-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const put = (name: string, doc: unknown) => writeProjectFile(join(dir, name), JSON.stringify(doc));

  it("lists, with no link, exactly what materialize_facts refuses once the link stands", async () => {
    const t = tree(DIED_1850);
    // The warnings the save refuses are a subset of the list: it also carries
    // the ones the save allows.
    const before = introducedByLink(research(), t, REC, "head", "I1")
      .filter((w) => w.refusedAtSave)
      .map((w) => w.sentence.replace(/ (Impossible|Implausible); refused at save\..*$/, ""));
    expect(before.length).toBeGreaterThan(0);

    await put("research.json", research([LINK]));
    await put("tree.gedcomx.json", t);
    const refused: any = await materializeFacts({ projectPath: dir, personId: "I1", recordId: REC, recordRole: "head" });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("unjustified_warnings");
    expect(refused.warnings.map(warningSentence)).toEqual(before);
  });

  describe("the tree fact a warning depends on", () => {
    const REC2 = "https://www.familysearch.org/ark:/61903/1:1:BUR-1850";
    const REC3 = "https://www.familysearch.org/ark:/61903/1:1:INT-1850";
    const deathFrom = (refs: string[]) => [
      { id: "F1", type: "Birth", date: "1820" },
      { id: "F2", type: "Death", date: "1850", sources: refs.map((ref) => ({ ref })) },
    ];
    /** research() plus the death's own records and their links to I1. */
    const backed = (records: Array<[string, string, string]>, links: any[]) => {
      const r = research(links);
      for (const [src, sdid, rec] of records) {
        r.sources.push({ ...r.sources[0], id: src, gedcomx_source_description_id: sdid });
        r.assertions.push(assertion(`a_${src}`, { source_id: src, record_id: rec, record_role: "deceased", fact_type: "death", date: "1850" }));
      }
      return r;
    };
    const backedTree = (refs: string[]) => {
      const t = tree(deathFrom(refs));
      for (const ref of refs) t.sources.push({ id: ref, title: `Record ${ref}` });
      return t;
    };
    const link = (id: string, src: string, confidence: string, over: Record<string, unknown> = {}) => ({
      ...LINK, id, assertion_id: `a_${src}`, confidence, ...over,
    });

    /** A starting tree that held John with `facts`: the project began with them. */
    const startedWith = (facts: any[]) => tree(facts);
    const BORN = [{ id: "F1", type: "Birth", date: "1820" }];

    it("names it, marks the warning refused at save, and takes an unlinked fact as the tree's when no starting tree is on file", () => {
      const [s] = warningsIfLinked(research(), tree(DIED_1850), REC, "head", "I1");
      expect(s).toContain(
        "Impossible; refused at save. It depends on the record's Residence of 1880; and on the tree's Death of 1850 (F2), which came with the tree.",
      );
      expect(s).not.toContain("F1");
    });

    it("says a fact the starting tree held came with the tree, whatever links it has gained", () => {
      const r = backed([["src_002", "S2", REC2]], [link("pe_010", "src_002", "probable")]);
      const t = backedTree(["S2"]);
      const [s] = warningsIfLinked(r, t, REC, "head", "I1", startedWith(deathFrom(["S2"])));
      expect(s).toContain("(F2), which came with the tree.");
      expect(s).not.toContain("pe_010");
    });

    it("says one record backs a fact this project added, and at what tier", () => {
      const r = backed([["src_002", "S2", REC2]], [link("pe_010", "src_002", "probable")]);
      const [s] = warningsIfLinked(r, backedTree(["S2"]), REC, "head", "I1", startedWith(BORN));
      expect(s).toContain("(F2), which this project added: 1 record backs it, linked probable (pe_010).");
    });

    it("counts records, not links, and lists every tier", () => {
      const r = backed(
        [["src_002", "S2", REC2], ["src_003", "S3", REC3]],
        [link("pe_010", "src_002", "confident"), link("pe_011", "src_003", "probable")],
      );
      const [s] = warningsIfLinked(r, backedTree(["S2", "S3"]), REC, "head", "I1", startedWith(BORN));
      expect(s).toContain("(F2), which this project added: 2 records back it, linked confident and probable (pe_010, pe_011).");
    });

    it("does not count a superseded link, or a link to someone else", () => {
      const r = backed(
        [["src_002", "S2", REC2]],
        [link("pe_010", "src_002", "confident", { superseded_by: "pe_012" }), link("pe_011", "src_002", "confident", { person_id: "I9" })],
      );
      const [s] = warningsIfLinked(r, backedTree(["S2"]), REC, "head", "I1", startedWith(BORN));
      expect(s).toContain("which this project added and no live link backs");
    });
  });

  describe("which warnings are listed", () => {
    /** research() plus one more assertion on the head. */
    const plus = (over: Record<string, unknown>) => {
      const r = research();
      r.assertions.push(assertion("a_009", over));
      return r;
    };
    const earlyResidence = () => plus({ fact_type: "residence", value: "York", date: "1810", place: "York" });
    const secondBirth = () => plus({ fact_type: "birth", value: "born 1823", date: "1823" });
    const types = (r: any, includeNoise = false) =>
      introducedByLink(r, tree(DIED_1850), REC, "head", "I1", null, includeNoise).map((w) => w.issueType);

    it("lists a warning the save allows, marked so", () => {
      const all = introducedByLink(earlyResidence(), tree(DIED_1850), REC, "head", "I1");
      const allowed = all.filter((w) => !w.refusedAtSave);
      expect(allowed.map((w) => w.issueType)).toContain("hasEventBeforeBirth365_2");
      expect(allowed.every((w) => w.sentence.includes("; allowed at save."))).toBe(true);
      expect(all.filter((w) => w.refusedAtSave).every((w) => w.sentence.includes("; refused at save."))).toBe(true);
    });

    it("marks each warning impossible or implausible, impossible first", () => {
      const all = introducedByLink(earlyResidence(), tree(DIED_1850), REC, "head", "I1");
      for (const w of all) expect(w.sentence).toContain(w.impossible ? " Impossible; " : " Implausible; ");
      const firstSoft = all.findIndex((w) => !w.impossible);
      if (firstSoft !== -1) expect(all.slice(firstSoft).some((w) => w.impossible)).toBe(false);
    });

    it("leaves out two birth dates that disagree: the birth comparison owns those", () => {
      expect(types(secondBirth(), true)).toContain("hasEventBeforeBirth365_2");
      expect(types(secondBirth())).not.toContain("hasEventBeforeBirth365_2");
      expect(types(secondBirth())).not.toContain("tooManyBirthDates2");
    });

    it("leaves the noise types out unless asked for them", () => {
      for (const r of [earlyResidence(), secondBirth()]) {
        const listed = types(r);
        for (const t of listed) expect(LINK_REVIEW_NOISE_TYPES.has(t)).toBe(false);
        for (const t of listed) expect(types(r, true)).toContain(t);
      }
    });

    it("lists a sentence once", () => {
      const sentences = warningsIfLinked(earlyResidence(), tree(DIED_1850), REC, "head", "I1");
      expect(new Set(sentences).size).toBe(sentences.length);
    });
  });

  it("is empty when materialize_facts accepts the copy", async () => {
    const t = tree([{ id: "F1", type: "Birth", date: "1820" }]);
    expect(warningsIfLinked(research(), t, REC, "head", "I1")).toEqual([]);

    await put("research.json", research([LINK]));
    await put("tree.gedcomx.json", t);
    const ok: any = await materializeFacts({ projectPath: dir, personId: "I1", recordId: REC, recordRole: "head" });
    expect(ok.ok).toBe(true);
  });

  it("does not change the tree or the research it is handed", () => {
    const t = tree(DIED_1850);
    const r = research();
    const [tBefore, rBefore] = [structuredClone(t), structuredClone(r)];
    warningsIfLinked(r, t, REC, "head", "I1");
    expect(t).toEqual(tBefore);
    expect(r).toEqual(rBefore);
  });

  it("is empty once the record's facts are already on the person", async () => {
    await put("research.json", research([LINK]));
    await put("tree.gedcomx.json", tree([{ id: "F1", type: "Birth", date: "1820" }]));
    await materializeFacts({ projectPath: dir, personId: "I1", recordId: REC, recordRole: "head" });
    const { readFile } = await import("fs/promises");
    const after = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf8"));
    expect(warningsIfLinked(research([LINK]), after, REC, "head", "I1")).toEqual([]);
  });

  it.each([
    ["a person not in the tree", REC, "head", "I9"],
    ["a role the record does not have", REC, "lodger", "I1"],
    ["a record with no assertions", "ark:/none", "head", "I1"],
    ["a missing role", REC, undefined, "I1"],
    ["a null person", REC, "head", null],
  ])("is empty, and does not throw, for %s", (_label, recordId, role, personId) => {
    expect(warningsIfLinked(research(), tree(DIED_1850), recordId, role, personId)).toEqual([]);
  });

  it("is empty, and does not throw, when the record's source has no tree entry", () => {
    const t = { ...tree(DIED_1850), sources: [] };
    expect(warningsIfLinked(research(), t, REC, "head", "I1")).toEqual([]);
  });

  it("reads only the named role's facts", () => {
    // The wife has no dated fact, so copying her onto John adds a name and no warning.
    expect(warningsIfLinked(research(), tree(DIED_1850), REC, "wife", "I1")).toEqual([]);
  });
});
