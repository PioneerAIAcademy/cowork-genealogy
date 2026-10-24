import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Offline: an appended assertion with a place would otherwise geocode live.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import {
  circularCorroborationVerdict,
  coPartyRelation,
  researchAppend,
  sameEntryOf,
} from "../../src/tools/research-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";

// Circular corroboration (issue #2943): a starting-tree person linked to a record
// whose own parent or spouse relationship the record alone sourced. End to end
// through `researchAppend`, in the shape of the reported session: William
// Latham's 1830 christening, indexed twice, attached to his parents' edges.

const W = "KWCB-100"; // William, the christened child
const J = "KWCB-200"; // John, his father
const H = "KWCB-300"; // Harriet, his mother
const X = "KWCB-400"; // a person the starting tree does not hold

const REC = {
  staff: "ark:/61903/1:1:QL3G-QSCB", // Staffordshire church records
  births: "ark:/61903/1:1:NGC7-L5Z", // England, Births and Christenings: the same baptism
  census: "ark:/61903/1:1:CEN1-001",
  sibling: "ark:/61903/1:1:SIB2-002",
  solo: "ark:/61903/1:1:SOL3-003",
};

function assertion(
  id: string,
  sourceId: string,
  recordId: string,
  role: string,
  factType: string,
  value: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    source_id: sourceId,
    record_id: recordId,
    record_role: role,
    fact_type: factType,
    value,
    information_quality: "primary",
    informant: "self",
    informant_proximity: "self",
    record_basis: "stated",
    extracted_for_question_ids: [],
    ...extra,
  };
}

function source(id: string, description: string) {
  return {
    id,
    gedcomx_source_description_id: description,
    citation: `Record ${id}`,
    citation_detail: {
      who: "Clerk",
      what: `Record ${id}`,
      when_created: "1830",
      when_accessed: "2026-10-23",
      where: "Staffordshire",
      where_within: "page 1",
    },
    source_classification: "original",
    repository: "FamilySearch",
    access_date: "2026-10-23",
  };
}

const LONGTON = "Longton, Staffordshire, England";
const BAPTISM = "20 March 1830";

/** The christening as one index extracts it: child, father and mother. */
function christening(prefix: string, sourceId: string, recordId: string, date = BAPTISM): Record<string, unknown>[] {
  return [
    assertion(`${prefix}1`, sourceId, recordId, "child", "name", "William Latham"),
    assertion(`${prefix}2`, sourceId, recordId, "child", "baptism", "baptized", { date, place: LONGTON }),
    assertion(`${prefix}3`, sourceId, recordId, "father", "name", "John Latham"),
    assertion(`${prefix}4`, sourceId, recordId, "mother", "name", "Harriet Latham"),
  ];
}

