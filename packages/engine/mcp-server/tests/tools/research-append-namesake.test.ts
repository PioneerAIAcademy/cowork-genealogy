import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { LOCAL } from "../../src/auth/principal.js";

// Offline: an appended assertion with a place would otherwise geocode live.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import {
  researchAppend,
  derivedNamesakePairs,
  pairRecordFacts,
  independentLife,
  pairJudgement,
  namesakeVerdicts,
} from "../../src/tools/research-append.js";
import { extractionAppend } from "../../src/tools/extraction-append.js";
import { mergeTreePersons } from "../../src/tools/merge-tree-persons.js";
import { treeEdit } from "../../src/tools/tree-edit.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";
import { writeProjectFile } from "../helpers/project-files.js";

// The `namesakes` section and the cap a recorded namesake puts on links to the
// person it is not (issue #3363). End to end through `researchAppend`.

const P = "KWCB-111"; // John Smith, who has a recorded namesake
const W = "KWCB-222"; // Mary Smith, his wife
const F = "KWCB-333"; // Thomas Smith, his father
const C = "KWCB-444"; // William Smith, his son
const N = "KWCB-555"; // Peter Jones, no relation

const REC = {
  census: "ark:/61903/1:1:CEN1-001",
  voter: "ark:/61903/1:1:VOT2-002",
  death: "ark:/61903/1:1:DTH3-003",
  fatherCensus: "ark:/61903/1:1:CEN4-004",
  baptism: "ark:/61903/1:1:BAP5-005",
  groom: "ark:/61903/1:1:GRM6-061",
  bride: "ark:/61903/1:1:BRD6-062",
  search: "ark:/61903/1:1:NEG7-007",
  godparent1: "ark:/61903/1:1:GOD8-081",
  godparent2: "ark:/61903/1:1:GOD8-082",
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

function source(id: string, sd: string) {
  return {
    id,
    gedcomx_source_description_id: sd,
    citation: `Record ${id}`,
    citation_detail: {
      who: "Clerk",
      what: `Record ${id}`,
      when_created: "1880",
      when_accessed: "2026-10-17",
      where: "Ohio",
      where_within: "page 1",
    },
    source_classification: "original",
    repository: "FamilySearch",
    access_date: "2026-10-17",
  };
}

const ADDRESS = "530 Baldwin St, Niles, Ohio";
const NILES = "Niles, Trumbull, Ohio, United States";

function baseAssertions(): Record<string, unknown>[] {
  return [
    assertion("a_001", "src_001", REC.census, "head", "name", "John Smith"),
    assertion("a_003", "src_001", REC.census, "wife", "name", "Mary Smith"),
    assertion("a_004", "src_001", REC.census, "head", "occupation", "Clerk"),
    assertion("a_005", "src_001", REC.census, "head", "residence", ADDRESS, { place: NILES }),
    assertion("a_010", "src_002", REC.voter, "principal", "name", "John Smith"),
    assertion("a_011", "src_002", REC.voter, "principal", "occupation", "Clerk"),
    assertion("a_012", "src_002", REC.voter, "principal", "residence", ADDRESS, { place: NILES }),
    assertion("a_020", "src_003", REC.death, "deceased", "name", "John Smith"),
    assertion("a_022", "src_003", REC.death, "father", "relationship", "father of John Smith"),
    assertion("a_030", "src_004", REC.fatherCensus, "head", "name", "Thomas Smith"),
    assertion("a_031", "src_004", REC.fatherCensus, "son", "name", "John Smith"),
    assertion("a_040", "src_005", REC.baptism, "child", "name", "William Smith"),
    assertion("a_041", "src_005", REC.baptism, "father", "name", "John Smith"),
    assertion("a_042", "src_005", REC.baptism, "child", "father", "John Smith"),
    assertion("a_050", "src_006", REC.groom, "groom", "name", "John Smith"),
    assertion("a_051", "src_006", REC.bride, "bride", "name", "Mary Brown"),
    assertion("a_053", "src_006", REC.groom, "groom", "marriage", "John Smith and Mary Brown"),
    assertion("a_060", "src_007", REC.search, "principal", "death", "No death record found", {
      record_basis: "absent",
    }),
    assertion("a_090", "src_008", REC.godparent1, "godparent", "name", "John Smith"),
    assertion("a_091", "src_008", REC.godparent2, "godparent", "name", "Mary Smith"),
  ];
}

const ROW = {
  id: "ns_001",
  person_id: P,
  name: "John Smith",
  place: "San Francisco, California, United States",
  time_period: "born about 1873",
  record_ids: [REC.voter],
  created: "2026-10-01",
};

function research(extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => source(`src_00${n}`, `S${n}`)),
    assertions: baseAssertions(),
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    namesakes: [ROW],
    ...extra,
  };
}

function person(id: string, given: string, surname: string, gender: string, extra: Record<string, unknown> = {}) {
  return { id, gender, names: [{ id: `${id}-n1`, given, surname }], ...extra };
}

function tree(): Record<string, any> {
  return {
    persons: [
      person(P, "John", "Smith", "Male"),
      person(W, "Mary", "Smith", "Female"),
      person(F, "Thomas", "Smith", "Male"),
      person(C, "William", "Smith", "Male"),
      person(N, "Peter", "Jones", "Male"),
    ],
    relationships: [
      { id: "R1", type: "Couple", person1: P, person2: W },
      { id: "R2", type: "ParentChild", parent: F, child: P },
      { id: "R3", type: "ParentChild", parent: P, child: C },
    ],
    sources: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `S${n}`, title: `Record S${n}` })),
  };
}

/** A link already in the project when the call starts. */
function standing(id: string, assertionId: string, personId: string, confidence = "probable", extra = {}) {
  return {
    id,
    assertion_id: assertionId,
    person_id: personId,
    confidence,
    rationale: "an earlier link",
    created: "2026-10-01",
    superseded_by: null,
    ...extra,
  };
}

const link = (assertionId: string, personId: string, confidence = "probable") => ({
  section: "person_evidence",
  op: "append",
  entry: { assertion_id: assertionId, person_id: personId, confidence, rationale: "test link", superseded_by: null },
});
const update = (entryId: string, fields: Record<string, unknown>) => ({
  section: "person_evidence",
  op: "update",
  entryId,
  fields,
});
/** An entry without the id the tool assigns. */
function noId<T extends Record<string, unknown>>(e: T): Omit<T, "id"> {
  const { id: _id, ...rest } = e;
  return rest;
}
const addAssertion = (entry: Record<string, unknown>) => ({ section: "assertions", op: "append", entry: noId(entry) });

const M = "KWCB-666"; // Ann Smith, his mother (in treeWithMother only)

/** The tree with P's mother, married to his father. */
function treeWithMother(): Record<string, any> {
  const t = tree();
  t.persons.push(person(M, "Ann", "Smith", "Female"));
  t.relationships.push({ id: "R5", type: "Couple", person1: F, person2: M }, { id: "R6", type: "ParentChild", parent: M, child: P });
  return t;
}

const relationshipStatement = (id: string, sourceId: string, recordId: string, role: string, type: string, related: string, value: string) =>
  assertion(id, sourceId, recordId, role, "relationship", value, { structured_value: { relationship_type: type, related_person_role: related } });

/** A pre-call voucher tied by family: P is the son on his father's census,
 *  whose head is linked to his father, and the son's `factType` there is
 *  `value`; the census head of src_001 carries the same value. */
function tiedVoucher(factType: "occupation" | "residence", value: string): Record<string, any> {
  const extra = factType === "residence" ? { place: NILES } : {};
  return research({
    assertions: [
      ...baseAssertions().filter((a) => a.id !== (factType === "residence" ? "a_005" : "a_004")),
      assertion(factType === "residence" ? "a_005" : "a_004", "src_001", REC.census, "head", factType, value, extra),
      assertion("a_032", "src_004", REC.fatherCensus, "son", factType, value, extra),
    ],
    person_evidence: [standing("pe_001", "a_032", P), standing("pe_002", "a_030", F)],
  });
}

