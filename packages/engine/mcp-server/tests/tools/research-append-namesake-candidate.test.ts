import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../../src/tools/research-append.js";
import { getProjectStore } from "../../src/store/project-store.js";
import { readProjectJson } from "../../src/utils/project-io.js";
import { candidateExclusionRefusal, namesakeCandidateRefusals } from "../../src/utils/candidate-exclusion.js";

// Issue #4580: a namesake row may not drop a candidate a search for its person
// returned on nothing but the candidate's birth year. The project is the real
// ut_search_records_035 scenario, whose log_001 returned Antoine Tyler (b. 1833)
// for I1 (b. 1853).

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/tyler-fluvanna-midwife-1870-candidate");
const FILES = ["research.json", "tree.gedcomx.json", "results/log_001.json"];

/** A fresh project holding the scenario, written through the project store. */
async function seedScenario(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  for (const f of FILES) {
    await getProjectStore().writeJson(dir, f, JSON.parse(await readFile(join(SCENARIO, f), "utf-8")));
  }
  return dir;
}
const ANTOINE = "ark:/61903/1:1:MFLB-F5N";

const row = (person_id: string, record_ids: string[]) => ({
  person_id,
  name: "Antoine Tyler",
  place: "Cunningham, Fluvanna, Virginia",
  time_period: "1870",
  record_ids,
  log_entry_ids: ["log_001"],
  notes: "Born 1833, twenty years before the subject.",
});

describe("research_append: a namesake row may not name a candidate on its birth year alone (#4580)", () => {
  let dir: string;
  const errs = (r: any) => (r.ok ? "" : JSON.stringify(r.errors));
  const readResearch = () => readProjectJson(dir, "research.json");

  beforeEach(async () => {
    dir = await seedScenario("ns-candidate-");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a row for I1 naming Antoine, writes nothing, and leaves the range refusal standing", async () => {
    const r = await researchAppend({ projectPath: dir, section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned: Antoine Tyler \(ark:\/61903\/1:1:MFLB-F5N\), born 1833, from log_001/);
    expect(errs(r)).toMatch(/needs-review/);
    expect((await readResearch()).namesakes ?? []).toEqual([]);
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848, birthYearTo: 1858 })).not.toBeNull();
  });

  it("refuses the same row in a batch beside an op that would succeed", async () => {
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_002", fields: { status: "in_progress" } },
        { section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned/);
  });

  it("names the row among every failure when another op of the batch fails too", async () => {
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_999", fields: { status: "in_progress" } },
        { section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/pli_999/);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned/);
  });

  it("does not re-judge a standing row that already names Antoine when only its notes change", async () => {
    const research: any = await readResearch();
    research.namesakes = [{ id: "ns_001", ...row("I1", [ANTOINE]), created: "2026-11-25" }];
    await getProjectStore().writeJson(dir, "research.json", research);
    const r = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { notes: "reworded" },
    } as any);
    expect(r.ok, errs(r)).toBe(true);
  });

  it("allows a row naming a record that is not a candidate", async () => {
    const other = await researchAppend({
      projectPath: dir, section: "namesakes", op: "append", entry: row("I1", ["ark:/61903/1:1:ZZZZ-999"]),
    } as any);
    expect(other.ok, errs(other)).toBe(true);
  });

  it("refuses an update that adds Antoine to a row's record_ids, and allows one that changes only notes", async () => {
    const first = await researchAppend({
      projectPath: dir, section: "namesakes", op: "append", entry: row("I1", ["ark:/61903/1:1:ZZZZ-999"]),
    } as any);
    expect(first.ok, errs(first)).toBe(true);
    const add = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { record_ids: ["ark:/61903/1:1:ZZZZ-999", ANTOINE] },
    } as any);
    expect(add.ok).toBe(false);
    expect(errs(add)).toMatch(/names a candidate/);
    const notes = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { notes: "reworded" },
    } as any);
    expect(notes.ok, errs(notes)).toBe(true);
  });
});