function research(extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [source("src_001", "S1"), source("src_002", "S2"), source("src_003", "S4"), source("src_004", "S5")],
    assertions: [
      ...christening("a_00", "src_001", REC.staff),
      ...christening("a_01", "src_002", REC.births),
      assertion("a_030", "src_003", REC.census, "head", "name", "John Latham"),
      assertion("a_031", "src_003", REC.census, "son", "name", "William Latham"),
      assertion("a_040", "src_004", REC.solo, "child", "name", "William Latham"),
    ],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

const ref = (id: string) => ({ ref: id });
const person = (id: string, given: string, gender: string, sources: string[] = []) => ({
  id,
  gender,
  names: [{ id: `${id}-n1`, given, surname: "Latham" }],
  sources: sources.map(ref),
});

/** The tree as the project began: the christening's own source on both parent
 *  edges, and nowhere else but the tree itself. */
function startingTree(edges: { father?: string[]; mother?: string[]; couple?: string[] } = {}): Record<string, any> {
  const { father = ["S1"], mother = ["S1"], couple = [] } = edges;
  return {
    persons: [
      person(W, "William", "Male", ["S3"]),
      // Each parent carries many other sources: siblings' christenings.
      person(J, "John", "Male", ["S4", "S5", "S6"]),
      person(H, "Harriet", "Female", ["S4", "S5", "S6"]),
    ],
    relationships: [
      { id: "R1", type: "ParentChild", parent: J, child: W, sources: father.map(ref) },
      { id: "R2", type: "ParentChild", parent: H, child: W, sources: mother.map(ref) },
      { id: "R3", type: "Couple", person1: J, person2: H, sources: couple.map(ref) },
    ],
    sources: [
      { id: "S1", title: "England, Staffordshire, Church Records", url: `https://www.familysearch.org/${REC.staff}` },
      { id: "S2", title: "England, Births and Christenings", url: `https://www.familysearch.org/${REC.births}` },
      { id: "S3", title: "FamilySearch Family Tree", url: "https://www.familysearch.org/tree/person/details/KWCB-100" },
      { id: "S4", title: "Elizabeth Latham christening", url: `https://www.familysearch.org/${REC.sibling}` },
      { id: "S5", title: "James Latham christening", url: "https://www.familysearch.org/ark:/61903/1:1:SIB2-003" },
      { id: "S6", title: "Thomas Latham christening", url: "https://www.familysearch.org/ark:/61903/1:1:SIB2-004" },
      { id: "SC", title: "1841 England Census", url: `https://www.familysearch.org/${REC.census}` },
    ],
  };
}

const link = (assertionId: string, personId: string, confidence = "probable") => ({
  section: "person_evidence",
  op: "append",
  entry: { assertion_id: assertionId, person_id: personId, confidence, rationale: "test link", superseded_by: null },
});
const standing = (id: string, assertionId: string, personId: string, confidence = "probable") => ({
  id,
  assertion_id: assertionId,
  person_id: personId,
  confidence,
  rationale: "an earlier link",
  created: "2026-10-01",
  superseded_by: null,
});

describe("circular corroboration (issue #2943)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-circular-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(
    r: Record<string, any> = research(),
    baseline: Record<string, any> | null = startingTree(),
    live: Record<string, any> | null = baseline,
  ) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(live ?? { persons: [], relationships: [], sources: [] }, null, 2));
    if (baseline) await writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(baseline, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  /** Record the same_person score the score gate asks of every link here. */
  async function attest(r: Record<string, any>, ...pairs: Array<[string, string]>) {
    for (const [assertionId, personId] of pairs) {
      const a = (r.assertions as any[]).find((x) => x.id === assertionId);
      await recordMatchScore(dir, {
        record_id: a.record_id,
        record_persona_id: null,
        record_role: a.record_role,
        tree_person_id: personId,
        score: 0.9,
        matched: true,
        assertion_id: assertionId,
        record_source: "record_read",
        computed: "2026-10-23T00:00:00Z",
      });
    }
  }
  const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
  const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));
  const circular = (r: any) => (r.ok ? [] : (r.errors as string[]).filter((e) => e.includes("came from the record") || e.includes("nothing but its own attachment")));

  describe("the reported shape", () => {
    it("refuses the child's link to the christening at confident, naming what settles it", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W, "confident"));
      expect(res.ok).toBe(false);
      const [msg] = circular(res);
      expect(msg).toContain(`'${J}' (parent)`);
      expect(msg).toContain(`'${H}' (parent)`);
      expect(msg).toContain(`independent of '${"QL3G-QSCB"}'`);
      expect(msg).toContain("'speculative'");
      expect((await readResearch()).person_evidence).toEqual([]);
    });

    it("refuses it at probable too", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_001", W]);
      expect(circular(await call(link("a_001", W, "probable")))).toHaveLength(1);
    });

    it("accepts it at speculative", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W, "speculative"));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("refuses the other index of the same baptism, matched by the day, the place and the given name", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_011", W]);
      const res = await call(link("a_011", W));
      expect(circular(res)).toHaveLength(1);
    });

    it("refuses linking a parent to the record too: the parents' own edge to the child is the record's", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_003", J]);
      // Role father: the record's other parent is his spouse, and the Couple edge carries nothing,
      // so this link stands. The child edge is not the father's own relationship to a spouse.
      const res = await call(link("a_003", J));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("does not let the parents' other sources clear it", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_001", W]);
      // J and H carry S4..S6 on the persons; only the relationship counts.
      expect(circular(await call(link("a_001", W)))).toHaveLength(1);
    });
  });

  describe("what lets a link through", () => {
    it("accepts a link whose second index is dated to the year only: the edge source then reads as another record", async () => {
      const r = research({
        assertions: [
          ...christening("a_00", "src_001", REC.staff, "1830"),
          ...christening("a_01", "src_002", REC.births, "1830"),
        ],
      });
      await setup(r);
      await attest(r, ["a_011", W]);
      const res = await call(link("a_011", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("accepts when one parent's relationship has an independent source", async () => {
      const r = research();
      await setup(r, startingTree({ mother: ["S1", "SC"] }));
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("accepts when the relationships carry no source: provenance unknown", async () => {
      const r = research();
      await setup(r, startingTree({ father: [], mother: [] }));
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W, "confident"));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("accepts when the only source is the FamilySearch tree itself: counted as no source", async () => {
      const r = research();
      await setup(r, startingTree({ father: ["S3"], mother: ["S3"] }));
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W, "confident"));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("refuses when the tree itself sits beside the record on the edges: the tree is no second source", async () => {
      const r = research();
      await setup(r, startingTree({ father: ["S1", "S3"], mother: ["S1", "S3"] }));
      await attest(r, ["a_001", W]);
      expect(circular(await call(link("a_001", W)))).toHaveLength(1);
    });

    it("accepts an independent corroboration: a census naming the child and his father, linked to both", async () => {
      const r = research({
        person_evidence: [standing("pe_001", "a_031", W), standing("pe_002", "a_030", J)],
      });
      await setup(r);
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("does not clear it on the father's link alone: a record naming only one of the pair", async () => {
      const r = research({ person_evidence: [standing("pe_002", "a_030", J)] });
      await setup(r);
      await attest(r, ["a_001", W]);
      expect(circular(await call(link("a_001", W)))).toHaveLength(1);
    });

    it("clears it when the same call links the census to both", async () => {
      const r = research();
      await setup(r);
      await attest(r, ["a_001", W], ["a_031", W], ["a_030", J]);
      const res = await call(link("a_031", W), link("a_030", J), link("a_001", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("clears it when the live tree gains a source on the relationship that is another record", async () => {
      const r = research();
      const live = startingTree();
      live.relationships[0].sources.push(ref("SC"));
      live.relationships[1].sources.push(ref("SC"));
      await setup(r, startingTree(), live);
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("does not clear it when the run sources the parents to the record itself", async () => {
      const r = research();
      const live = startingTree();
      live.relationships[0].sources.push(ref("S2"));
      live.relationships[1].sources.push(ref("S2"));
      await setup(r, startingTree(), live);
      await attest(r, ["a_001", W]);
      expect(circular(await call(link("a_001", W)))).toHaveLength(1);
    });
  });

  describe("where it does not apply", () => {
    it("does not judge a person the starting tree does not hold", async () => {
      const r = research();
      const live = startingTree();
      live.persons.push(person(X, "William", "Male"));
      await setup(r, startingTree(), live);
      const res = await call(link("a_001", X));
      expect(circular(res)).toHaveLength(0);
    });

    it("does not judge a project with no starting tree", async () => {
      const r = research();
      await setup(r, null, startingTree());
      await attest(r, ["a_001", W]);
      const res = await call(link("a_001", W));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("does not re-judge a link standing before the call when only its rationale changes", async () => {
      const r = research({ person_evidence: [standing("pe_001", "a_001", W)] });
      await setup(r);
      const res = await call({ section: "person_evidence", op: "update", entryId: "pe_001", fields: { rationale: "reworded" } });
      expect(circular(res)).toHaveLength(0);
    });

    it("judges a raise from speculative to confident", async () => {
      const r = research({ person_evidence: [standing("pe_001", "a_001", W, "speculative")] });
      await setup(r);
      await attest(r, ["a_001", W]);
      const res = await call({ section: "person_evidence", op: "update", entryId: "pe_001", fields: { confidence: "confident" } });
      expect(circular(res)).toHaveLength(1);
    });
  });

  describe("the subject alone", () => {
    it("refuses confident when every source on the person is the record, and allows probable", async () => {
      const baseline = startingTree();
      baseline.persons[0] = person(W, "William", "Male", ["S5"]);
      baseline.sources.push({ id: "S5", title: "England, Solo", url: `https://www.familysearch.org/${REC.solo}` });
      const r = research({ sources: [source("src_001", "S1"), source("src_002", "S2"), source("src_003", "S4"), source("src_004", "S5")] });
      await setup(r, baseline);
      await attest(r, ["a_040", W]);
      const confident = await call(link("a_040", W, "confident"));
      expect(circular(confident)).toHaveLength(1);
      expect(errs(confident)).toContain("'probable' is available");
      const probable = await call(link("a_040", W, "probable"));
      expect(probable.ok, errs(probable)).toBe(true);
    });

    it("allows confident when the person carries a source that is another record", async () => {
      const baseline = startingTree();
      baseline.persons[0] = person(W, "William", "Male", ["S5", "SC"]);
      baseline.sources.push({ id: "S5", title: "England, Solo", url: `https://www.familysearch.org/${REC.solo}` });
      const r = research();
      await setup(r, baseline);
      await attest(r, ["a_040", W]);
      const res = await call(link("a_040", W, "confident"));
      expect(res.ok, errs(res)).toBe(true);
    });

    it("allows confident when the person carries no source: provenance unknown", async () => {
      const baseline = startingTree();
      baseline.persons[0] = person(W, "William", "Male");
      const r = research();
      await setup(r, baseline);
      await attest(r, ["a_040", W]);
      const res = await call(link("a_040", W, "confident"));
      expect(res.ok, errs(res)).toBe(true);
    });
  });

  describe("coPartyRelation", () => {
    it("reads a role as the relation it has to the subject's role", () => {
      expect(coPartyRelation("child", "father")).toEqual({ relation: "parent", gender: "male" });
      expect(coPartyRelation("baptized", "mother_of_baptized")).toEqual({ relation: "parent", gender: "female" });
      expect(coPartyRelation("groom", "father_of_groom")).toEqual({ relation: "parent", gender: "male" });
      expect(coPartyRelation("groom", "father_of_bride")).toBeNull();
      expect(coPartyRelation("groom", "bride")).toEqual({ relation: "spouse", gender: "female" });
      expect(coPartyRelation("head_of_household", "wife")).toEqual({ relation: "spouse", gender: "female" });
      expect(coPartyRelation("wife", "head_of_household")).toEqual({ relation: "spouse", gender: null });
      expect(coPartyRelation("father", "mother")).toEqual({ relation: "spouse", gender: "female" });
      expect(coPartyRelation("child", "witness")).toBeNull();
      expect(coPartyRelation("child", "child")).toBeNull();
    });
  });

  describe("sameEntryOf", () => {
    it("joins two indexes by a party's baptism date, place and given name, and no other pair", () => {
      const r = research();
      const entry = sameEntryOf(r, r.assertions[0])!;
      expect([...entry.records].sort()).toEqual(["NGC7-L5Z", "QL3G-QSCB"]);
      expect(entry.records.has("CEN1-001")).toBe(false);
    });

    it("does not join them when the dates differ by a day, or the given names differ", () => {
      const day = research({
        assertions: [...christening("a_00", "src_001", REC.staff), ...christening("a_01", "src_002", REC.births, "21 March 1830")],
      });
      expect(sameEntryOf(day, day.assertions[0])!.records.size).toBe(1);
      const names = research({
        assertions: [
          ...christening("a_00", "src_001", REC.staff),
          ...christening("a_01", "src_002", REC.births).map((a: any) => (a.fact_type === "name" && a.record_role === "child" ? { ...a, value: "Thomas Latham" } : a)),
        ],
      });
      expect(sameEntryOf(names, names.assertions[0])!.records.size).toBe(1);
    });

    it("joins records that share a research source", () => {
      const r = research({
        assertions: [assertion("a_1", "src_001", REC.staff, "child", "name", "A"), assertion("a_2", "src_001", REC.solo, "child", "name", "B")],
      });
      expect(sameEntryOf(r, r.assertions[0])!.records.size).toBe(2);
    });
  });

  it("returns no verdict for negative evidence or an assertion without a record", () => {
    const absent = research({ assertions: [assertion("a_1", "src_001", REC.staff, "child", "name", "A", { record_basis: "absent" })] });
    const entry = { id: "pe_1", assertion_id: "a_1", person_id: W, confidence: "confident", superseded_by: null };
    expect(circularCorroborationVerdict(entry, absent, startingTree(), startingTree())).toBeNull();
    expect(circularCorroborationVerdict(entry, research({ assertions: [] }), startingTree(), startingTree())).toBeNull();
  });
});