describe("namesake cap", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-namesake-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(r: Record<string, any> = research(), t: Record<string, any> = tree()) {
    await writeProjectFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  /** Record the same_person score the score gate asks of every link here. */
  async function attest(...pairs: Array<[string, string] | [string, string, string]>) {
    const byId = new Map(baseAssertions().map((a) => [a.id as string, a]));
    for (const [assertionId, personId, recordId] of pairs) {
      const a = byId.get(assertionId) ?? { record_role: "head" };
      await recordMatchScore(dir, {
        record_id: recordId ?? (a.record_id as string | undefined) ?? REC.census,
        record_persona_id: null,
        record_role: a.record_role as string,
        tree_person_id: personId,
        score: 0.9,
        scorer: "familysearch",
        model: null,
        assertion_id: assertionId,
        record_source: "record_read",
        computed: "2026-10-17T00:00:00Z",
      });
    }
  }
  /** A score for assertions outside the base list, keyed on their own role and record. */
  async function scoreAll(research: Record<string, any>, ...pairs: Array<[string, string]>) {
    for (const [assertionId, personId] of pairs) {
      const a = (research.assertions as any[]).find((x) => x.id === assertionId);
      await recordMatchScore(dir, {
        record_id: a.record_id,
        record_persona_id: null,
        record_role: a.record_role,
        tree_person_id: personId,
        score: 0.9,
        scorer: "familysearch",
        model: null,
        assertion_id: assertionId,
        record_source: "record_read",
        computed: "2026-10-17T00:00:00Z",
      });
    }
  }
  const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
  const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));
  const capErrors = (r: any) => (r.ok ? [] : (r.errors as string[]).filter((e) => e.includes("namesake(s) of")));

  // ─── what an update may change (updatableFields) ─────────────────────────────

  describe("updatableFields (U1)", () => {
    const appendRow = async () => {
      await setup(research({ namesakes: [] }));
      const r = await researchAppend({
        projectPath: dir,
        section: "namesakes",
        op: "append",
        entry: { person_id: P, name: ROW.name, place: ROW.place, time_period: ROW.time_period, record_ids: ROW.record_ids, notes: null },
      } as any);
      expect(r.ok, errs(r)).toBe(true);
    };

    it("appends a row as ns_001 and stamps created", async () => {
      await appendRow();
      const row = (await readResearch()).namesakes[0];
      expect(row.id).toBe("ns_001");
      expect(row.person_id).toBe(P);
      expect(row.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("refuses an update that moves the row to another person", async () => {
      await appendRow();
      const r = await researchAppend({
        projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { person_id: N },
      } as any);
      expect(r.ok).toBe(false);
      expect(errs(r)).toMatch(/field\(s\) not updatable on 'namesakes': person_id \(allowed: name, place/);
      expect((await readResearch()).namesakes[0].person_id).toBe(P);
    });

    it("refuses person_id even beside fields an update may change, and writes none of them", async () => {
      await appendRow();
      const r = await researchAppend({
        projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001",
        fields: { notes: "moved", person_id: N },
      } as any);
      expect(r.ok).toBe(false);
      const row = (await readResearch()).namesakes[0];
      expect(row.person_id).toBe(P);
      expect(row.notes).toBeNull();
    });

    it("allows the descriptive fields, and an id equal to the row's own", async () => {
      await appendRow();
      const r = await researchAppend({
        projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001",
        fields: { id: "ns_001", notes: "A clerk, not the subject", record_ids: [REC.voter, REC.death] },
      } as any);
      expect(r.ok, errs(r)).toBe(true);
      const row = (await readResearch()).namesakes[0];
      expect(row.notes).toBe("A clerk, not the subject");
      expect(row.record_ids).toHaveLength(2);
      expect(row.person_id).toBe(P);
    });
  });

  // ─── links the cap refuses ──────────────────────────────────────────────────

  describe("refuses an untied link it is asked to write", () => {
    it("C1 a confident or probable link whose source has no other party, naming the row and the way out", async () => {
      await setup();
      await attest(["a_020", P]);
      for (const confidence of ["confident", "probable"]) {
        const r = await call(link("a_020", P, confidence));
        expect(r.ok).toBe(false);
        const m = errs(r);
        expect(m).toMatch(new RegExp(`^ops\\[0\\]: confidence '${confidence}' is not available on link 'pe_001' to '${P}'`, "m"));
        expect(m).toContain("(ns_001: John Smith, San Francisco, California, United States, born about 1873)");
        expect(m).toContain("nothing in source 'src_003' ties assertion 'a_020'");
        expect(m).toContain("No other party of this source is linked at 'probable' or better to anyone else in the tree.");
        expect(m).toContain("caps this link at 'speculative'");
        expect(m).toContain("the same street address or occupation");
        expect(m).toContain("worked example for 'person_evidence'");
      }
      expect((await readResearch()).person_evidence).toEqual([]);
    });

    it("C2 judges a row recorded in the same call, in either order", async () => {
      await setup(research({ namesakes: [] }));
      await attest(["a_020", P]);
      const row = {
        section: "namesakes",
        op: "append",
        entry: { person_id: P, name: "John Smith", place: ROW.place, time_period: ROW.time_period, record_ids: [], notes: null },
      };
      for (const ops of [[row, link("a_020", P)], [link("a_020", P), row]]) {
        const r = await call(...ops);
        expect(r.ok).toBe(false);
        expect(errs(r)).toContain("(added in this call: John Smith, San Francisco, California, United States, born about 1873)");
      }
    });

    it("C3 judges a link whose assertion the same call appends after it", async () => {
      await setup();
      await attest(["a_092", P, REC.death]);
      const r = await call(
        link("a_092", P),
        addAssertion(assertion("x", "src_003", REC.death, "deceased", "occupation", "Laborer")),
      );
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("ties assertion 'a_092'");
    });

    it("C4 a raise from probable to confident on an untied link", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", P)] }));
      await attest(["a_020", P]);
      const r = await call(update("pe_001", { confidence: "confident" }));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("confidence 'confident' is not available on link 'pe_001'");
    });

    it("C5 an untied link superseded in one call and brought back in a later one", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", P)] }));
      await attest(["a_020", P]);
      const retire = await call(link("a_020", P, "speculative"), update("pe_001", { superseded_by: "pe_002" }));
      expect(retire.ok, errs(retire)).toBe(true);
      const r = await call(update("pe_001", { superseded_by: null }));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("on link 'pe_001'");
    });

    it("C6 a link re-pointed onto the person, by person_id and by assertion_id", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", N), standing("pe_002", "a_010", P)] }));
      await attest(["a_020", N], ["a_020", P], ["a_010", P]);
      const byPerson = await call(update("pe_001", { person_id: P }));
      expect(byPerson.ok).toBe(false);
      expect(errs(byPerson)).toContain("on link 'pe_001'");
      const byAssertion = await call(update("pe_002", { assertion_id: "a_020" }));
      expect(byAssertion.ok).toBe(false);
      expect(errs(byAssertion)).toContain("on link 'pe_002'");
    });

    it("C7 an occupation matched only by a record raised in the same call", async () => {
      // Two sources' appends cannot share a call (one source per call), so the
      // same-call voucher arrives as a raise on standing links.
      await setup(
        research({ person_evidence: [standing("pe_001", "a_011", P, "speculative"), standing("pe_002", "a_001", P, "speculative")] }),
      );
      await attest(["a_011", P], ["a_001", P]);
      const r = await call(update("pe_001", { confidence: "probable" }), update("pe_002", { confidence: "probable" }));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(
        `The occupation 'clerk' on this source matches no record linked to '${P}' at 'probable' or better ` +
          "before this call that is itself tied (a link cannot vouch in the call that writes it).",
      );
    });

    it("C8 a relative made from the source, though the source keeps each party on its own record", async () => {
      const t = tree();
      t.persons.push({ id: "I9", gender: "Female", names: [{ id: "I9-n1", given: "Mary", surname: "Brown", sources: [{ ref: "S6" }] }] });
      t.relationships.push({ id: "R4", type: "Couple", person1: P, person2: "I9" });
      await setup(research(), t);
      await attest(["a_051", "I9"], ["a_050", P]);
      const r = await call(link("a_051", "I9"), link("a_050", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`'pe_001' links another party ('bride') to 'I9', '${P}''s spouse, but 'I9' was created from this source alone.`);
    });

    it("refuses a link whose other party is linked to someone who is no relative", async () => {
      await setup();
      await attest(["a_003", N], ["a_001", P]);
      const r = await call(link("a_003", N), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`'pe_001' links another party ('wife') to '${N}', who is not a spouse, parent or child of '${P}' in the tree.`);
    });

    it("refuses a link whose other party is linked to the wife only at 'speculative'", async () => {
      await setup();
      await attest(["a_003", W], ["a_001", P]);
      const r = await call(link("a_003", W, "speculative"), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`'pe_001' links another party ('wife') to '${W}', '${P}''s spouse, only at 'speculative'.`);
    });

    it("refuses a link tied only through a wife with no given name", async () => {
      const t = tree();
      t.persons[1] = person(W, "Mrs.", "Smith", "Female");
      await setup(research(), t);
      await attest(["a_003", W], ["a_001", P]);
      const r = await call(link("a_003", W), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`but '${W}' has no given name.`);
    });

    it("refuses a link whose only other link is his own marriage assertion linked to his wife", async () => {
      await setup();
      await attest(["a_053", W], ["a_050", P]);
      const r = await call(link("a_053", W), link("a_050", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("No other party of this source is linked at 'probable' or better to anyone else in the tree.");
    });

    // Tie (b) reads a street address, never a date, a town or a place.
    // The voucher is P's entry on his father's census, tied by his father, so
    // only the clause each case names can refuse it.
    const residencePair = (value: string, censusPlace: string, voucherPlace: string) =>
      research({
        assertions: [
          ...baseAssertions().filter((a) => a.id !== "a_005"),
          assertion("a_005", "src_001", REC.census, "head", "residence", value, { place: censusPlace }),
          assertion("a_032", "src_004", REC.fatherCensus, "son", "residence", value, { place: voucherPlace }),
        ],
        person_evidence: [standing("pe_001", "a_032", P), standing("pe_002", "a_030", F)],
      });

    it.each([
      ["a date", "1 June 1880", NILES, NILES],
      ["the town its place names", "Niles, Trumbull, Ohio", "Niles, Trumbull, Ohio", "Niles, Trumbull, Ohio"],
      ["a village name with differing places", "Lidečko", "Lidečko, Zlín, Czech Republic", "Vsetín, Zlín, Czech Republic"],
      ["a town, a county and a year", "Niles, Trumbull, 1880", NILES, NILES],
      ["a date in another language", "15 Mai 1880", NILES, NILES],
      ["a street address equal to its own place", ADDRESS, ADDRESS, ADDRESS],
      ["a year before a town", "1880 Niles, Trumbull", NILES, NILES],
      ["a militia district number", "Militia District No. 588, Hall, Georgia", NILES, NILES],
      ["a ward and enumeration district", "Rochester Ward 12 ED 83, Monroe County, New York, 1900", NILES, NILES],
      ["a rural route", "R.F.D. No. 2, Niles, Ohio", NILES, NILES],
      ["a dwelling and family number", "Dwelling 45 family 47", NILES, NILES],
    ])("refuses a residence tie on %s", async (_label, value, censusPlace, voterPlace) => {
      await setup(residencePair(value, censusPlace, voterPlace));
      await attest(["a_001", P]);
      const r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(capErrors(r)).toHaveLength(1);
    });

    it("refuses a voucher on the link's own source", async () => {
      // A second persona of the census, a boarder, is linked to P through its
      // occupation, and is itself tied through its address; the head's
      // occupation matches only it.
      await setup(
        research({
          assertions: [
            ...baseAssertions().filter((a) => a.id !== "a_005"),
            assertion("a_005", "src_001", REC.census, "head", "residence", "12 Elm St, Niles, Ohio", { place: NILES }),
            assertion("a_111", "src_001", REC.census, "boarder", "occupation", "Clerk"),
            assertion("a_112", "src_001", REC.census, "boarder", "residence", ADDRESS, { place: NILES }),
            assertion("a_032", "src_004", REC.fatherCensus, "son", "residence", ADDRESS, { place: NILES }),
          ],
          person_evidence: [standing("pe_001", "a_111", P), standing("pe_002", "a_032", P), standing("pe_003", "a_030", F)],
        }),
      );
      await attest(["a_001", P]);
      const r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("nothing in source 'src_001' ties assertion 'a_001'");
    });

    it("refuses a link whose only other party is linked through an absent-basis assertion", async () => {
      await setup(
        research({
          assertions: [
            ...baseAssertions(),
            assertion("a_093", "src_001", REC.census, "wife", "birth", "Birthplace not stated", { record_basis: "absent" }),
          ],
        }),
      );
      await attest(["a_093", W], ["a_001", P]);
      const r = await call(link("a_093", W), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("No other party of this source is linked at 'probable' or better to anyone else in the tree.");
    });

    it("refuses an occupation tie read from an absent-basis assertion", async () => {
      await setup(
        research({
          assertions: [
            ...baseAssertions(),
            assertion("a_094", "src_001", REC.census, "head", "occupation", "None", { record_basis: "absent" }),
            assertion("a_032", "src_004", REC.fatherCensus, "son", "occupation", "None"),
          ],
          person_evidence: [standing("pe_001", "a_032", P), standing("pe_002", "a_030", F)],
        }),
      );
      await attest(["a_001", P]);
      const r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(capErrors(r)).toHaveLength(1);
    });

    it("puts the refusal ahead of a validation error in the same call", async () => {
      await setup();
      await attest(["a_020", P]);
      const r = await call(link("a_020", P), {
        section: "namesakes",
        op: "append",
        entry: { person_id: P, name: "John Smith", place: "", time_period: null, record_ids: [], notes: null },
      });
      expect(r.ok).toBe(false);
      const errors = (r as any).errors as string[];
      expect(errors[0]).toMatch(/^ops\[0\]: confidence 'probable' is not available on link 'pe_001'/);
      expect(errors.some((e) => /^ops\[1\]: .*namesakes\[1\].*'place'/.test(e))).toBe(true);
    });

    it("still holds the link that applied to the cap when another op in the call fails, labelled with its own index", async () => {
      // ops[0] fails on its own, so only ops[1] applies; the cap's refusal of it must
      // still come back, as ops[1] (its place in the call), not ops[0] (its place among
      // the ops that applied), and in the same response as the failure.
      await setup();
      await attest(["a_020", P]);
      const before = await readFile(join(dir, "research.json"), "utf-8");
      const r = await call({ section: "conflicts", op: "update", entryId: "c_999", fields: { status: "moot" } }, link("a_020", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toMatch(/^ops\[0\]: entryId 'c_999' not found in 'conflicts'/m);
      expect(capErrors(r)).toHaveLength(1);
      expect(capErrors(r)[0]).toMatch(/^ops\[1\]: confidence 'probable' is not available on link 'pe_001'/);
      expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    });

    it("keys the refusal to the last op that wrote the link", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", N, "speculative")] }));
      await attest(["a_020", P]);
      const r = await call(update("pe_001", { person_id: P }), update("pe_001", { confidence: "probable" }));
      expect(r.ok).toBe(false);
      expect(capErrors(r)).toHaveLength(1);
      expect(capErrors(r)[0]).toMatch(/^ops\[1\]: confidence 'probable' is not available on link 'pe_001'/);
    });

    it.each([
      ["a prefix 'Mrs.' and his given name", { prefix: "Mrs.", given: "John" }],
      ["'Mrs. John'", { given: "Mrs. John" }],
      ["'Wife of John'", { given: "Wife of John" }],
      ["'Mrs. J.'", { given: "Mrs. J." }],
    ])("refuses a link tied only through a wife recorded by %s", async (_label, name) => {
      const t = tree();
      t.persons[1] = { id: W, gender: "Female", names: [{ id: `${W}-n1`, surname: "Smith", ...name }] };
      await setup(research(), t);
      await attest(["a_003", W], ["a_001", P]);
      const r = await call(link("a_003", W), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`but '${W}' has no given name of their own, only their spouse's.`);
    });

    it("refuses a link tied only through a mother recorded by her husband's given name", async () => {
      const M = "KWCB-666";
      const t = tree();
      t.persons.push({ id: M, gender: "Female", names: [{ id: `${M}-n1`, prefix: "Mrs.", given: "Thomas", surname: "Smith" }] });
      t.relationships.push({ id: "R5", type: "Couple", person1: F, person2: M }, { id: "R6", type: "ParentChild", parent: M, child: P });
      await setup(research({ assertions: [...baseAssertions(), assertion("a_023", "src_003", REC.death, "mother", "name", "Sarah Smith")] }), t);
      await attest(["a_020", P]);
      await recordMatchScore(dir, {
        record_id: REC.death,
        record_persona_id: null,
        record_role: "mother",
        tree_person_id: M,
        score: 0.9,
        scorer: "familysearch",
        model: null,
        assertion_id: "a_023",
        record_source: "record_read",
        computed: "2026-10-17T00:00:00Z",
      });
      const r = await call(link("a_023", M), link("a_020", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`but '${M}' has no given name of their own, only their spouse's.`);
    });

    it("C10 refuses an address tie when the voucher's record, or the link's own, lists a second John Smith", async () => {
      const there = tiedVoucher("residence", ADDRESS);
      there.assertions.push(assertion("a_034", "src_004", REC.fatherCensus, "lodger", "name", "John Smith"));
      await setup(there);
      await attest(["a_001", P]);
      let r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("(its record lists another 'John Smith', so the match cannot tell them apart)");
      const here = tiedVoucher("residence", ADDRESS);
      here.assertions.push(assertion("a_036", "src_001", REC.census, "son", "name", "John Smith"));
      await setup(here);
      r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("(its record lists another 'John Smith', so the match cannot tell them apart)");
    });

    it("C11 refuses a link tied through his mother where the record states she is his spouse", async () => {
      const r0 = research({
        assertions: [
          ...baseAssertions(),
          assertion("a_023", "src_003", REC.death, "spouse", "name", "Mary Smith"),
          relationshipStatement("a_024", "src_003", REC.death, "spouse", "wife", "deceased", "wife of John Smith"),
        ],
      });
      await setup(r0, treeWithMother());
      await attest(["a_020", P]);
      await scoreAll(r0, ["a_023", M]);
      const r = await call(link("a_023", M), link("a_020", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`'pe_001' links another party ('spouse') to '${M}', '${P}''s parent, but the record states that party is 'spouse' of '${P}''s party.`);
    });

    it("C11b refuses it too when the spouse's own two-party statement is linked to his mother", async () => {
      const r0 = research({
        assertions: [
          ...baseAssertions(),
          assertion("a_023", "src_003", REC.death, "spouse", "name", "Mary Smith"),
          relationshipStatement("a_024", "src_003", REC.death, "spouse", "wife", "deceased", "wife of John Smith"),
        ],
      });
      await setup(r0, treeWithMother());
      await attest(["a_020", P]);
      await scoreAll(r0, ["a_023", M], ["a_024", M]);
      const r = await call(link("a_023", M), link("a_024", M), link("a_020", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("but the record states that party is 'spouse' of");
      expect(errs(r)).not.toContain("'pe_002' links another party ('spouse') to 'KWCB-666', 'KWCB-111''s parent.");
    });

    it("C11c refuses a link tied through his mother where he heads the household and she is listed as its wife", async () => {
      await setup(research(), treeWithMother());
      await attest(["a_001", P]);
      await scoreAll(research(), ["a_003", M]);
      const r = await call(link("a_003", M), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`but '${P}''s party heads the household and the record lists that party as its 'wife'.`);
    });

    it("C13 refuses raising a link whose only voucher is another untied link that vouches for it in turn", async () => {
      await setup(research({ person_evidence: [standing("pe_010", "a_012", P), standing("pe_011", "a_005", P)] }));
      const r = await call(update("pe_011", { confidence: "confident" }));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("(its voucher 'pe_010' is not tied)");
    });

    it("refuses an occupation tie read from an unlinked assertion of the voucher's persona", async () => {
      await setup(
        research({
          assertions: [...baseAssertions(), assertion("a_032", "src_004", REC.fatherCensus, "son", "occupation", "Clerk")],
          person_evidence: [standing("pe_001", "a_031", P), standing("pe_002", "a_030", F)],
        }),
      );
      await attest(["a_001", P]);
      const r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(capErrors(r)).toHaveLength(1);
    });

    it.each([
      ["superseded", [standing("pe_002", "a_011", P, "speculative")], [update("pe_001", { superseded_by: "pe_002" })], "pe_003"],
      ["lowered to speculative", [], [update("pe_001", { confidence: "speculative" })], "pe_002"],
    ])("refuses an occupation tie whose voucher is %s in the same call", async (_label, seeded, ops, linkId) => {
      await setup(research({ person_evidence: [standing("pe_001", "a_011", P), ...(seeded as unknown[])] }));
      await attest(["a_011", P], ["a_001", P]);
      const r = await call(...(ops as unknown[]), link("a_001", P));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain(`on link '${linkId}'`);
    });

    it("R1 refuses only the link a same-call re-point would vouch for", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_005", N), standing("pe_002", "a_003", W)] }));
      await attest(["a_005", N], ["a_005", P], ["a_012", P]);
      const r = await call(update("pe_001", { person_id: P }), link("a_012", P));
      expect(r.ok).toBe(false);
      const cap = capErrors(r);
      expect(cap).toHaveLength(1);
      expect(cap[0]).toMatch(/^ops\[1\]: confidence 'probable' is not available on link 'pe_003'/);
      expect(cap[0]).toContain("(a link cannot vouch in the call that writes it)");
    });
  });

  // ─── links the cap allows ───────────────────────────────────────────────────

  describe("allows a link something in its record ties", () => {
    const ok = async (r: any) => expect(r.ok, errs(r)).toBe(true);

    it("a tied link asserted beside an untied link written before the row", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", P)] }));
      await attest(["a_003", W], ["a_001", P]);
      await ok(await call(link("a_001", P), link("a_003", W)));
    });

    it("S12 through his wife on the census he heads", async () => {
      await setup();
      await attest(["a_003", W], ["a_001", P]);
      await ok(await call(link("a_001", P), link("a_003", W)));
    });

    it("through his father, who heads the household he is a son in", async () => {
      await setup();
      await attest(["a_030", F], ["a_031", P]);
      await ok(await call(link("a_031", P), link("a_030", F)));
    });

    it("through a father who shares his given name", async () => {
      const t = tree();
      t.persons[2] = person(F, "John", "Smith", "Male");
      await setup(research(), t);
      await attest(["a_030", F], ["a_031", P]);
      await ok(await call(link("a_031", P), link("a_030", F)));
    });

    it("through his son on the son's baptism", async () => {
      await setup();
      await attest(["a_040", C], ["a_041", P]);
      await ok(await call(link("a_041", P), link("a_040", C)));
    });

    it("on both sides of a parentage the child's persona states", async () => {
      await setup();
      await attest(["a_040", C], ["a_041", P], ["a_042", P], ["a_042", C]);
      await ok(await call(link("a_041", P), link("a_042", P), link("a_040", C), link("a_042", C)));
    });

    it("S6 through the child's mother assertion linked to his wife, which names her and is not role checked", async () => {
      const r0 = research({
        assertions: [
          ...baseAssertions(),
          assertion("a_045", "src_005", REC.baptism, "child", "mother", "Mary Smith"),
          relationshipStatement("a_046", "src_005", REC.baptism, "child", "son", "father", "son of John Smith"),
        ],
      });
      await setup(r0);
      await attest(["a_041", P]);
      await scoreAll(r0, ["a_045", W]);
      await ok(await call(link("a_041", P), link("a_045", W)));
    });

    it("S7 through his wife, though a statement on her is typed parent while its value says child", async () => {
      const r0 = research({
        assertions: [...baseAssertions(), relationshipStatement("a_047", "src_001", REC.census, "wife", "parent", "head", "child of John Smith")],
      });
      await setup(r0);
      await attest(["a_003", W], ["a_001", P]);
      await ok(await call(link("a_001", P), link("a_003", W)));
    });

    it("S13 through his mother on his father's census, where he is the son and the head is unlinked", async () => {
      const r0 = research({ assertions: [...baseAssertions(), assertion("a_035", "src_004", REC.fatherCensus, "wife", "name", "Ann Smith")] });
      await setup(r0, treeWithMother());
      await attest(["a_031", P]);
      await scoreAll(r0, ["a_035", M]);
      await ok(await call(link("a_031", P), link("a_035", M)));
    });

    it("S14 through his mother on a page of two households, where he heads the second", async () => {
      const r0 = research({
        assertions: [
          ...baseAssertions(),
          assertion("a_101", "src_001", REC.census, "head_of_household_2", "name", "John Smith"),
          assertion("a_102", "src_001", REC.census, "wife", "name", "Ann Smith"),
        ],
      });
      await setup(r0, treeWithMother());
      await scoreAll(r0, ["a_101", P], ["a_102", M]);
      await ok(await call(link("a_101", P), link("a_102", M)));
    });

    it("S4 through the child's persona alone, its father assertion on him and its name on his son", async () => {
      await setup();
      await attest(["a_040", C], ["a_042", P]);
      await ok(await call(link("a_042", P), link("a_040", C)));
    });

    it("S3 through his wife on a source whose assertions mix bare and ARK record ids", async () => {
      await setup(
        research({
          assertions: [
            ...baseAssertions().filter((a) => a.id !== "a_003"),
            assertion("a_003", "src_001", "CEN1-001", "wife", "name", "Mary Smith"),
          ],
        }),
      );
      await attest(["a_003", W, "CEN1-001"], ["a_001", P]);
      await ok(await call(link("a_001", P), link("a_003", W)));
    });

    it("S5 through his wife where each godparent has a record id of its own and the same role", async () => {
      await setup();
      await attest(["a_090", P], ["a_091", W]);
      await ok(await call(link("a_090", P), link("a_091", W)));
    });

    it("all four links of a marriage written in one call", async () => {
      await setup();
      await attest(["a_050", P], ["a_051", W], ["a_053", P], ["a_053", W]);
      await ok(await call(link("a_050", P), link("a_051", W), link("a_053", P), link("a_053", W)));
    });

    it("a death record whose father appears only in a relationship assertion linked to his father", async () => {
      await setup();
      await attest(["a_022", F], ["a_020", P]);
      await ok(await call(link("a_020", P), link("a_022", F)));
    });

    it("on a street address a link written before this call already carries, itself tied by family", async () => {
      await setup(tiedVoucher("residence", ADDRESS));
      await attest(["a_001", P]);
      await ok(await call(link("a_001", P)));
    });

    it("S10 on an occupation a pre-call voucher tied by family already carries", async () => {
      await setup(tiedVoucher("occupation", "Clerk"));
      await attest(["a_001", P]);
      await ok(await call(link("a_001", P)));
    });

    it.each([
      "6906 W. Lloyd St., Milwaukee, Wisconsin",
      "350 12th Street, Oakland, California",
      "Hauptstraße 12, Zürich",
      "Via Roma 12, Napoli",
      "liskova, house #65",
    ])("on the street address %s", async (value) => {
      await setup(tiedVoucher("residence", value));
      await attest(["a_001", P]);
      await ok(await call(link("a_001", P)));
    });

    it("a call that asserts nothing, beside a standing link with a weaker duplicate after it", async () => {
      await setup(
        research({ person_evidence: [standing("pe_001", "a_020", P, "confident"), standing("pe_002", "a_020", P, "probable")] }),
      );
      await ok(await researchAppend({ projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { notes: "seen again" } } as any));
      await ok(
        await researchAppend({
          projectPath: dir,
          section: "namesakes",
          op: "append",
          entry: { person_id: P, name: "John Smith", place: "Oakland, California", time_period: null, record_ids: [], notes: null },
        } as any),
      );
    });

    it("through a father's name linked only at 'speculative', whose occupation a standing link carries", async () => {
      const r = tiedVoucher("occupation", "Clerk");
      r.assertions.push(assertion("a_043", "src_005", REC.baptism, "father", "occupation", "Clerk"));
      await setup(r);
      await attest(["a_041", P], ["a_042", P]);
      await ok(await call(link("a_041", P, "speculative"), link("a_042", P)));
    });

    it("through the child's own address, when nothing one-party of the baptism is linked to him", async () => {
      const r = tiedVoucher("residence", ADDRESS);
      r.assertions.push(assertion("a_044", "src_005", REC.baptism, "child", "residence", ADDRESS, { place: NILES }));
      await setup(r);
      await attest(["a_042", P]);
      await ok(await call(link("a_042", P)));
    });

    it("known let-through: his marriage assertion linked to him and to his wife, nothing else of his party linked", async () => {
      await setup();
      await attest(["a_053", P], ["a_053", W]);
      await ok(await call(link("a_053", P), link("a_053", W)));
    });

    it("S9 a raise on an untied link that a tied link at the same address vouches for", async () => {
      await setup(
        research({
          person_evidence: [
            standing("pe_001", "a_012", P),
            standing("pe_002", "a_005", P),
            standing("pe_003", "a_003", W),
          ],
        }),
      );
      await ok(await call(update("pe_001", { confidence: "confident" })));
    });

    it("whose assertion the same call appends after it, when the wife ties it", async () => {
      await setup();
      await attest(["a_092", P], ["a_003", W]);
      await ok(
        await call(
          link("a_092", P),
          link("a_003", W),
          addAssertion(assertion("x", "src_001", REC.census, "head", "occupation", "Laborer")),
        ),
      );
    });

    it("at 'speculative'", async () => {
      await setup();
      await attest(["a_020", P]);
      await ok(await call(link("a_020", P, "speculative")));
    });

    it("with no namesake recorded, or one recorded for someone else", async () => {
      await setup(research({ namesakes: [] }));
      await attest(["a_020", P]);
      await ok(await call(link("a_020", P)));
      await setup(research({ namesakes: [{ ...ROW, person_id: N }] }));
      await ok(await call(link("a_020", P)));
    });

    it("from an absent-basis assertion, which the cap never judges", async () => {
      await setup();
      await attest(["a_060", P]);
      await ok(await call(link("a_060", P)));
    });

    it("a supersede that retires an untied link", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", P)] }));
      await attest(["a_020", P]);
      await ok(await call(link("a_020", P, "speculative"), update("pe_001", { superseded_by: "pe_002" })));
    });

    it("S11 a rationale edit, and an extraction, beside an untied link written before the row", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_020", P)] }));
      await ok(await call(update("pe_001", { rationale: "re-read the record" })));
      const r = await extractionAppend(
        {
          projectPath: dir,
          documents: [{
            recordId: "capture:smith-letter-1901",
            document: {
              recordType: "other",
              documentForm: "verbatim_transcript",
              source: { title: "Letter of John Smith, 1901", repository: "Family papers" },
              persons: [{ id: "p1", principal: true, gender: "male", names: [{ given: "John", surname: "Smith" }], facts: [] }],
              relationships: [],
            },
          }],
        } as any,
        LOCAL,
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
    });
  });

  // ─── item 19: the move rule re-checks an un-supersede ──────────────────────

  describe("the move rule (MV1)", () => {
    it("refuses bringing back a confident link across an unexplained move", async () => {
      const r0 = research({
        namesakes: [],
        assertions: [
          ...baseAssertions(),
          assertion("a_070", "src_001", REC.census, "head", "residence", "Maury, Tennessee", { place: "Maury, Tennessee, United States" }),
        ],
        person_evidence: [standing("pe_001", "a_001", P, "confident")],
      });
      const t = tree();
      t.persons[0] = {
        ...person(P, "John", "Smith", "Male"),
        facts: [{ id: "F1", type: "Residence", date: "1861", place: "Horsham, Sussex, England", sources: [{ ref: "S2" }] }],
      };
      r0.person_evidence.push(standing("pe_009", "a_010", P, "confident"));
      await setup(r0, t);
      await attest(["a_001", P]);
      const retire = await call(link("a_001", P, "speculative"), update("pe_001", { superseded_by: "pe_010" }));
      expect(retire.ok, errs(retire)).toBe(true);
      const r = await call(update("pe_001", { superseded_by: null }));
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("move_bridge");
    });
  });

  // ─── 1d: the namesake warning (spec §5.6) ───────────────────────────────────

  describe("the namesake warning (WN-row)", () => {
    const wn = (r: any): string[] =>
      r.ok ? (r.validation.warnings as string[]).filter((w) => w.startsWith("namesake 'ns_")) : [];
    const appendRow = () => call({ section: "namesakes", op: "append", entry: noId(ROW) });

    it("WT1 records a row over an untied link and lists it with the fact copied through it", async () => {
      const t = tree();
      t.persons[0] = {
        ...person(P, "John", "Smith", "Male"),
        facts: [{ id: "F1", type: "Occupation", value: "Clerk", sources: [{ ref: "S2" }] }],
      };
      await setup(research({ namesakes: [], person_evidence: [standing("pe_001", "a_010", P)] }), t);
      const r = await appendRow();
      expect(r.ok, errs(r)).toBe(true);
      expect((await readResearch()).namesakes).toHaveLength(1);
      expect(wn(r)).toEqual([
        "namesake 'ns_001' (John Smith, San Francisco, California, United States, born about 1873) recorded " +
          "for 'KWCB-111': 1 probable or confident link(s) to 'KWCB-111' stand with nothing in their record " +
          "tying them to 'KWCB-111': 'pe_001' (assertion 'a_010' on source 'src_002', name). 1 fact(s) on " +
          "'KWCB-111' were copied through them: 'F1' Occupation (cites S2). The row is recorded and these stay " +
          "as they are, but materialize_facts will not copy any further fact onto 'KWCB-111' through these links, " +
          "and tree_edit and tree_correct will not cite their records' S entries onto 'KWCB-111''s facts or " +
          "names unless another record on the same S entry ties to 'KWCB-111'. For each link, person-evidence either ties it or lowers it to 'speculative' naming the " +
          "namesake. Remove a listed fact that belongs to the namesake with tree_correct (operation 'remove', " +
          "its factId and personId 'KWCB-111').",
      ]);
    });

    it("WT2 lists only the facts whose party holds the untied link", async () => {
      const r0 = research({
        namesakes: [],
        assertions: [
          ...baseAssertions().filter((a) => a.id !== "a_011" && a.id !== "a_012"),
          assertion("a_011", "src_002", REC.voter, "principal", "occupation", "Farmer"),
          assertion("a_014", "src_002", REC.voter, "wife", "birth", "", { date: "1852" }),
        ],
        person_evidence: [standing("pe_001", "a_010", P), standing("pe_002", "a_001", P), standing("pe_003", "a_003", W)],
      });
      const t = tree();
      t.persons[0] = {
        ...person(P, "John", "Smith", "Male"),
        facts: [
          { id: "F1", type: "Occupation", value: "Farmer", assertion_id: "a_011", sources: [{ ref: "S2" }] },
          { id: "F2", type: "Occupation", value: "Clerk", assertion_id: "a_004", sources: [{ ref: "S1" }] },
          // From the voter record's wife, a party holding no link: the refused
          // link's own record, but not its party.
          { id: "F3", type: "Birth", date: "1852", assertion_id: "a_014", sources: [{ ref: "S2" }] },
        ],
      };
      await setup(r0, t);
      const r = await appendRow();
      expect(r.ok, errs(r)).toBe(true);
      const found = wn(r);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("1 probable or confident link(s)");
      expect(found[0]).toContain("'pe_001' (assertion 'a_010' on source 'src_002', name)");
      expect(found[0]).toContain("1 fact(s) on 'KWCB-111' were copied through them: 'F1' Occupation (cites S2).");
      expect(found[0]).not.toContain("'F2'");
      expect(found[0]).not.toContain("'F3'");
    });

    it("WT3 warns about nothing when every link to the row holder is tied", async () => {
      await setup(research({ namesakes: [], person_evidence: [standing("pe_002", "a_001", P), standing("pe_003", "a_003", W)] }));
      const r = await appendRow();
      expect(r.ok, errs(r)).toBe(true);
      expect(wn(r)).toEqual([]);
    });

    it("WT4 reads a fact's party across its record, as the cap reads the links'", async () => {
      // a_013 carries no persona id and comes from a re-extraction that set none
      // and named one principal, so recordPartyKeyer joins it to persona VP1:
      // the fact made from it holds the untied name link's party.
      const r0 = research({
        namesakes: [],
        assertions: [
          ...baseAssertions().filter((a) => !["a_010", "a_011", "a_012"].includes(a.id as string)),
          assertion("a_010", "src_002", REC.voter, "principal", "name", "John Smith", {
            record_persona_id: "VP1",
            log_entry_id: "log_001",
          }),
          assertion("a_013", "src_002", REC.voter, "principal", "occupation", "Farmer", { log_entry_id: "log_002" }),
        ],
        person_evidence: [standing("pe_001", "a_010", P)],
      });
      const t = tree();
      t.persons[0] = {
        ...person(P, "John", "Smith", "Male"),
        facts: [{ id: "F1", type: "Occupation", value: "Farmer", assertion_id: "a_013", sources: [{ ref: "S2" }] }],
      };
      await setup(r0, t);
      const r = await appendRow();
      expect(r.ok, errs(r)).toBe(true);
      expect(wn(r)).toHaveLength(1);
      expect(wn(r)[0]).toContain("'F1' Occupation (cites S2)");
    });
  });

  // ─── record_persona_ids, stamped from the row's own search (item 10) ─────────

  describe("record_persona_ids stamp (item 10)", () => {
    const log = (id: string, tool: string, resultsRef: string | null) => ({
      id, plan_item_id: null, performed: "2026-10-24", tool, query: "John Smith 1873", outcome: "positive",
      results_examined: 1, results_ref: resultsRef, results_available: 1, notes: null, external_site: null,
    });
    const SEARCH = log("log_001", "record_search", "results/log_001.json");
    /** The row's name, as a record names the namesake. */
    const JOHN_SMITH = [{ given: "John", surname: "Smith" }];
    async function setupSearch(logs: unknown[] = [SEARCH], result: Record<string, unknown> = { recordId: REC.voter, primaryId: "p_555" }) {
      await setup(research({ namesakes: [], log: logs }));
      await mkdir(join(dir, "results"), { recursive: true });
      const sidecar = { log_id: "log_001", tool: "record_search", retrieved: "2026-10-24T00:00:00Z", returned_count: 1,
        payload: { query: {}, results: [{ ...result, gedcomx: { persons: [{ id: result.primaryId, names: JOHN_SMITH }] } }] } };
      await writeFile(join(dir, "results", "log_001.json"), JSON.stringify(sidecar));
    }
    const appendRow = (extra: Record<string, unknown>) =>
      researchAppend({
        projectPath: dir, section: "namesakes", op: "append",
        entry: { person_id: P, name: ROW.name, place: ROW.place, time_period: ROW.time_period, notes: null, ...extra },
      } as any);
    const row = async () => (await readResearch()).namesakes[0];

    it("stamps the persona the row's search names, storing the record id in the sidecar's form", async () => {
      await setupSearch();
      const r = await appendRow({ record_ids: ["VOT2-002"], log_entry_ids: ["log_001"] });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_ids).toEqual([REC.voter]);
      expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
    });

    it("overwrites a stamp the caller supplies", async () => {
      await setupSearch();
      const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"], record_persona_ids: { [REC.voter]: "p_999" } });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
    });

    it("drops a supplied stamp when no sidecar names the record", async () => {
      await setupSearch();
      const r = await appendRow({ record_ids: [REC.voter], record_persona_ids: { [REC.voter]: "p_999" } });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_persona_ids).toBeUndefined();
    });

    it("accepts a row with no log_entry_ids, unstamped", async () => {
      await setupSearch();
      const r = await appendRow({ record_ids: [REC.voter] });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_persona_ids).toBeUndefined();
    });

    it("accepts a record its search's sidecar does not hold, unstamped and unchanged", async () => {
      await setupSearch();
      const r = await appendRow({ record_ids: ["DTH3-003"], log_entry_ids: ["log_001"] });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_ids).toEqual(["DTH3-003"]);
      expect((await row()).record_persona_ids).toBeUndefined();
    });

    it("accepts a row whose log entry staged no sidecar", async () => {
      await setupSearch([log("log_001", "record_search", null)]);
      const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_persona_ids).toBeUndefined();
    });

    it("stamps nothing from a full-text search, which names no persona", async () => {
      await setupSearch([log("log_001", "fulltext_search", "results/log_001.json")]);
      const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] });
      expect(r.ok, errs(r)).toBe(true);
      expect((await row()).record_persona_ids).toBeUndefined();
    });

    it("refuses an update that sets the stamp", async () => {
      await setupSearch();
      expect((await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] })).ok).toBe(true);
      const r = await researchAppend({
        projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001",
        fields: { record_persona_ids: { [REC.voter]: "p_999" } },
      } as any);
      expect(r.ok).toBe(false);
      expect(errs(r)).toContain("not updatable on 'namesakes': record_persona_ids");
    });

    it("re-stamps when an update sets record_ids, and keeps the stamp on a notes update", async () => {
      await setupSearch();
      expect((await appendRow({ record_ids: [REC.voter] })).ok).toBe(true);
      expect((await row()).record_persona_ids).toBeUndefined();
      const update = (fields: Record<string, unknown>) =>
        researchAppend({ projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields } as any);
      expect((await update({ record_ids: [REC.voter], log_entry_ids: ["log_001"] })).ok).toBe(true);
      expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
      expect((await update({ notes: "Checked again." })).ok).toBe(true);
      expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
    });

    // The hannah-earnest-children e2e run of 2026-10-30: both rows cited a
    // record_read, whose sidecar carries no primaryId, and one listed the read
    // persona's wife on the same household record. The three persona ids and
    // arks are the run's own, from its transcript.
    describe("from a record's own persons", () => {
      const ARK = (bare: string) => `ark:/61903/1:1:${bare}`;
      const HANNAH = [{ given: "Hannah", surname: "Earnest" }];
      const HANNAH_1901 = { id: "p_10259312010", ark: ARK("XS75-FJM"), names: HANNAH };
      const EDWIN = { id: "p_10257197490", ark: ARK("XS3W-W3M"), names: [{ given: "Edwin", surname: "Earnest" }] };
      const HANNAH_QB = { id: "p_10257197491", ark: ARK("XS3W-W39"), names: HANNAH };
      /** The hannah run's rows record Hannah Earnest's namesakes. */
      const appendHannah = (extra: Record<string, unknown>) => appendRow({ name: "Hannah Earnest", ...extra });
      type Sidecar = { tool: string; results: Array<Record<string, unknown>> };
      /** One log entry and sidecar per element, log_001 first. */
      async function setupSidecars(sidecars: Sidecar[]) {
        const ids = sidecars.map((_, i) => `log_00${i + 1}`);
        await setup(research({ namesakes: [], log: sidecars.map((s, i) => log(ids[i], s.tool, `results/${ids[i]}.json`)) }));
        await mkdir(join(dir, "results"), { recursive: true });
        for (const [i, { tool, results }] of sidecars.entries()) {
          const sidecar = { log_id: ids[i], tool, retrieved: "2026-10-30T00:00:00Z", returned_count: results.length,
            payload: { query: {}, results } };
          await writeFile(join(dir, "results", `${ids[i]}.json`), JSON.stringify(sidecar));
        }
      }
      const setupSidecar = (tool: string, results: Sidecar["results"]) => setupSidecars([{ tool, results }]);

      it("stamps a record_read's persona, which its sidecar names only in the record's persons", async () => {
        await setupSidecar("record_read", [{ recordId: HANNAH_1901.ark, gedcomx: { persons: [HANNAH_1901] } }]);
        const r = await appendHannah({ record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_ids).toEqual([HANNAH_1901.ark]);
        expect((await row()).record_persona_ids).toEqual({ [HANNAH_1901.ark]: HANNAH_1901.id });
      });

      it("stamps a member of the read persona's household listed by her own ark", async () => {
        await setupSidecar("record_read", [{ recordId: EDWIN.ark, gedcomx: { persons: [EDWIN, HANNAH_QB] } }]);
        const r = await appendHannah({ record_ids: [HANNAH_QB.ark], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_persona_ids).toEqual({ [HANNAH_QB.ark]: HANNAH_QB.id });
      });

      it("stamps a member of a search hit's household listed by her own ark", async () => {
        await setupSidecar("record_search", [
          { recordId: EDWIN.ark, primaryId: EDWIN.id, gedcomx: { persons: [EDWIN, HANNAH_QB] } },
        ]);
        const r = await appendHannah({ record_ids: ["XS3W-W39"], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_ids).toEqual([HANNAH_QB.ark]);
        expect((await row()).record_persona_ids).toEqual({ [HANNAH_QB.ark]: HANNAH_QB.id });
      });

      it("stamps a search hit's primaryId over a person of the record with the same ark", async () => {
        await setupSidecar("record_search", [
          { recordId: REC.voter, primaryId: "p_555", gedcomx: { persons: [
            { id: "p_555", names: JOHN_SMITH },
            { id: "p_777", ark: REC.voter, names: JOHN_SMITH },
          ] } },
        ]);
        const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
      });

      it("leaves an id on no person of the record unstamped and unchanged", async () => {
        await setupSidecar("record_read", [{ recordId: EDWIN.ark, gedcomx: { persons: [EDWIN, HANNAH_QB] } }]);
        const r = await appendRow({ record_ids: ["DTH3-003"], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_ids).toEqual(["DTH3-003"]);
        expect((await row()).record_persona_ids).toBeUndefined();
      });

      it("stores the ark form of a person with no id, and stamps nothing", async () => {
        await setupSidecar("record_read", [{ recordId: EDWIN.ark, gedcomx: { persons: [EDWIN, { ark: HANNAH_QB.ark }] } }]);
        const r = await appendRow({ record_ids: ["XS3W-W39"], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_ids).toEqual([HANNAH_QB.ark]);
        expect((await row()).record_persona_ids).toBeUndefined();
      });

      it("stores the read's own record id form, the one an assertion from it carries", async () => {
        // A fixture read can stage a bare recordId (gaetjen-namesake-confident-link log_015).
        await setupSidecar("record_read", [{ recordId: "XS75-FJM", gedcomx: { persons: [HANNAH_1901] } }]);
        const r = await appendHannah({ record_ids: [HANNAH_1901.ark], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_ids).toEqual(["XS75-FJM"]);
        expect((await row()).record_persona_ids).toEqual({ "XS75-FJM": HANNAH_1901.id });
      });

      it("stamps from a later cited log when an earlier one finds the record but names no persona, in either order", async () => {
        // The read's record names no person of the read's ark.
        const read = { tool: "record_read", results: [{ recordId: HANNAH_1901.ark, gedcomx: { persons: [] } }] };
        const search = {
          tool: "record_search",
          results: [{ recordId: HANNAH_1901.ark, primaryId: HANNAH_1901.id, gedcomx: { persons: [HANNAH_1901] } }],
        };
        for (const cited of [["log_001", "log_002"], ["log_002", "log_001"]]) {
          await setupSidecars([read, search]);
          const r = await appendHannah({ record_ids: ["XS75-FJM"], log_entry_ids: cited });
          expect(r.ok, errs(r)).toBe(true);
          expect((await row()).record_ids).toEqual([HANNAH_1901.ark]);
          expect((await row()).record_persona_ids, cited.join(", ")).toEqual({ [HANNAH_1901.ark]: HANNAH_1901.id });
        }
      });

      // #3363 Step 6b (chesworthrm, 2026-11-09): a persona is stamped only when one
      // of its names shares a given word with the row's name.
      describe("the given name check", () => {
        const searchHit = (persons: unknown[], primary: { id: string; ark: string }) =>
          setupSidecar("record_search", [{ recordId: primary.ark, primaryId: primary.id, gedcomx: { persons } }]);
        const persona = (id: string, given: string, surname: string) => ({ id, ark: ARK("XS75-FJM"), names: [{ given, surname }] });

        it("G1 leaves a row listing her husband's own record unstamped, with no birth year", async () => {
          const born1846 = [{ type: "Birth", date: "1846", standard_date: "1846" }];
          await searchHit([{ ...EDWIN, facts: born1846 }, HANNAH_QB], EDWIN);
          const r = await appendHannah({ record_ids: ["XS3W-W3M"], log_entry_ids: ["log_001"] });
          expect(r.ok, errs(r)).toBe(true);
          expect((await row()).record_ids).toEqual([EDWIN.ark]);
          expect((await row()).record_persona_ids).toBeUndefined();
          expect((await row()).birth_year).toBeUndefined();
        });

        it("G2 compares words with case, accents, dots and brackets folded", async () => {
          for (const [name, given, surname] of [
            ["Jose Garcia", "JOSÉ.", "García"],
            ["Hermann (Herman Conrad) Gaetjen", "Herman Conrad", "Gaetjen"],
          ]) {
            const p = persona("p_1", given, surname);
            await searchHit([p], p);
            const r = await appendRow({ name, record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] });
            expect(r.ok, errs(r)).toBe(true);
            expect((await row()).record_persona_ids, name).toEqual({ [p.ark]: "p_1" });
          }
        });

        it("G3 drops a Latin form of the row's given name, Maria for Mary", async () => {
          const p = persona("p_1", "Maria", "Vazsan");
          await searchHit([p], p);
          const r = await appendRow({ name: "Mary Vazsan", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] });
          expect(r.ok, errs(r)).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
        });

        it("G4 stamps neither a persona with no name nor a primaryId with no entry", async () => {
          const nameless = { id: "p_1", ark: ARK("XS75-FJM") };
          await searchHit([nameless], nameless);
          expect((await appendHannah({ record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          await searchHit([], { id: "p_2", ark: ARK("XS75-FJM") });
          expect((await appendHannah({ record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
        });

        it("G5 does not take the row's surname for a given name", async () => {
          const p = persona("p_1", "Earnest", "Smith");
          await searchHit([p], p);
          const r = await appendHannah({ record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] });
          expect(r.ok, errs(r)).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
        });

        it("G6 drops a name suffix before taking the last word as the surname", async () => {
          const smith = persona("p_1", "Smith", "Jones");
          await searchHit([smith], smith);
          expect((await appendRow({ name: "John Smith Jr", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          const john = persona("p_2", "John", "Smith");
          await searchHit([john], john);
          expect((await appendRow({ name: "John A. Smith Jr.", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [john.ark]: "p_2" });
        });

        it("G8 ignores a placeholder word in the row's name and in a persona's", async () => {
          const hannah = persona("p_1", "Hannah", "Earnest");
          await searchHit([hannah], hannah);
          expect((await appendRow({ name: "Mrs. Hannah Earnest", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [hannah.ark]: "p_1" });
          // An unnamed wife indexed as "Mrs." shares the row's placeholder, not a name.
          const mrs = persona("p_2", "Mrs.", "Earnest");
          await searchHit([mrs], mrs);
          expect((await appendRow({ name: "Mrs. Hannah Earnest", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          // A bracketed placeholder is still one, so the surname stays the last word.
          const earnest = persona("p_3", "Earnest", "Smith");
          await searchHit([earnest], earnest);
          expect((await appendRow({ name: "Hannah Earnest (Mrs.)", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
        });

        it("G9 restamps a row whose name an update changes, either way", async () => {
          const born1846 = [{ type: "Birth", date: "1846", standard_date: "1846" }];
          await searchHit([{ ...EDWIN, facts: born1846 }, HANNAH_QB], EDWIN);
          expect((await appendRow({ name: "Edwin Earnest", record_ids: ["XS3W-W3M"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [EDWIN.ark]: EDWIN.id });
          expect((await row()).birth_year).toBe(1846);
          const rename = (name: string) =>
            researchAppend({ projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { name } } as any);
          expect((await rename("Hannah Earnest")).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          expect((await row()).birth_year).toBeUndefined();
          expect((await rename("Edwin Earnest")).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [EDWIN.ark]: EDWIN.id });
          expect((await row()).birth_year).toBe(1846);
        });

        it("G10 does not read a relative named in the row's name as its given name", async () => {
          for (const name of ["Hannah Earnest (wife of Edwin Earnest)", "Hannah Earnest, widow of Edwin Earnest"]) {
            await searchHit([EDWIN, HANNAH_QB], EDWIN);
            expect((await appendRow({ name, record_ids: ["XS3W-W3M"], log_entry_ids: ["log_001"] })).ok).toBe(true);
            expect((await row()).record_persona_ids, name).toBeUndefined();
            await searchHit([EDWIN, HANNAH_QB], EDWIN);
            expect((await appendRow({ name, record_ids: ["XS3W-W39"], log_entry_ids: ["log_001"] })).ok).toBe(true);
            expect((await row()).record_persona_ids, name).toEqual({ [HANNAH_QB.ark]: HANNAH_QB.id });
          }
        });

        it("G11 counts no initial as a given word, on either side", async () => {
          const h = persona("p_1", "H.", "Smith");
          await searchHit([h], h);
          expect((await appendRow({ name: "John H. Smith", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          const john = persona("p_2", "John", "Smith");
          await searchHit([john], john);
          expect((await appendRow({ name: "J. Smith", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          await searchHit([john], john);
          expect((await appendRow({ name: "John H. Smith", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [john.ark]: "p_2" });
        });

        it('G12 reads a row written "Surname, Given"', async () => {
          for (const [name, given] of [["Earnest, Hannah", "Hannah"], ["Smith, John A.", "John"], ["Smith, John, Jr.", "John"]]) {
            const p = persona("p_1", given, "Smith");
            await searchHit([p], p);
            expect((await appendRow({ name, record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
            expect((await row()).record_persona_ids, name).toEqual({ [p.ark]: "p_1" });
          }
        });

        it("G13 drops a hyphenated surname whole, and splits a hyphenated given name", async () => {
          const smith = persona("p_1", "Smith", "Brown");
          await searchHit([smith], smith);
          expect((await appendRow({ name: "Mary Smith-Jones", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toBeUndefined();
          const jean = persona("p_2", "Jean", "Martin");
          await searchHit([jean], jean);
          expect((await appendRow({ name: "Jean-Baptiste Martin", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [jean.ark]: "p_2" });
        });

        it('G14 takes no persona recorded male for a row named "Mrs." with her husband\'s given name', async () => {
          const born1846 = [{ type: "Birth", date: "1846", standard_date: "1846" }];
          const edwin = { ...EDWIN, gender: "Male", facts: born1846 };
          for (const name of ["Mrs. Edwin Earnest", "Earnest, Mrs. Edwin", "(Mrs.) Edwin Earnest", "Hannah Earnest (Mrs. Edwin Earnest)"]) {
            await searchHit([edwin, HANNAH_QB], edwin);
            expect((await appendRow({ name, record_ids: ["XS3W-W3M"], log_entry_ids: ["log_001"] })).ok).toBe(true);
            expect((await row()).record_persona_ids, name).toBeUndefined();
            expect((await row()).birth_year, name).toBeUndefined();
          }
          // Her own persona, female, still stamps from a "Mrs." row of her own given name.
          const hannah = { ...persona("p_1", "Hannah", "Earnest"), gender: "Female" };
          await searchHit([hannah], hannah);
          expect((await appendRow({ name: "Mrs. Hannah Earnest", record_ids: ["XS75-FJM"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [hannah.ark]: "p_1" });
          // A male persona of a row not named "Mrs." still stamps.
          await searchHit([edwin, HANNAH_QB], edwin);
          expect((await appendRow({ name: "Edwin Earnest", record_ids: ["XS3W-W3M"], log_entry_ids: ["log_001"] })).ok).toBe(true);
          expect((await row()).record_persona_ids).toEqual({ [EDWIN.ark]: EDWIN.id });
        });
      });
    });

    describe("birth_year (#3363)", () => {
      const ARK = (bare: string) => `ark:/61903/1:1:${bare}`;
      const born = (year: string) => [{ type: "Birth", date: year, standard_date: year }];
      /** One log entry and sidecar per set, log_001 first, over `r`. */
      async function sidecars(sets: Array<{ tool: string; results: unknown[] }>, r: Record<string, any> = research({ namesakes: [] })) {
        const ids = sets.map((_, i) => `log_00${i + 1}`);
        await setup({ ...r, log: sets.map((s, i) => log(ids[i], s.tool, `results/${ids[i]}.json`)) });
        await mkdir(join(dir, "results"), { recursive: true });
        for (const [i, { tool, results }] of sets.entries()) {
          const sidecar = { log_id: ids[i], tool, retrieved: "2026-11-06T00:00:00Z", returned_count: results.length,
            payload: { query: {}, results } };
          await writeFile(join(dir, "results", `${ids[i]}.json`), JSON.stringify(sidecar));
        }
      }
      /** A search hit whose persona is the record's own, born in `year`. */
      const hit = (recordId: string, personaId: string, year: string | null) => ({
        recordId,
        primaryId: personaId,
        gedcomx: { persons: [{ id: personaId, ark: recordId, names: JOHN_SMITH, facts: year === null ? [] : born(year) }] },
      });
      const search = (...results: unknown[]) => [{ tool: "record_search", results }];

      it("S1 stamps the birth year of the persona the row's search names", async () => {
        await sidecars(search(hit(REC.voter, "p_555", "1796")));
        const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).birth_year).toBe(1796);
      });

      it("S2 stamps the birth year of a read household member found by her own ark", async () => {
        await sidecars([{ tool: "record_read", results: [{ recordId: ARK("XS3W-W3M"), gedcomx: { persons: [
          { id: "p_1", ark: ARK("XS3W-W3M"), names: [{ given: "Edwin", surname: "Earnest" }], facts: born("1848") },
          { id: "p_2", ark: ARK("XS3W-W39"), names: [{ given: "Hannah", surname: "Earnest" }], facts: born("1850") },
        ] } }] }]);
        const r = await appendRow({ name: "Hannah Earnest", record_ids: [ARK("XS3W-W39")], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).birth_year).toBe(1850);
      });

      it("S3 takes the earliest year when two listed records give two", async () => {
        await sidecars(search(hit(REC.voter, "p_555", "1796"), hit(REC.death, "p_556", "1790")));
        const r = await appendRow({ record_ids: [REC.voter, REC.death], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).birth_year).toBe(1790);
      });

      it("S4 stamps no year for a listed id no persona's ark matches, though a person of the row's name is there", async () => {
        await sidecars([{ tool: "record_read", results: [{ recordId: ARK("XS3W-W3M"), gedcomx: { persons: [
          { id: "p_1", ark: ARK("XS3W-W3M"), names: [{ given: "Edwin", surname: "Earnest" }] },
          { id: "p_2", ark: ARK("XS3W-W39"), names: [{ given: "John", surname: "Smith" }], facts: born("1873") },
        ] } }] }]);
        const r = await appendRow({ record_ids: ["DTH3-003"], log_entry_ids: ["log_001"] });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).birth_year).toBeUndefined();
        expect((await row()).record_persona_ids).toBeUndefined();
      });

      it("S5 overwrites a caller's year, and drops it when the persona states none", async () => {
        await sidecars(search(hit(REC.voter, "p_555", "1796")));
        expect((await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"], birth_year: 1700 })).ok).toBe(true);
        expect((await row()).birth_year).toBe(1796);
        await sidecars(search(hit(REC.voter, "p_555", null)));
        const r = await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"], birth_year: 1700 });
        expect(r.ok, errs(r)).toBe(true);
        expect((await row()).record_persona_ids).toEqual({ [REC.voter]: "p_555" });
        expect((await row()).birth_year).toBeUndefined();
      });

      it("S6 refuses an update that sets the year", async () => {
        await sidecars(search(hit(REC.voter, "p_555", "1796")));
        expect((await appendRow({ record_ids: [REC.voter], log_entry_ids: ["log_001"] })).ok).toBe(true);
        const r = await researchAppend({
          projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { birth_year: 1800 },
        } as any);
        expect(r.ok).toBe(false);
        expect(errs(r)).toContain("not updatable on 'namesakes': birth_year");
        expect((await row()).birth_year).toBe(1796);
      });

      describe("the fill in", () => {
        // The 1880 census, dated by its census fact: a namesake born 1873 was seven.
        const CENSUS_DATE = assertion("a_006", "src_001", REC.census, "head", "census", "1880", { date: "1880" });
        /** The row as a write before this change left it: stamped persona, no year. */
        const OLD_ROW = { ...ROW, log_entry_ids: ["log_001"], record_persona_ids: { [REC.voter]: "p_555" } };
        const project = (namesakes: unknown[]) => research({ namesakes, assertions: [...baseAssertions(), CENSUS_DATE] });

        it("S7 fills in an old row's year when a call links its person, and that 1880 link stands", async () => {
          await sidecars(search(hit(REC.voter, "p_555", "1873")), project([OLD_ROW]));
          await attest(["a_001", P]);
          const res = await call(link("a_001", P));
          expect(res.ok, errs(res)).toBe(true);
          expect(await row()).toEqual({ ...OLD_ROW, birth_year: 1873 });
        });

        it("G7 fills in no year from a persona of another given name, so that 1880 link stays capped", async () => {
          const edwin = hit(REC.voter, "p_555", "1873");
          edwin.gedcomx.persons[0].names = [{ given: "Edwin", surname: "Earnest" }];
          await sidecars(search(edwin), project([OLD_ROW]));
          await attest(["a_001", P]);
          const res = await call(link("a_001", P));
          expect(res.ok).toBe(false);
          expect(errs(res)).toContain("namesake(s) of");
          expect((await row()).birth_year).toBeUndefined();
        });

        it("S8 leaves a row's year as it was, and every other field of a row it fills", async () => {
          const dated = { ...OLD_ROW, birth_year: 1850, record_persona_ids: { [REC.voter]: "p_old" } };
          const undated = { ...OLD_ROW, id: "ns_002", record_persona_ids: { [REC.voter]: "p_old" } };
          // The sidecar holds the record in its bare form, under another persona.
          await sidecars(search(hit("VOT2-002", "p_555", "1873")), project([dated, undated]));
          await attest(["a_001", P]);
          const res = await call(link("a_001", P, "speculative"));
          expect(res.ok, errs(res)).toBe(true);
          const [a, b] = (await readResearch()).namesakes;
          expect(a).toEqual(dated);
          expect(b).toEqual({ ...undated, birth_year: 1873 });
        });

        it("S9 judges a call that fails for another reason on the filled-in document, and writes nothing", async () => {
          await sidecars(search(hit(REC.voter, "p_555", "1873")), project([OLD_ROW]));
          await attest(["a_001", P]);
          const res = await call(link("a_001", P), update("pe_404", { rationale: "no such link" }));
          expect(res.ok).toBe(false);
          const m = errs(res);
          expect(m).toContain("pe_404");
          expect(m).not.toContain("namesake(s) of");
          expect((await row()).birth_year).toBeUndefined();
        });

        it("S10 fills in only the rows of a person the call links", async () => {
          // Named as OLD_ROW, so the persona's name would pass for it and only its
          // person keeps it unfilled.
          const other = { ...OLD_ROW, id: "ns_002", person_id: N };
          await sidecars(search(hit(REC.voter, "p_555", "1873")), project([OLD_ROW, other]));
          await attest(["a_001", P]);
          const res = await call(link("a_001", P));
          expect(res.ok, errs(res)).toBe(true);
          const [mine, theirs] = (await readResearch()).namesakes;
          expect(mine.birth_year).toBe(1873);
          expect(theirs).toEqual(other);
        });
      });
    });
  });
});

// ─── Tree-derived namesake pairs (issue #3681) ─────────────────────────────────
//
// A father and son of one first given name, read from the tree with no row.

describe("tree-derived namesake pairs (#3681)", () => {
  const FA = "KWPP-001"; // John Pratt, the father, born 1820
  const SO = "KWPP-002"; // John Pratt, his son, born 1850
  const MO = "KWPP-003"; // Mary Pratt, the mother
  const MAR = "ark:/61903/1:1:MAR9-001"; // the son's 1871 marriage
  const OTHER = "ark:/61903/1:1:BAP9-002";
  const FS_TREE = { id: "S9", title: "FamilySearch Family Tree" };

  const fact = (type: string, date: string, extra: Record<string, unknown> = {}) => ({ id: `${type}-${date}`, type, date, ...extra });
  const fsDated = (type: string, date: string) => fact(type, date, { sources: [{ ref: "S9" }] });

  function pairTree(): Record<string, any> {
    return {
      persons: [
        person(FA, "John", "Pratt", "Male", { facts: [fsDated("Birth", "1820")] }),
        person(SO, "John", "Pratt", "Male", { facts: [fsDated("Birth", "1850")] }),
        person(MO, "Mary", "Pratt", "Female", { facts: [] }),
      ],
      relationships: [
        { id: "R1", type: "Couple", person1: FA, person2: MO },
        { id: "R2", type: "ParentChild", parent: FA, child: SO },
        { id: "R3", type: "ParentChild", parent: MO, child: SO },
      ],
      sources: [{ id: "S1", title: "Marriage" }, { id: "S2", title: "Baptism" }, FS_TREE],
    };
  }

  /** The son's 1871 marriage: the groom, 21, so born about 1850. */
  function marriageResearch(extra: Record<string, unknown> = {}): Record<string, any> {
    return research({
      namesakes: [],
      sources: [source("src_001", "S1"), source("src_002", "S2")],
      assertions: [
        assertion("a_001", "src_001", MAR, "groom", "name", "John Pratt"),
        assertion("a_002", "src_001", MAR, "groom", "age", "21"),
        assertion("a_003", "src_001", MAR, "groom", "marriage", "John Pratt and Jane Doe", { date: "12 May 1871" }),
        assertion("a_010", "src_002", OTHER, "child", "birth", "1820"),
      ],
      ...extra,
    });
  }

  describe("derivedNamesakePairs", () => {
    it("pairs a father and son of one first given name, from either side", () => {
      const t = pairTree();
      expect(derivedNamesakePairs(t, FA)).toEqual([{ personId: SO, relation: "child", sameBirthYear: false }]);
      expect(derivedNamesakePairs(t, SO)).toEqual([{ personId: FA, relation: "parent", sameBirthYear: false }]);
      expect(derivedNamesakePairs(t, MO)).toEqual([]);
    });

    it("folds accents, and skips initials and placeholder words", () => {
      const t = pairTree();
      t.persons[1].names = [{ given: "Jóhn Henry", surname: "Pratt" }];
      expect(derivedNamesakePairs(t, FA).map((q) => q.personId)).toEqual([SO]);
      t.persons[1].names = [{ given: "J. Henry", surname: "Pratt" }];
      expect(derivedNamesakePairs(t, FA)).toEqual([]);
      t.persons[1].names = [{ given: "Unknown", surname: "Pratt" }];
      expect(derivedNamesakePairs(t, FA)).toEqual([]);
    });

    it("pairs siblings through one shared parent, keeps an unknown sex and drops a known other sex", () => {
      const t = pairTree();
      t.persons.push(person("KWPP-004", "John", "Pratt", "Unknown"), person("KWPP-005", "John", "Pratt", "female"));
      t.relationships.push(
        { id: "R4", type: "ParentChild", parent: MO, child: "KWPP-004" },
        { id: "R5", type: "ParentChild", parent: MO, child: "KWPP-005" },
      );
      expect(derivedNamesakePairs(t, SO)).toEqual([
        { personId: FA, relation: "parent", sameBirthYear: false },
        { personId: "KWPP-004", relation: "sibling", sameBirthYear: false },
      ]);
    });

    it("reads past an initial to the first given name", () => {
      const t = pairTree();
      t.persons[0].names = [{ given: "J. William", surname: "Pratt" }];
      t.persons[1].names = [{ given: "William", surname: "Pratt" }];
      expect(derivedNamesakePairs(t, FA).map((q) => q.personId)).toEqual([SO]);
      t.persons[0].names = [{ given: "J. R.", surname: "Pratt" }];
      expect(derivedNamesakePairs(t, FA)).toEqual([]);
    });

    it("marks siblings born the same year, who may be one person entered twice", () => {
      const t = pairTree();
      t.persons.push(person("KWPP-004", "John", "Pratt", "Male", { facts: [fsDated("Christening", "3 Mar 1850")] }));
      t.relationships.push({ id: "R4", type: "ParentChild", parent: FA, child: "KWPP-004" });
      expect(derivedNamesakePairs(t, SO)).toContainEqual({ personId: "KWPP-004", relation: "sibling", sameBirthYear: true });
    });
  });

  it("pairRecordFacts reads the linked persona's role, a birth from a stated age, and the record's year", () => {
    const r = marriageResearch({ person_evidence: [standing("pe_001", "a_001", SO)] });
    expect(pairRecordFacts(r, r.assertions[0], SO)).toMatchObject({ role: "groom", year: 1871, birth: 1850, death: null });
    // A two-party assertion names no persona of its own: the person's one-party links say which.
    expect(pairRecordFacts(r, r.assertions[2], SO).role).toBe("groom");
    expect(pairRecordFacts(r, r.assertions[2], FA).role).toBeNull();
  });

  it("pairRecordFacts reads the linked assertion's own persona, not the person's other one on the record", () => {
    const census = research({
      namesakes: [],
      sources: [source("src_001", "S1")],
      assertions: [
        assertion("a_001", "src_001", MAR, "head", "name", "John Pratt", { record_persona_id: "p1" }),
        assertion("a_002", "src_001", MAR, "head", "age", "50", { record_persona_id: "p1" }),
        assertion("a_003", "src_001", MAR, "head", "census", "1870", { record_persona_id: "p1", date: "1870" }),
        assertion("a_004", "src_001", MAR, "son", "name", "John Pratt", { record_persona_id: "p2" }),
        assertion("a_005", "src_001", MAR, "son", "age", "20", { record_persona_id: "p2" }),
      ],
      person_evidence: [standing("pe_001", "a_001", FA), standing("pe_002", "a_002", FA), standing("pe_003", "a_004", FA)],
    });
    expect(pairRecordFacts(census, census.assertions[3], FA)).toMatchObject({ role: "son", birth: 1850 });
  });

  it("pairRecordFacts reads a year from a value's words but not from a house number", () => {
    const r = research({
      namesakes: [],
      sources: [source("src_001", "S1")],
      assertions: [
        assertion("a_001", "src_001", MAR, "head", "name", "John Pratt"),
        assertion("a_002", "src_001", MAR, "head", "residence", "1912 Oak Street, Niles"),
        assertion("a_003", "src_001", MAR, "head", "birth", "born circa 1850, Niles"),
      ],
      person_evidence: [standing("pe_001", "a_001", SO)],
    });
    expect(pairRecordFacts(r, r.assertions[0], SO)).toMatchObject({ year: 1850, birth: 1850 });
  });

  describe("an office in the pair tests (#3363)", () => {
    const TOWN = "ark:/61903/1:1:TWN9-004";
    /** A town record whose principal is a John Pratt holding an office dated
     *  `year` (unless `office` is false), beside a clerk's event of the same year
     *  (unless `event` is false), so the office need not date it. */
    function officeRecord(year: string, personId: string, opts: { office?: boolean; event?: boolean } = {}) {
      return research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", TOWN, "principal", "name", "John Pratt"),
          ...(opts.office === false
            ? []
            : [assertion("a_002", "src_001", TOWN, "principal", "office", "Constable", { date: year })]),
          ...(opts.event === false
            ? []
            : [assertion("a_003", "src_001", TOWN, "clerk", "event", "Town meeting", { date: year })]),
        ],
        person_evidence: [standing("pe_001", "a_001", personId)],
      });
    }
    const judge = (personId: string, r: any, t: any) =>
      pairJudgement(personId, r.assertions[0], derivedNamesakePairs(t, personId), r, t, null);

    it("P1 rules out a partner under 15 whom the record makes an office holder, and not one it names principal alone", () => {
      expect(judge(FA, officeRecord("1860", FA), pairTree()).ties).toEqual([{ partner: SO, relation: "child", test: "adult role" }]);
      expect(judge(FA, officeRecord("1860", FA, { office: false }), pairTree()).ties).toEqual([]);
    });

    it("P2 dates a record by its office when no other fact dates it", () => {
      const r = officeRecord("1799", FA, { event: false });
      expect(pairRecordFacts(r, r.assertions[0], FA)).toMatchObject({ role: "principal", office: true, year: 1799, dated: 1799 });
    });

    it("P3 reads an office as an adult role in the family limit", () => {
      const t = pairTree();
      t.persons[1].facts = [];
      expect(judge(FA, officeRecord("1845", FA), t).ties).toEqual([{ partner: SO, relation: "child", test: "family limit" }]);
    });
  });

  describe("independentLife (rule 3)", () => {
    const life = (p: any, r: any, t: any, start: any = null) => independentLife(p, MAR, r, t, start);

    it("counts a date the FamilySearch tree's own source carries, and a starting-tree date whatever it cites", () => {
      const t = pairTree();
      const r = marriageResearch();
      expect(life(t.persons[0], r, t)).toEqual({ birth: 1820, death: null });
      const bare = { ...t.persons[0], facts: [fact("Birth", "1820")] };
      expect(life(bare, r, t)).toEqual({ birth: null, death: null });
      expect(life(bare, r, t, { persons: [{ id: FA, facts: [fsDated("Birth", "1820")] }] })).toEqual({ birth: 1820, death: null });
    });

    it("never counts a date copied from the judged record, by its own assertion first", () => {
      const t = pairTree();
      const r = marriageResearch({
        sources: [source("src_001", "S1"), source("src_002", "S2"), source("src_003", "S3")],
        assertions: [
          ...marriageResearch().assertions,
          assertion("a_030", "src_003", MAR, "groom", "birth", "1820"),
          assertion("a_031", "src_003", OTHER, "head", "name", "John Pratt"),
        ],
      });
      const withFact = (extra: Record<string, unknown>) => ({ ...t.persons[0], facts: [fact("Birth", "1820", extra)] });
      expect(life(withFact({ assertion_id: "a_003", sources: [{ ref: "S1" }] }), r, t).birth).toBeNull();
      expect(life(withFact({ assertion_id: "a_010", sources: [{ ref: "S2" }] }), r, t).birth).toBe(1820);
      // A source spanning both records: the fact's own assertion says which record it came from.
      expect(life(withFact({ assertion_id: "a_030", sources: [{ ref: "S3" }] }), r, t).birth).toBeNull();
      expect(life(withFact({ sources: [{ ref: "S1" }] }), r, t).birth).toBeNull();
      expect(life(withFact({ sources: [{ ref: "S2" }] }), r, t).birth).toBe(1820);
      const noted = { ...t, sources: [...t.sources, { id: "S7", title: "A note the agent cited" }] };
      expect(life(withFact({ sources: [{ ref: "S7" }] }), r, noted).birth).toBeNull();
    });
  });

  describe("pairJudgement", () => {
    const judge = (personId: string, r: any, t: any, start: any = null) =>
      pairJudgement(personId, r.assertions[0], derivedNamesakePairs(t, personId), r, t, start);

    it("ties the son's marriage by age, and finds it does not fit the father", () => {
      const t = pairTree();
      const toSon = marriageResearch({ person_evidence: [standing("pe_001", "a_001", SO)] });
      expect(judge(SO, toSon, t)).toEqual({ fits: true, ties: [{ partner: FA, relation: "parent", test: "age" }], reasons: [] });
      const toFather = marriageResearch({ person_evidence: [standing("pe_001", "a_001", FA)] });
      const j = judge(FA, toFather, t);
      expect(j.fits).toBe(false);
      expect(j.ties).toEqual([]);
      expect(j.reasons[0]).toBe(`The record does not fit '${FA}' (age, family limit).`);
      expect(j.reasons[1]).toBe(
        `Nothing rules out '${SO}', '${FA}''s child of the same given name: their dates and the record's fit either of them.`,
      );
    });

    it("rules out by lifespan, by adult role, by the same record and by the family limit", () => {
      const death = (year: string) =>
        research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", MAR, "deceased", "name", "John Pratt"),
            assertion("a_002", "src_001", MAR, "deceased", "death", year),
          ],
          person_evidence: [standing("pe_001", "a_001", FA)],
        });
      const t = pairTree();
      t.persons[0].facts = [fsDated("Death", "1890")];
      t.persons[1].facts = [fsDated("Death", "1900")];
      expect(judge(FA, death("1890"), t).ties).toEqual([{ partner: SO, relation: "child", test: "lifespan" }]);

      const groom = research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", MAR, "groom", "name", "John Pratt"),
          assertion("a_002", "src_001", MAR, "groom", "marriage", "John Pratt and Ann Lee", { date: "1860" }),
        ],
        person_evidence: [standing("pe_001", "a_001", FA)],
      });
      expect(judge(FA, groom, pairTree()).ties).toEqual([{ partner: SO, relation: "child", test: "adult role" }]);

      const census = research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", MAR, "head", "name", "John Pratt", { record_persona_id: "p1" }),
          assertion("a_002", "src_001", MAR, "son", "name", "John Pratt", { record_persona_id: "p2" }),
          assertion("a_003", "src_001", MAR, "head", "census", "1860", { record_persona_id: "p1", date: "1860" }),
        ],
        person_evidence: [standing("pe_001", "a_001", FA), standing("pe_002", "a_002", SO)],
      });
      const undated = pairTree();
      undated.persons[0].facts = [];
      undated.persons[1].facts = [];
      expect(judge(FA, census, undated).ties).toEqual([{ partner: SO, relation: "child", test: "same record" }]);

      // The 1841 head, 21, was born about 1820; the son's mother was born in 1825.
      const head = research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", MAR, "head", "name", "John Pratt"),
          assertion("a_002", "src_001", MAR, "head", "age", "21"),
          assertion("a_003", "src_001", MAR, "head", "census", "1841", { date: "1841" }),
        ],
        person_evidence: [standing("pe_001", "a_001", FA)],
      });
      const mothered = pairTree();
      mothered.persons[0].facts = [];
      mothered.persons[1].facts = [];
      mothered.persons[2].facts = [fsDated("Birth", "1825")];
      expect(judge(FA, head, mothered).ties).toEqual([{ partner: SO, relation: "child", test: "family limit" }]);
    });

    it("says what is missing when nothing tells the two apart", () => {
      const t = pairTree();
      t.persons[0].facts = [];
      t.persons[1].facts = [];
      const r = marriageResearch({ person_evidence: [standing("pe_001", "a_001", SO)] });
      expect(judge(SO, r, t).reasons).toEqual([
        `Nothing rules out '${FA}', '${SO}''s parent of the same given name: '${FA}' has no birth or death year from a record other than this one.`,
      ]);
    });

    it("lets a record one year before the birth year fit, as a death one year off does, and not two", () => {
      const baptism = (year: string) =>
        research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [assertion("a_001", "src_001", OTHER, "child", "christening", year, { date: year })],
          person_evidence: [standing("pe_001", "a_001", SO)],
        });
      expect(judge(SO, baptism("1849"), pairTree())).toEqual({
        fits: true,
        ties: [{ partner: FA, relation: "parent", test: "age" }],
        reasons: [],
      });
      expect(judge(SO, baptism("1848"), pairTree()).reasons[0]).toBe(`The record does not fit '${SO}' (lifespan).`);

      const burial = (year: string) =>
        research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [assertion("a_001", "src_001", OTHER, "deceased", "burial", year, { date: year })],
          person_evidence: [standing("pe_001", "a_001", FA)],
        });
      const died = pairTree();
      died.persons[0].facts = [fsDated("Birth", "1820"), fsDated("Death", "1889")];
      expect(judge(FA, burial("1890"), died).fits).toBe(true);
      expect(judge(FA, burial("1891"), died).fits).toBe(false);
    });

    it("does not need the deceased alive at a later event of their own death or estate", () => {
      // A will proved in 1872 for the father, who died in 1870; the son lived to 1920.
      const probate = (personId: string, extra: any[] = []) =>
        research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", MAR, "testator", "name", "John Pratt"),
            assertion("a_002", "src_001", MAR, "testator", "probate", "1872", { date: "1872" }),
            ...extra,
          ],
          person_evidence: [standing("pe_001", "a_001", personId)],
        });
      const t = pairTree();
      t.persons[0].facts = [fsDated("Birth", "1820"), fsDated("Death", "1870")];
      t.persons[1].facts = [fsDated("Birth", "1850"), fsDated("Death", "1920")];
      const died = [assertion("a_003", "src_001", MAR, "testator", "death", "1870", { date: "1870" })];
      expect(judge(FA, probate(FA, died), t)).toEqual({
        fits: true,
        ties: [{ partner: SO, relation: "child", test: "lifespan" }],
        reasons: [],
      });
      // With no death on the record nothing tells them apart, and the probate rules neither out.
      expect(judge(FA, probate(FA), t).fits).toBe(true);
      expect(judge(SO, probate(SO), t).ties).toEqual([]);
    });

    it("reads a party re-extracted without persona ids as the same party, not a second one", () => {
      const t = pairTree();
      t.persons[0].facts = [];
      t.persons[1].facts = [];
      const r = research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", MAR, "groom", "name", "John Pratt", { record_persona_id: "p1", log_entry_id: "log_001" }),
          assertion("a_002", "src_001", MAR, "bride", "name", "Jane Doe", { record_persona_id: "p2", log_entry_id: "log_001" }),
          assertion("a_003", "src_001", MAR, "groom", "name", "John Pratt", { log_entry_id: "log_002" }),
        ],
        person_evidence: [standing("pe_001", "a_001", SO), standing("pe_002", "a_003", FA)],
      });
      expect(judge(SO, r, t).ties).toEqual([]);
    });

    it("refuses a record that rules every partner out but does not fit the person either", () => {
      const t = pairTree();
      t.persons[0].facts = [fsDated("Birth", "1820"), fsDated("Death", "1890")];
      const r = research({
        namesakes: [],
        sources: [source("src_001", "S1")],
        assertions: [
          assertion("a_001", "src_001", MAR, "deceased", "name", "John Pratt"),
          assertion("a_002", "src_001", MAR, "deceased", "death", "1835", { date: "1835" }),
        ],
        person_evidence: [standing("pe_001", "a_001", SO)],
      });
      const j = judge(SO, r, t);
      expect(j.fits).toBe(false);
      expect(j.ties).toEqual([{ partner: FA, relation: "parent", test: "lifespan" }]);
      expect(namesakeVerdicts(SO, r, t, { derivedPairs: true })?.verdicts.get("pe_001")?.allowed).toBe(false);
    });
  });

  describe("namesakeVerdicts with derivedPairs", () => {
    it("judges a pair member with no row only when asked to", () => {
      const r = marriageResearch({ person_evidence: [standing("pe_001", "a_001", SO)] });
      expect(namesakeVerdicts(SO, r, pairTree())).toBeNull();
      const v = namesakeVerdicts(SO, r, pairTree(), { derivedPairs: true });
      expect(v?.rows).toEqual([]);
      expect(v?.pairs.map((q) => q.personId)).toEqual([FA]);
      expect(v?.verdicts.get("pe_001")).toMatchObject({
        allowed: true,
        ties: [{ kind: "pair", partner: FA, relation: "parent", test: "age" }],
      });
    });

    it("refuses a pair member's link the tests cannot tell apart, naming the partner", () => {
      const r = marriageResearch({ person_evidence: [standing("pe_001", "a_001", FA)] });
      const verdict = namesakeVerdicts(FA, r, pairTree(), { derivedPairs: true })?.verdicts.get("pe_001");
      expect(verdict?.allowed).toBe(false);
      expect(verdict?.reasons[0]).toBe(`The record does not fit '${FA}' (age, family limit).`);
    });

    it("still asks for tie (a) or (b) when a row caps the link: a pair test says nothing about a stranger", () => {
      const r = marriageResearch({
        namesakes: [{ ...ROW, person_id: SO, record_ids: [OTHER] }],
        person_evidence: [standing("pe_001", "a_001", SO)],
      });
      const v = namesakeVerdicts(SO, r, pairTree(), { derivedPairs: true });
      expect(v?.pairs.map((q) => q.personId)).toEqual([FA]);
      expect(v?.verdicts.get("pe_001")?.allowed).toBe(false);
    });

    describe("a tie counts only when the record would not tie the partner as well", () => {
      const CEN = "ark:/61903/1:1:CEN9-003";
      /** Both Johns undated, so only a tie can tell them apart; the father's sons William and James, and the
       *  son's wife Ann. */
      function household(): Record<string, any> {
        const t = pairTree();
        t.persons[0].facts = [];
        t.persons[1].facts = [];
        t.persons.push(
          person("KWPP-006", "William", "Pratt", "Male"),
          person("KWPP-007", "James", "Pratt", "Male"),
          person("KWPP-008", "Ann", "Pratt", "Female"),
        );
        t.relationships.push(
          { id: "R6", type: "ParentChild", parent: FA, child: "KWPP-006" },
          { id: "R7", type: "ParentChild", parent: FA, child: "KWPP-007" },
          { id: "R8", type: "Couple", person1: SO, person2: "KWPP-008" },
        );
        return t;
      }
      /** An undated census, one name per entry, each linked to its person; the first is the link judged. */
      const census = (entries: Array<[role: string, name: string, personId: string]>) =>
        research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: entries.map(([role, name], i) =>
            assertion(`a_00${i + 1}`, "src_001", CEN, role, "name", name, { record_persona_id: `p${i + 1}` }),
          ),
          person_evidence: entries.map(([, , personId], i) => standing(`pe_00${i + 1}`, `a_00${i + 1}`, personId)),
        });

      it("refuses the son's entry moved to the father, tied through brothers who are the son's too", () => {
        const r = census([
          ["brother_1", "John Pratt", FA],
          ["head", "William Pratt", "KWPP-006"],
          ["brother_2", "James Pratt", "KWPP-007"],
        ]);
        const asRow = namesakeVerdicts(FA, { ...r, namesakes: [{ ...ROW, person_id: FA }] }, household());
        expect(asRow?.verdicts.get("pe_001")?.allowed).toBe(true);
        // A row holder with a namesake in the tree gets the same check.
        const both = namesakeVerdicts(FA, { ...r, namesakes: [{ ...ROW, person_id: FA }] }, household(), { derivedPairs: true });
        expect(both?.verdicts.get("pe_001")).toMatchObject({ allowed: false, blockedBy: expect.arrayContaining(["pair"]) });
        const verdict = namesakeVerdicts(FA, r, household(), { derivedPairs: true })?.verdicts.get("pe_001");
        expect(verdict?.allowed).toBe(false);
        expect(verdict?.blockedBy).toContain("pair");
        expect(verdict?.reasons).toContain(
          `Its ties cannot tell '${FA}' from '${SO}', '${FA}''s child of the same given name: the record ties '${SO}' ` +
            `as well (through 'KWPP-006', their sibling; 'KWPP-007', their sibling).`,
        );
      });

      it("keeps a tie through the son's own wife, whom the father does not share", () => {
        const r = census([
          ["head", "John Pratt", SO],
          ["wife", "Ann Pratt", "KWPP-008"],
        ]);
        expect(namesakeVerdicts(SO, r, household(), { derivedPairs: true })?.verdicts.get("pe_001")).toMatchObject({
          allowed: true,
          ties: [{ kind: "a", relative: "KWPP-008", relation: "spouse" }],
        });
      });

      it("drops a tie through the mother, whom father and son share, when the roles say nothing", () => {
        const r = census([
          ["grantor", "John Pratt", SO],
          ["witness", "Mary Pratt", MO],
        ]);
        const verdict = namesakeVerdicts(SO, r, household(), { derivedPairs: true })?.verdicts.get("pe_001");
        expect(verdict?.allowed).toBe(false);
        expect(verdict?.reasons.join(" ")).toContain(`the record ties '${FA}' as well (through '${MO}', their spouse).`);
      });

      it("takes a 'child of' naming the person along with the entry, so it cannot tie the partner through them", () => {
        const r = research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", CEN, "father_of_deceased", "name", "John Pratt", { record_persona_id: "p2" }),
            assertion("a_002", "src_001", CEN, "deceased", "name", "William Pratt", { record_persona_id: "p1" }),
            assertion("a_003", "src_001", CEN, "deceased", "relationship", "child of John Pratt", {
              record_persona_id: "p1",
              structured_value: { relationship_type: "child", related_person_role: "father_of_deceased" },
            }),
          ],
          person_evidence: [
            standing("pe_001", "a_001", FA),
            standing("pe_002", "a_002", "KWPP-006"),
            standing("pe_003", "a_003", "KWPP-006"),
            standing("pe_004", "a_003", FA),
          ],
        });
        const verdict = namesakeVerdicts(FA, r, household(), { derivedPairs: true })?.verdicts.get("pe_001");
        expect(verdict?.allowed).toBe(true);
        expect(verdict?.ties.every((t) => t.kind === "a" && t.relative === "KWPP-006" && t.relation === "child")).toBe(true);
      });

      it("reads no grandparent's role: his son, the record's father, still ties him", () => {
        const t = household();
        t.persons.push(person("KWPP-009", "Mary", "Pratt", "Female"));
        t.relationships.push({ id: "R9", type: "ParentChild", parent: SO, child: "KWPP-009" });
        const BAP = "ark:/61903/1:1:BAP9-009";
        const r = research({
          namesakes: [{ ...ROW, person_id: FA, record_ids: [OTHER] }],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", BAP, "paternal_grandfather", "name", "John Pratt", { record_persona_id: "p3" }),
            assertion("a_002", "src_001", BAP, "father_of_father", "name", "John Pratt", { record_persona_id: "p4" }),
            assertion("a_003", "src_001", BAP, "father", "name", "John Pratt", { record_persona_id: "p2" }),
            assertion("a_004", "src_001", BAP, "child", "name", "Mary Pratt", { record_persona_id: "p1" }),
          ],
          person_evidence: [
            standing("pe_001", "a_001", FA),
            standing("pe_002", "a_002", FA),
            standing("pe_003", "a_003", SO),
            standing("pe_004", "a_004", "KWPP-009"),
          ],
        });
        const v = namesakeVerdicts(FA, r, t);
        expect(v?.verdicts.get("pe_001")?.allowed).toBe(true);
        expect(v?.verdicts.get("pe_002")?.allowed).toBe(true);
      });

      it("reads no role for a link naming the person, whose own role the record does not show", () => {
        const MAR = "ark:/61903/1:1:MAR9-010";
        const r = research({
          namesakes: [{ ...ROW, person_id: SO, record_ids: [OTHER] }],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", MAR, "father_of_groom", "relationship", "John Pratt recorded as father of groom John Pratt", {
              record_persona_id: "p2",
              structured_value: { relationship_type: "parent", related_person_role: "groom" },
            }),
          ],
          person_evidence: [standing("pe_001", "a_001", SO), standing("pe_002", "a_001", FA)],
        });
        expect(namesakeVerdicts(SO, r, household())?.verdicts.get("pe_001")).toMatchObject({
          allowed: true,
          ties: [{ kind: "a", relative: FA, relation: "parent" }],
        });
      });

      it("carries the person's own entry with a statement naming them, so a daughter's marriage does not tie her brother", () => {
        // The bride's "child of John Pratt" names her father, whose own entry on the record is linked to him.
        const t = household();
        t.persons.push(person("KWPP-009", "Mary", "Pratt", "Female"));
        t.relationships.push({ id: "R9", type: "ParentChild", parent: FA, child: "KWPP-009" });
        const r = research({
          namesakes: [],
          sources: [source("src_001", "S1")],
          assertions: [
            assertion("a_001", "src_001", CEN, "father_of_bride", "name", "John Pratt", { record_persona_id: "p1" }),
            assertion("a_002", "src_001", CEN, "bride", "name", "Mary Pratt", { record_persona_id: "p2" }),
            assertion("a_003", "src_001", CEN, "bride", "relationship", "child of John Pratt", {
              record_persona_id: "p2",
              structured_value: { relationship_type: "child", related_person_role: "father_of_bride" },
            }),
          ],
          person_evidence: [standing("pe_001", "a_001", FA), standing("pe_002", "a_002", "KWPP-009"), standing("pe_003", "a_003", FA)],
        });
        expect(namesakeVerdicts(FA, r, t, { derivedPairs: true })?.verdicts.get("pe_003")?.allowed).toBe(true);
      });

      it("lets the roles tell them apart: the mother of the child is no wife of the child's", () => {
        const r = census([
          ["child", "John Pratt", SO],
          ["mother", "Mary Pratt", MO],
        ]);
        expect(namesakeVerdicts(SO, r, household(), { derivedPairs: true })?.verdicts.get("pe_001")).toMatchObject({
          allowed: true,
          ties: [{ kind: "a", relative: MO, relation: "parent" }],
        });
      });
    });
  });

  describe("the link cap, end to end", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "research-append-namesake-pairs-"));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    async function setup(r: Record<string, any>, t: Record<string, any>) {
      await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
      await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2));
    }
    async function attest(r: Record<string, any>, assertionId: string, personId: string) {
      const a = (r.assertions as any[]).find((x) => x.id === assertionId);
      await recordMatchScore(dir, {
        record_id: a.record_id,
        record_persona_id: null,
        record_role: a.record_role,
        tree_person_id: personId,
        score: 0.9,
        scorer: "familysearch",
        model: null,
        assertion_id: assertionId,
        record_source: "record_read",
        computed: "2026-10-29T00:00:00Z",
      });
    }
    const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
    const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));

    it("refuses the son's marriage on the father, and allows it on the son", async () => {
      const r = marriageResearch();
      await setup(r, pairTree());
      await attest(r, "a_001", FA);
      const refused = await call(link("a_001", FA));
      expect(refused.ok).toBe(false);
      const m = errs(refused);
      expect(m).toContain(`confidence 'probable' is not available on link 'pe_001' to '${FA}'`);
      expect(m).toContain(`'${FA}' has a namesake in the tree ('${SO}', '${FA}''s child of the same given name)`);
      expect(m).toContain(`The record does not fit '${FA}' (age, family limit).`);
      expect(m).toContain("A namesake in the tree caps this link at 'speculative'");
      expect(m).not.toContain("hand the merge to tree-edit");

      await attest(r, "a_001", SO);
      expect(errs(await call(link("a_001", SO)))).toBe("");
    });

    it("offers the merge after the speculative way out when two siblings share a birth year", async () => {
      const t = pairTree();
      t.persons.push(person("KWPP-004", "John", "Pratt", "Male", { facts: [fsDated("Birth", "1850")] }));
      t.relationships.push({ id: "R4", type: "ParentChild", parent: FA, child: "KWPP-004" });
      const r = marriageResearch();
      await setup(r, t);
      await attest(r, "a_001", SO);
      const m = errs(await call(link("a_001", SO)));
      expect(m).toContain(`Nothing rules out 'KWPP-004', '${SO}''s sibling of the same given name`);
      expect(m.indexOf("Write it as 'speculative'")).toBeLessThan(m.indexOf("hand the merge to tree-edit"));
      expect(m).toContain(`If '${SO}' and 'KWPP-004' are one person entered twice`);
    });

    it("reads no pairs on a citation or a merge, so the merge it offers stays open", async () => {
      const t = pairTree();
      t.persons.push(person("KWPP-004", "John", "Pratt", "Male", { facts: [fsDated("Birth", "1850")] }));
      t.relationships.push({ id: "R4", type: "ParentChild", parent: FA, child: "KWPP-004" });
      const r = marriageResearch({ person_evidence: [standing("pe_001", "a_001", SO)] });
      expect(namesakeVerdicts(SO, r, t, { derivedPairs: true })?.verdicts.get("pe_001")?.allowed).toBe(false);
      await setup(r, t);
      const cited = await treeEdit({
        projectPath: dir,
        ops: [{ operation: "add_fact", personId: SO, fact: { type: "Occupation", value: "Clerk", sources: [{ ref: "S1" }] } }],
      } as any);
      expect(cited.ok, errs(cited)).toBe(true);
      const merged: any = await mergeTreePersons({ projectPath: dir, merges: [["KWPP-004", SO]] });
      expect(merged.ok, errs(merged)).toBe(true);
    });
  });
});

describe("a source holding two documents (#2537 case 2)", () => {
  const DOC_1802 = "ark:/61903/1:2:DOC9-1802";
  const DOC_1862 = "ark:/61903/1:2:DOC9-1862";
  const R1802 = "ark:/61903/1:1:BUR9-1802";
  const R1862 = "ark:/61903/1:1:BUR9-1862";
  const doc = (d: string) => ({ record_document_id: d });

  /** John's 1802 burial and his son William's 1862 burial under one source,
   *  each linked to its person: mikkel-blyeberg-father's src_004. */
  function burials(keyed: { a1802: boolean; a1862: boolean }): Record<string, any> {
    return research({
      sources: [...research().sources, source("src_009", "S9")],
      assertions: [
        ...baseAssertions(),
        assertion("a_201", "src_009", R1802, "deceased", "name", "John Smith", keyed.a1802 ? doc(DOC_1802) : {}),
        assertion("a_202", "src_009", R1862, "deceased", "name", "William Smith", keyed.a1862 ? doc(DOC_1862) : {}),
      ],
      person_evidence: [standing("pe_201", "a_201", P), standing("pe_202", "a_202", C)],
    });
  }

  it("does not tie a link through a party of the source's other document", () => {
    const v = namesakeVerdicts(P, burials({ a1802: true, a1862: true }), tree())!.verdicts.get("pe_201")!;
    expect(v.allowed).toBe(false);
    expect(v.source).toBe("src_009");
    expect(v.reasons.join(" ")).toContain(`No other party of document '${DOC_1802}' of source 'src_009'`);
  });

  it("reads the source as one record while any of its assertions names no document", () => {
    const v = namesakeVerdicts(P, burials({ a1802: true, a1862: false }), tree())!.verdicts.get("pe_201")!;
    expect(v.allowed).toBe(true);
    expect(v.ties).toEqual([expect.objectContaining({ kind: "a", relative: C })]);
  });

  it("keeps the co-resident exclusion source-wide: a same-named party on the other document", () => {
    const r = research({
      sources: [...research().sources, source("src_009", "S9")],
      assertions: [
        ...baseAssertions(),
        assertion("a_201", "src_009", R1802, "head", "name", "John Smith", doc(DOC_1802)),
        assertion("a_203", "src_009", R1802, "head", "occupation", "Clerk", doc(DOC_1802)),
        assertion("a_204", "src_009", R1862, "head", "name", "John Smith", doc(DOC_1862)),
      ],
      person_evidence: [standing("pe_201", "a_201", P), standing("pe_010", "a_011", P)],
    });
    const v = namesakeVerdicts(P, r, tree())!.verdicts.get("pe_201")!;
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(" ")).toContain("its record lists another 'John Smith'");
  });

  it("keeps the created-from-this-source rule source-wide: a relative made from the source does not tie", () => {
    const t = tree();
    t.persons.push(person("I9", "Ann", "Brown", "Female", { names: [{ id: "I9-n1", given: "Ann", surname: "Brown", sources: [{ ref: "S9" }] }] }));
    t.relationships.push({ id: "R4", type: "Couple", person1: P, person2: "I9" });
    const r = research({
      sources: [...research().sources, source("src_009", "S9")],
      assertions: [
        ...baseAssertions(),
        assertion("a_201", "src_009", R1802, "groom", "name", "John Smith", doc(DOC_1802)),
        assertion("a_207", "src_009", R1802, "bride", "name", "Ann Brown", doc(DOC_1802)),
        assertion("a_202", "src_009", R1862, "deceased", "name", "William Smith", doc(DOC_1862)),
      ],
      person_evidence: [standing("pe_201", "a_201", P), standing("pe_207", "a_207", "I9")],
    });
    const v = namesakeVerdicts(P, r, t)!.verdicts.get("pe_201")!;
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(" ")).toContain("was created from this source alone");
  });

  it("keeps tie (b)'s same-source skip source-wide: the other document does not vouch", () => {
    const r = research({
      sources: [...research().sources, source("src_009", "S9")],
      assertions: [
        ...baseAssertions(),
        assertion("a_201", "src_009", R1802, "head", "name", "John Smith", doc(DOC_1802)),
        assertion("a_203", "src_009", R1802, "head", "occupation", "Clerk", doc(DOC_1802)),
        assertion("a_206", "src_009", R1862, "head", "occupation", "Clerk", doc(DOC_1862)),
      ],
      person_evidence: [standing("pe_201", "a_201", P), standing("pe_206", "a_206", P)],
    });
    const v = namesakeVerdicts(P, r, tree())!.verdicts.get("pe_201")!;
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(" ")).not.toContain("its voucher");
  });
});

// ─── The namesake age exemption (issue #3363) ─────────────────────────────────
//
// Dallan, 2026-11-05: a row does not cap a link whose record is dated less than
// 12 years after the row's birth year when the record makes the persona an adult
// (a household head, or an office). The shape is the #4208 project's: Paul
// Raymond, born 1770, and a namesake row for a Paul Raymond born 1796.

describe("namesake age exemption (#3363)", () => {
  const I1 = "I1"; // Paul Raymond, born 1770, the subject
  const I2 = "I2"; // Mary Raymond, his wife
  const I4 = "I4"; // Paul Raymond, his father, 1744 to 1828
  const I7 = "I7"; // Paul Raymond, his son, born 1796
  const CEN1800 = "ark:/61903/1:1:AGE1-800";
  const CEN1810 = "ark:/61903/1:1:AGE1-810";
  const TOWN1799 = "ark:/61903/1:1:AGE1-799";
  const TOWN1800 = "ark:/61903/1:1:AGE2-800";

  const dated = (type: string, year: string) => ({ id: `${type}-${year}`, type, date: year });
  const paul = (id: string, facts: unknown[]) => person(id, "Paul", "Raymond", "Male", { facts });

  /** I1 alone, or with his father, his son (undated with `undatedSon`) or his wife. */
  function ageTree(opts: { father?: boolean; son?: boolean; undatedSon?: boolean; wife?: boolean } = {}) {
    const persons: any[] = [paul(I1, [dated("Birth", "1770")])];
    const relationships: any[] = [];
    if (opts.father) {
      persons.push(paul(I4, [dated("Birth", "1744"), dated("Death", "1828")]));
      relationships.push({ id: "R3", type: "ParentChild", parent: I4, child: I1 });
    }
    if (opts.wife) {
      persons.push(person(I2, "Mary", "Raymond", "Female", { facts: [] }));
      relationships.push({ id: "R1", type: "Couple", person1: I1, person2: I2 });
    }
    if (opts.son || opts.undatedSon) {
      persons.push(paul(I7, opts.undatedSon ? [] : [dated("Birth", "1796")]));
      relationships.push({ id: "R5", type: "ParentChild", parent: I1, child: I7 });
      if (opts.wife) relationships.push({ id: "R6", type: "ParentChild", parent: I2, child: I7 });
    }
    return { persons, relationships, sources: [1, 2, 3, 4].map((n) => ({ id: `S${n}`, title: `Record S${n}` })) };
  }

  /** A census whose `role` is a Paul Raymond, dated by its census fact. */
  const census = (prefix: string, src: string, record: string, year: string, role = "head_of_household") => [
    assertion(`${prefix}1`, src, record, role, "name", "Paul Raymond"),
    assertion(`${prefix}2`, src, record, role, "census", year, { date: year }),
  ];
  /** A town record naming a Paul Raymond its principal: holding an office dated
   *  `office`, or at an event dated `event` with no office. */
  const town = (prefix: string, src: string, record: string, dates: { office?: string; event?: string }) => [
    assertion(`${prefix}1`, src, record, "principal", "name", "Paul Raymond"),
    ...(dates.office !== undefined
      ? [assertion(`${prefix}2`, src, record, "principal", "office", "Surveyor of Highways", { date: dates.office })]
      : []),
    ...(dates.event !== undefined
      ? [assertion(`${prefix}3`, src, record, "principal", "event", "Town meeting", { date: dates.event })]
      : []),
  ];
  const ROW_1796 = {
    id: "ns_001",
    person_id: I1,
    name: "Paul Raymond",
    place: "Bristol, Addison, Vermont, United States",
    time_period: "born 1796",
    record_ids: ["ark:/61903/1:1:MC2W-5TM"],
    birth_year: 1796,
    created: "2026-11-02",
  };

  function ageResearch(extra: Record<string, unknown> = {}): Record<string, any> {
    return research({
      sources: [1, 2, 3, 4].map((n) => source(`src_00${n}`, `S${n}`)),
      assertions: [
        ...census("a_10", "src_001", CEN1800, "1800"),
        ...census("a_11", "src_002", CEN1810, "1810"),
        ...town("a_12", "src_003", TOWN1799, { office: "5 March 1799" }),
      ],
      namesakes: [ROW_1796],
      ...extra,
    });
  }

  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-namesake-age-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  /** The tree is the starting tree too, as in a hosted project. */
  async function setup(r: Record<string, any>, t: Record<string, any>) {
    await writeProjectFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeProjectFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2));
    await writeProjectFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(t, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
  const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));
  /** A probable link of `assertionId` to `personId`, its same_person score recorded first. */
  async function raise(r: Record<string, any>, assertionId: string, personId = I1) {
    const a = (r.assertions as any[]).find((x) => x.id === assertionId);
    await recordMatchScore(dir, {
      record_id: a.record_id,
      record_persona_id: null,
      record_role: a.record_role,
      tree_person_id: personId,
      score: 0.9,
      scorer: "familysearch",
      model: null,
      assertion_id: assertionId,
      record_source: "record_read",
      computed: "2026-11-06T00:00:00Z",
    });
    return call(link(assertionId, personId));
  }
  /** The verdict on the link of `assertionId` as the project now stands, rows only. */
  async function verdictOn(assertionId: string, t: Record<string, any>, personId = I1) {
    const now = await readResearch();
    const e = (now.person_evidence as any[]).find((x) => x.assertion_id === assertionId && x.person_id === personId);
    return namesakeVerdicts(personId, now, t)?.verdicts.get(e.id);
  }

  it("T1 lifts the row on a household head's census four years after the namesake's birth", async () => {
    const r = ageResearch();
    await setup(r, ageTree());
    const res = await raise(r, "a_101");
    expect(res.ok, errs(res)).toBe(true);
    expect(await verdictOn("a_101", ageTree())).toMatchObject({
      allowed: true,
      ties: [{ kind: "age", row: "ns_001", age: 4, marker: "head_of_household" }],
      rows: [],
    });
  });

  it("T2 lifts the row on an office holder three years after the namesake's birth", async () => {
    const r = ageResearch();
    await setup(r, ageTree());
    const res = await raise(r, "a_121");
    expect(res.ok, errs(res)).toBe(true);
    expect(await verdictOn("a_121", ageTree())).toMatchObject({
      allowed: true,
      ties: [{ kind: "age", row: "ns_001", age: 3, marker: "office" }],
    });
  });

  it("T3 keeps the cap at fourteen", async () => {
    const r = ageResearch();
    await setup(r, ageTree());
    const res = await raise(r, "a_111");
    expect(res.ok).toBe(false);
    expect(errs(res)).toContain(`namesake(s) of '${I1}' are recorded (ns_001: Paul Raymond`);
  });

  it("T3b lifts the row at eleven and keeps the cap at twelve", async () => {
    for (const [year, lifts] of [["1807", true], ["1808", false]] as const) {
      const r = ageResearch({ assertions: census("a_10", "src_001", CEN1800, year) });
      await setup(r, ageTree());
      const res = await raise(r, "a_101");
      expect(res.ok, `${year}: ${errs(res)}`).toBe(lifts);
      if (lifts) {
        expect((await verdictOn("a_101", ageTree()))?.ties, year).toEqual([
          { kind: "age", row: "ns_001", age: 11, marker: "head_of_household" },
        ]);
      } else {
        expect(errs(res), year).toContain(`namesake(s) of '${I1}' are recorded (ns_001: Paul Raymond`);
      }
    }
  });

  it("T4 keeps the cap on a principal with no office, whose record says nothing of age", async () => {
    const r = ageResearch({
      assertions: [...ageResearch().assertions, ...town("a_13", "src_004", TOWN1800, { event: "1800" })],
    });
    await setup(r, ageTree());
    const res = await raise(r, "a_131");
    expect(res.ok).toBe(false);
    expect(errs(res)).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);
  });

  it("T4b keeps the cap on a principal when the office on the record is another party's", async () => {
    const r = ageResearch({
      assertions: [
        ...ageResearch().assertions,
        ...town("a_14", "src_004", TOWN1800, { event: "1799" }),
        assertion("a_145", "src_004", TOWN1800, "town_clerk", "name", "Elijah Hill"),
        assertion("a_146", "src_004", TOWN1800, "town_clerk", "office", "Town Clerk", { date: "1799" }),
      ],
    });
    await setup(r, ageTree());
    const res = await raise(r, "a_141");
    expect(res.ok).toBe(false);
    expect(errs(res)).toContain(`namesake(s) of '${I1}' are recorded (ns_001: Paul Raymond`);
  });

  it("T5 keeps the cap when the row has no birth year", async () => {
    const { birth_year: _none, ...unborn } = ROW_1796;
    const r = ageResearch({ namesakes: [unborn] });
    await setup(r, ageTree());
    const res = await raise(r, "a_101");
    expect(res.ok).toBe(false);
    expect(errs(res)).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);
  });

  it("T6 reads a numbered household head, a head and a self as household heads", async () => {
    for (const [role, marker] of [
      ["head_of_household_2", "head_of_household"],
      ["head", "head"],
      ["self", "self"],
    ]) {
      const r = ageResearch({ assertions: census("a_10", "src_001", CEN1800, "1800", role) });
      await setup(r, ageTree());
      const res = await raise(r, "a_101");
      expect(res.ok, `${role}: ${errs(res)}`).toBe(true);
      expect((await verdictOn("a_101", ageTree()))?.ties, role).toEqual([{ kind: "age", row: "ns_001", age: 4, marker }]);
    }
  });

  it("T7 keeps the cap while another row still caps, and names only that row", async () => {
    const older = { ...ROW_1796, id: "ns_002", time_period: "born 1750", birth_year: 1750 };
    const r = ageResearch({ namesakes: [ROW_1796, older] });
    await setup(r, ageTree());
    const res = await raise(r, "a_101");
    expect(res.ok).toBe(false);
    const m = errs(res);
    expect(m).toContain(`namesake(s) of '${I1}' are recorded (ns_002: Paul Raymond`);
    expect(m).not.toContain("ns_001");
  });

  describe("T8, the #4208 case: a father and a son of the same name in the tree", () => {
    it("T8a refuses all three while the father may be the persona, naming him and no row on the two the row lets go", async () => {
      const t = ageTree({ father: true, son: true });
      const r = ageResearch();
      for (const id of ["a_101", "a_121"]) {
        await setup(r, t);
        const res = await raise(r, id);
        expect(res.ok, id).toBe(false);
        const m = errs(res);
        expect(m, id).toContain(`'${I1}' has a namesake in the tree (`);
        expect(m, id).toContain(`Nothing rules out '${I4}', '${I1}''s parent of the same given name`);
        expect(m, id).not.toContain(`Nothing rules out '${I7}'`);
        expect(m, id).not.toContain("ns_001");
      }
      await setup(r, t);
      const later = await raise(r, "a_111");
      expect(later.ok).toBe(false);
      expect(errs(later)).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);
    });

    it("T8b lifts the 1800 and 1799 links once the father is not the subject's parent, and keeps 1810 capped", async () => {
      const t = ageTree({ son: true });
      const r = ageResearch();
      await setup(r, t);
      for (const id of ["a_101", "a_121"]) {
        const res = await raise(r, id);
        expect(res.ok, `${id}: ${errs(res)}`).toBe(true);
      }
      const later = await raise(r, "a_111");
      expect(later.ok).toBe(false);
      expect(errs(later)).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);
      const now = await readResearch();
      const v = namesakeVerdicts(I1, now, t, { derivedPairs: true, startingTree: t });
      for (const id of ["a_101", "a_121"]) {
        const e = (now.person_evidence as any[]).find((x) => x.assertion_id === id);
        expect(v?.verdicts.get(e.id), id).toMatchObject({
          allowed: true,
          ties: [{ kind: "pair", partner: I7, relation: "child", test: "adult role" }],
          rows: [],
        });
      }
    });
  });

  it("T9 lets an exempt link vouch for nothing: a capped link sharing its occupation stays capped", async () => {
    const r = ageResearch({
      assertions: [
        ...ageResearch().assertions,
        assertion("a_103", "src_001", CEN1800, "head_of_household", "occupation", "Farmer"),
        assertion("a_113", "src_002", CEN1810, "head_of_household", "occupation", "Farmer"),
      ],
      person_evidence: [standing("pe_001", "a_101", I1), standing("pe_002", "a_103", I1)],
    });
    await setup(r, ageTree());
    expect((await verdictOn("a_101", ageTree()))?.allowed).toBe(true);
    const res = await raise(r, "a_111");
    expect(res.ok).toBe(false);
    expect(errs(res)).toContain(
      "The occupation 'farmer' on this source matches no record linked to 'I1' at 'probable' or better before this " +
        "call that is itself tied (its voucher 'pe_002' is not tied).",
    );
    // Every link judged, as the copy gate and the row warning judge them: the
    // exempt link's own exemption is read, and it still grounds nothing.
    const all = { ...r, person_evidence: [...r.person_evidence, standing("pe_003", "a_111", I1)] };
    const verdicts = namesakeVerdicts(I1, all, ageTree())?.verdicts;
    expect(verdicts?.get("pe_002")?.ties).toEqual([{ kind: "age", row: "ns_001", age: 4, marker: "head_of_household" }]);
    expect(verdicts?.get("pe_003")?.allowed).toBe(false);
  });

  it("T10 judges a partner by ties alone: a row of his the record would lift does not take the person's tie", async () => {
    const t = ageTree({ wife: true, undatedSon: true });
    const r = ageResearch({
      assertions: [
        ...census("a_10", "src_001", CEN1800, "1800"),
        assertion("a_104", "src_001", CEN1800, "wife", "name", "Mary Raymond"),
      ],
      namesakes: [{ ...ROW_1796, person_id: I7, time_period: "born 1795", birth_year: 1795 }],
      person_evidence: [standing("pe_001", "a_104", I2)],
    });
    await setup(r, t);
    const res = await raise(r, "a_101");
    expect(res.ok, errs(res)).toBe(true);
  });

  it("T11 dates the record by its own dated facts, never the source's date", async () => {
    const SPAN = "ark:/61903/1:1:AGE3-771";
    const undatedOffice = assertion("a_142", "src_004", SPAN, "principal", "office", "Surveyor of Highways");
    const withSource = (assertions: Record<string, unknown>[], birthYear: number) => {
      const r = ageResearch({ assertions, namesakes: [{ ...ROW_1796, birth_year: birthYear }] });
      r.sources[3].citation_detail.when_created = "entries dated 1771, 1783, 1794, and 1799";
      return r;
    };
    const name = assertion("a_141", "src_004", SPAN, "principal", "name", "Paul Raymond");

    // Undated facts: the source's "1771" would make a namesake born 1765 six.
    const undated = withSource([name, undatedOffice], 1765);
    await setup(undated, ageTree());
    const refused = await raise(undated, "a_141");
    expect(refused.ok).toBe(false);
    expect(errs(refused)).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);

    // Dated facts from 1771 to 1799: the record is dated by the latest.
    const span = [
      name,
      { ...undatedOffice, date: "1799" },
      assertion("a_143", "src_004", SPAN, "clerk", "event", "Town meeting", { date: "1771" }),
    ];
    const old = withSource(span, 1765);
    await setup(old, ageTree());
    expect((await raise(old, "a_141")).ok).toBe(false);
    const young = withSource(span, 1790);
    await setup(young, ageTree());
    const lifted = await raise(young, "a_141");
    expect(lifted.ok, errs(lifted)).toBe(true);
    expect((await verdictOn("a_141", ageTree()))?.ties).toEqual([{ kind: "age", row: "ns_001", age: 9, marker: "office" }]);
  });

  it("T12 dates the record by its events, never by a birth or christening the household lists", async () => {
    // A census a Paul Raymond heads, with a younger brother born or christened in
    // 1800. Undated, it could be any year he headed it in; the brother's date
    // would make the namesake (born 1796) four.
    const CEN = "ark:/61903/1:1:AGE4-800";
    const household = (brother: string, censusDate?: string) => [
      assertion("a_151", "src_004", CEN, "head_of_household", "name", "Paul Raymond"),
      assertion("a_152", "src_004", CEN, "head_of_household", "census", "", censusDate ? { date: censusDate } : {}),
      assertion("a_153", "src_004", CEN, "brother", "name", "John Raymond"),
      assertion("a_154", "src_004", CEN, "brother", brother, "", { date: "1800" }),
    ];
    for (const brother of ["birth", "christening"]) {
      const undated = ageResearch({ assertions: household(brother) });
      await setup(undated, ageTree());
      const refused = await raise(undated, "a_151");
      expect(refused.ok, brother).toBe(false);
      expect(errs(refused), brother).toContain(`namesake(s) of '${I1}' are recorded (ns_001`);
    }
    // The census fact dated 1800 dates it: the namesake was four.
    const dated = ageResearch({ assertions: household("birth", "1800") });
    await setup(dated, ageTree());
    const lifted = await raise(dated, "a_151");
    expect(lifted.ok, errs(lifted)).toBe(true);
    expect((await verdictOn("a_151", ageTree()))?.ties).toEqual([
      { kind: "age", row: "ns_001", age: 4, marker: "head_of_household" },
    ]);
  });
});
