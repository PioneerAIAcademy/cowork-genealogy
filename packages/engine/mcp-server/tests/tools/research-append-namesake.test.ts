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

import { researchAppend } from "../../src/tools/research-append.js";
import { extractionAppend } from "../../src/tools/extraction-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";

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
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
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
        matched: true,
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
        matched: true,
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

    it("C7 an occupation matched only by a record linked in the same call", async () => {
      await setup();
      await attest(["a_011", P], ["a_001", P]);
      const r = await call(link("a_011", P), link("a_001", P));
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
        matched: true,
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
      ["superseded", [link("a_011", P, "speculative"), update("pe_001", { superseded_by: "pe_002" })], "pe_003"],
      ["lowered to speculative", [update("pe_001", { confidence: "speculative" })], "pe_002"],
    ])("refuses an occupation tie whose voucher is %s in the same call", async (_label, ops, linkId) => {
      await setup(research({ person_evidence: [standing("pe_001", "a_011", P)] }));
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
    async function setupSearch(logs: unknown[] = [SEARCH], result: Record<string, unknown> = { recordId: REC.voter, primaryId: "p_555" }) {
      await setup(research({ namesakes: [], log: logs }));
      await mkdir(join(dir, "results"), { recursive: true });
      const sidecar = { log_id: "log_001", tool: "record_search", retrieved: "2026-10-24T00:00:00Z", returned_count: 1,
        payload: { query: {}, results: [{ ...result, gedcomx: { persons: [{ id: result.primaryId }] } }] } };
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
  });
});
