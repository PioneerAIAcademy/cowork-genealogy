import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
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
          "before this call (a link cannot vouch in the call that writes it).",
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
    const residencePair = (value: string, censusPlace: string, voterPlace: string) =>
      research({
        assertions: [
          ...baseAssertions().filter((a) => a.id !== "a_005" && a.id !== "a_012"),
          assertion("a_005", "src_001", REC.census, "head", "residence", value, { place: censusPlace }),
          assertion("a_012", "src_002", REC.voter, "principal", "residence", value, { place: voterPlace }),
        ],
        person_evidence: [standing("pe_001", "a_012", P)],
      });

    it.each([
      ["a date", "1 June 1880", NILES, NILES],
      ["the town its place names", "Niles, Trumbull, Ohio", "Niles, Trumbull, Ohio", "Niles, Trumbull, Ohio"],
      ["a village name with differing places", "Lidečko", "Lidečko, Zlín, Czech Republic", "Vsetín, Zlín, Czech Republic"],
      ["a town, a county and a year", "Niles, Trumbull, 1880", NILES, NILES],
    ])("refuses a residence tie on %s", async (_label, value, censusPlace, voterPlace) => {
      await setup(residencePair(value, censusPlace, voterPlace));
      await attest(["a_001", P]);
      const r = await call(link("a_001", P));
      expect(r.ok).toBe(false);
      expect(capErrors(r)).toHaveLength(1);
    });

    it("refuses an occupation tie read from an unlinked assertion of the voucher's persona", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_010", P)] }));
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

    it("through his wife on the same census", async () => {
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

    it("on a street address a link written before this call already carries", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_012", P)] }));
      await attest(["a_001", P]);
      await ok(await call(link("a_001", P)));
    });

    it("S10 on an occupation a link written before this call already carries", async () => {
      await setup(research({ person_evidence: [standing("pe_001", "a_011", P)] }));
      await attest(["a_001", P]);
      await ok(await call(link("a_001", P)));
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
});