describe("namesakeCandidateRefusals: when a row may name a candidate", () => {
  let dir: string;
  let research: any;
  let tree: any;

  beforeEach(async () => {
    dir = await seedScenario("ns-candidate-unit-");
    research = await readProjectJson(dir, "research.json");
    tree = await readProjectJson(dir, "tree.gedcomx.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const judge = (after: any = research, r: any = row("I1", [ANTOINE])) =>
    namesakeCandidateRefusals(dir, research, after, tree, [{ opIndex: 0, row: r }]);

  /** Antoine's collection, the 1870 US census. */
  const CENSUS_1870 = "1438024";
  /** I1's own 1870 entry, found by a second, broad search (`log_002`). */
  const OWN_1870 = "ark:/61903/1:1:ABCD-123";
  /** I1's 1900 entry, found by a third search (`log_003`) in another collection. */
  const OWN_1900 = "ark:/61903/1:1:WXYZ-900";

  /** Logs a record_search for I1 as `id`, its sidecar holding one row of
   *  `recordId` in `collectionId` on a page too long to make it a candidate. */
  const logSearch = async (id: string, recordId: string, collectionId: string) => {
    await getProjectStore().writeJson(dir, `results/${id}.json`, {
      payload: {
        query: { surname: "Tyler", givenName: "Ann", collectionId, subjectId: "I1" },
        totalMatches: 40,
        results: [{ recordId, personName: "Ann Tyler", birthDate: "1853", collectionId }],
      },
    });
    return { id, tool: "record_search", results_ref: `results/${id}.json`, outcome: "positive" };
  };

  /** `research` with both searches logged and I1 linked at `confidence` to an
   *  assertion of `recordId`. */
  const linked = async (recordId: string, confidence: string, extra: Record<string, unknown> = {}) => ({
    ...research,
    log: [
      ...(research.log ?? []),
      await logSearch("log_002", OWN_1870, CENSUS_1870),
      await logSearch("log_003", OWN_1900, "1325221"),
    ],
    assertions: [{ id: "a_001", record_id: recordId }],
    person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence, ...extra }],
  });

  it("refuses a row naming Antoine by her bare id too", async () => {
    expect(await judge()).toHaveLength(1);
    expect(await judge(research, row("I1", ["MFLB-F5N"]))).toHaveLength(1);
  });

  it("allows it once I1 is linked probable or confident to her own entry in the same census", async () => {
    expect(await judge(await linked(OWN_1870, "probable"))).toEqual([]);
    expect(await judge(await linked(OWN_1870, "confident"))).toEqual([]);
  });

  it("a link to a record of another collection, or one no logged search returned, does not", async () => {
    expect(await judge(await linked(OWN_1900, "probable"))).toHaveLength(1);
    expect(await judge(await linked("ark:/61903/1:1:NONE-000", "confident"))).toHaveLength(1);
  });

  it("a speculative or superseded link in the same census, or any link to Antoine's own record, does not", async () => {
    expect(await judge(await linked(OWN_1870, "speculative"))).toHaveLength(1);
    expect(await judge(await linked(OWN_1870, "confident", { superseded_by: "pe_002" }))).toHaveLength(1);
    expect(await judge(await linked(ANTOINE, "confident"))).toHaveLength(1);
  });

  describe("the parents Antoine's own record names", () => {
    /** Gives Antoine's row a record naming `fatherGiven` as her father, and
     *  I1 a tree father `treeFatherGiven` (none when null). */
    const withParents = async (fatherGiven: string | null, treeFatherGiven: string | null) => {
      const s: any = await readProjectJson(dir, "results/log_001.json");
      const r0 = s.payload.results[0];
      if (fatherGiven === null) {
        delete r0.gedcomx;
        delete r0.primaryId;
      } else {
        r0.primaryId = "p1";
        r0.gedcomx = {
          persons: [
            { id: "p1", names: [{ given: "Antoine", surname: "Tyler" }] },
            { id: "p2", names: [{ given: fatherGiven, surname: "Tyler" }] },
          ],
          relationships: [{ type: "ParentChild", parent: "p2", child: "p1" }],
        };
      }
      await getProjectStore().writeJson(dir, "results/log_001.json", s);
      tree = structuredClone(tree);
      tree.persons = tree.persons.filter((p: any) => p.id !== "F1");
      tree.relationships = (tree.relationships ?? []).filter((r: any) => r.parent !== "F1");
      if (treeFatherGiven !== null) {
        tree.persons.push({ id: "F1", names: [{ given: treeFatherGiven, surname: "Tyler" }] });
        tree.relationships.push({ type: "ParentChild", parent: "F1", child: "I1" });
      }
    };

    it("allows the row when her record names a father unrelated to I1's tree father", async () => {
      await withParents("Michael", "William");
      expect(await judge()).toEqual([]);
    });

    it("refuses it when her record names I1's tree father, or a nickname of him", async () => {
      await withParents("William", "William");
      expect(await judge()).toHaveLength(1);
      await withParents("Bill", "William");
      expect(await judge()).toHaveLength(1);
    });

    it("refuses it when her row carries no record, or I1 has no tree parent", async () => {
      await withParents(null, "William");
      expect(await judge()).toHaveLength(1);
      await withParents("Michael", null);
      expect(await judge()).toHaveLength(1);
    });

    /** Gives Antoine's record the parents `rec` and I1 the tree parents `treeP`,
     *  each as [given, gender]. With `childOther`, the record also gives her a
     *  child and that child's father, unrelated to anyone. */
    const withGendered = async (rec: [string, string][], treeP: [string, string][], childOther = false) => {
      const s: any = await readProjectJson(dir, "results/log_001.json");
      const r0 = s.payload.results[0];
      r0.primaryId = "p1";
      const persons: any[] = [{ id: "p1", gender: "Female", names: [{ given: "Antoine", surname: "Tyler" }] }];
      const relationships: any[] = [];
      rec.forEach(([given, gender], i) => {
        persons.push({ id: `rp${i}`, gender, names: [{ given, surname: "Tyler" }] });
        relationships.push({ type: "ParentChild", parent: `rp${i}`, child: "p1" });
      });
      if (childOther) {
        persons.push({ id: "kid", gender: "Male", names: [{ given: "Joseph", surname: "Tyler" }] });
        persons.push({ id: "kdad", gender: "Male", names: [{ given: "Zebulon", surname: "Tyler" }] });
        relationships.push({ type: "ParentChild", parent: "p1", child: "kid" });
        relationships.push({ type: "ParentChild", parent: "kdad", child: "kid" });
      }
      r0.gedcomx = { persons, relationships };
      await getProjectStore().writeJson(dir, "results/log_001.json", s);
      tree = structuredClone(tree);
      tree.persons = tree.persons.filter((p: any) => !String(p.id).startsWith("TP"));
      tree.relationships = (tree.relationships ?? []).filter((r: any) => !String(r.parent).startsWith("TP"));
      treeP.forEach(([given, gender], i) => {
        tree.persons.push({ id: `TP${i}`, gender, names: [{ given, surname: "Tyler" }] });
        tree.relationships.push({ type: "ParentChild", parent: `TP${i}`, child: "I1" });
      });
    };

    it("compares a record mother only with tree mothers: Job and Bridget, or Bridget alone, against a tree father Job", async () => {
      await withGendered([["Job", "Male"], ["Bridget", "Female"]], [["Job", "Male"]]);
      expect(await judge()).toHaveLength(1);
      await withGendered([["Bridget", "Female"]], [["Job", "Male"]]);
      expect(await judge()).toHaveLength(1);
    });

    it("allows Michael and Mary against tree parents Thomas and Mary, and Michael against Thomas", async () => {
      await withGendered([["Michael", "Male"], ["Mary", "Female"]], [["Thomas", "Male"], ["Mary", "Female"]]);
      expect(await judge()).toEqual([]);
      await withGendered([["Michael", "Male"]], [["Thomas", "Male"]]);
      expect(await judge()).toEqual([]);
    });

    it("reads only the principal's own parents, not those of a child the record gives her", async () => {
      await withGendered([["Job", "Male"]], [["Job", "Male"]], true);
      expect(await judge()).toHaveLength(1);
    });
  });

  describe("the subject's role in the other record of the same collection", () => {
    /** `research` with I1 linked probable to an assertion of OWN_1870 in `role`. */
    const linkedAs = async (role: string) => {
      const r: any = await linked(OWN_1870, "probable");
      r.assertions = [{ id: "a_001", record_id: OWN_1870, record_role: role }];
      return r;
    };

    it.each(["head_of_household", "wife", "child_2", "grandmother"])("an entry of her own (%s) releases the row", async (role) => {
      expect(await judge(await linkedAs(role))).toEqual([]);
    });

    it.each(["mother", "Father", "informant", "witness_1", "mother_of_groom"])(
      "a link naming her as %s of another person's record does not",
      async (role) => {
        expect(await judge(await linkedAs(role))).toHaveLength(1);
      },
    );
  });

  it("allows it when the candidate's birth date is a full day-month-year date", async () => {
    const s: any = await readProjectJson(dir, "results/log_001.json");
    s.payload.results[0].birthDate = "12 March 1833";
    await getProjectStore().writeJson(dir, "results/log_001.json", s);
    expect(await judge()).toEqual([]);
    s.payload.results[0].birthDate = "March 1833";
    await getProjectStore().writeJson(dir, "results/log_001.json", s);
    expect(await judge()).toHaveLength(1);
  });

  it("allows it when her indexed birthplace names another state or country than I1's tree birth", async () => {
    const s: any = await readProjectJson(dir, "results/log_001.json");
    const birthPlace = async (place: string) => {
      s.payload.results[0].birthPlace = place;
      await getProjectStore().writeJson(dir, "results/log_001.json", s);
    };
    tree = structuredClone(tree);
    const i1 = tree.persons.find((p: any) => p.id === "I1");
    i1.facts = [...(i1.facts ?? []).filter((f: any) => f.type !== "Birth"), { id: "Fb", type: "Birth", date: "Apr 1853", place: "Fluvanna, Virginia, United States" }];
    await birthPlace("New York, United States");
    expect(await judge()).toEqual([]);
    await birthPlace("Ireland");
    expect(await judge()).toEqual([]);
    await birthPlace("Virginia, United States");
    expect(await judge()).toHaveLength(1);
    i1.facts = i1.facts.filter((f: any) => f.type !== "Birth");
    await birthPlace("New York, United States");
    expect(await judge()).toHaveLength(1);
  });

  it("allows a row for another person: Antoine is I1's candidate, not I2's", async () => {
    expect(await judge(research, row("I2", [ANTOINE]))).toEqual([]);
  });
});
