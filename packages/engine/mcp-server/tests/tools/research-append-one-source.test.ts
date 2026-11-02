import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Offline: an appended assertion with a place would otherwise geocode live.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import { researchAppend } from "../../src/tools/research-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

// research_append refuses a call whose person_evidence appends link assertions
// from more than one source (issue #3544). One source per call, all-or-nothing
// within it.

const P = "KWCB-111"; // John Smith
const W = "KWCB-222"; // Mary Smith, his wife

const REC = {
  census: "ark:/61903/1:1:CEN1-001",
  voter: "ark:/61903/1:1:VOT2-002",
  probate: "ark:/61903/1:1:PRB3-003",
  groom: "ark:/61903/1:1:GRM6-061",
  bride: "ark:/61903/1:1:BRD6-062",
  loose: "ark:/61903/1:1:LSE9-009",
};

function assertion(id: string, sourceId: string | null, recordId: string, role: string, factType: string, value: string) {
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
      when_accessed: "2026-10-22",
      where: "Ohio",
      where_within: "page 1",
    },
    source_classification: "original",
    repository: "FamilySearch",
    access_date: "2026-10-22",
  };
}

function baseAssertions(): Record<string, any>[] {
  return [
    assertion("a_001", "src_001", REC.census, "head", "name", "John Smith"),
    assertion("a_002", "src_001", REC.census, "wife", "name", "Mary Smith"),
    assertion("a_010", "src_002", REC.voter, "principal", "name", "John Smith"),
    assertion("a_020", "src_003", REC.probate, "decedent", "name", "John Smith"),
    // One marriage, each party on its own record id, under one source.
    assertion("a_050", "src_006", REC.groom, "groom", "name", "John Smith"),
    assertion("a_051", "src_006", REC.bride, "bride", "name", "Mary Smith"),
  ];
}

function research(extra: Record<string, unknown> = {}): Record<string, any> {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [1, 2, 3, 6].map((n) => source(`src_00${n}`, `S${n}`)),
    assertions: baseAssertions(),
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

function tree(): Record<string, any> {
  return {
    persons: [
      { id: P, gender: "Male", names: [{ id: `${P}-n1`, given: "John", surname: "Smith" }] },
      { id: W, gender: "Female", names: [{ id: `${W}-n1`, given: "Mary", surname: "Smith" }] },
    ],
    relationships: [{ id: "R1", type: "Couple", person1: P, person2: W }],
    sources: [1, 2, 3, 6].map((n) => ({ id: `S${n}`, title: `Record S${n}` })),
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
function standing(id: string, assertionId: string, personId: string, confidence = "speculative") {
  return { id, assertion_id: assertionId, person_id: personId, confidence, rationale: "an earlier link", created: "2026-10-01", superseded_by: null };
}

describe("one source per person_evidence call", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-one-source-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(r: Record<string, any> = research()) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree(), null, 2));
  }
  const rawResearch = () => readFile(join(dir, "research.json"), "utf-8");

  /** Record the same_person score the score gate asks of every scored link. */
  async function attest(r: Record<string, any>, ...pairs: Array<[string, string]>) {
    for (const [assertionId, personId] of pairs) {
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
        computed: "2026-10-22T00:00:00Z",
      });
    }
  }
  const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
  const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));
  const ONE_SOURCE = "Send one research_append call per source";

  it("A1 refuses appends from two sources, names both with their ops, and writes nothing", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_001", P], ["a_010", P]);
    const before = await rawResearch();
    const r = await call(link("a_001", P), link("a_010", P));
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain("from 2 sources: 'src_001' (ops 0); 'src_002' (ops 1)");
    expect(errs(r)).toContain(ONE_SOURCE);
    expect(await rawResearch()).toBe(before);
  });

  it("A1b refuses three sources, interleaved", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_001", P], ["a_010", P], ["a_020", P], ["a_002", W]);
    const r = await call(link("a_001", P), link("a_010", P), link("a_002", W), link("a_020", P));
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain("from 3 sources: 'src_001' (ops 0, 2); 'src_002' (ops 1); 'src_003' (ops 3)");
  });

  it("A1c counts a source-less assertion by its bare record id", async () => {
    const r0 = research({ assertions: [...baseAssertions(), assertion("a_090", null, REC.loose, "principal", "name", "John Smith")] });
    await setup(r0);
    await attest(r0, ["a_001", P], ["a_090", P]);
    const r = await call(link("a_001", P), link("a_090", P));
    expect(r.ok).toBe(false);
    expect(errs(r)).toContain(`'${REC.loose}' (ops 1)`);
  });

  it("A2 a first batch per source, one call each, on a project with no links", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_001", P], ["a_002", W], ["a_010", P]);
    const first = await call(link("a_001", P), link("a_002", W));
    expect(first.ok, errs(first)).toBe(true);
    const second = await call(link("a_010", P));
    expect(second.ok, errs(second)).toBe(true);
    expect(JSON.parse(await rawResearch()).person_evidence).toHaveLength(3);
  });

  it("A3 one source whose parties sit on separate record ids goes in one call", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_050", P], ["a_051", W]);
    const r = await call(link("a_050", P), link("a_051", W));
    expect(r.ok, errs(r)).toBe(true);
  });

  it("A4 one source-less record cited under two ARK spellings is one source", async () => {
    const r0 = research({
      assertions: [
        ...baseAssertions(),
        assertion("a_090", null, REC.loose, "principal", "name", "John Smith"),
        assertion("a_091", null, "1:1:LSE9-009", "principal", "residence", "Ohio"),
      ],
    });
    await setup(r0);
    await attest(r0, ["a_090", P], ["a_091", P]);
    const r = await call(link("a_090", P), link("a_091", P));
    expect(r.ok, errs(r)).toBe(true);
  });

  it("A6 updates across two sources are not counted", async () => {
    const r0 = research({ person_evidence: [standing("pe_001", "a_001", P), standing("pe_002", "a_010", P)] });
    await setup(r0);
    const r = await call(update("pe_001", { rationale: "re-read" }), update("pe_002", { rationale: "re-read" }));
    expect(r.ok, errs(r)).toBe(true);
  });

  it("A6b an update on one source rides with appends on another", async () => {
    const r0 = research({ person_evidence: [standing("pe_001", "a_001", P)] });
    await setup(r0);
    await attest(r0, ["a_010", P]);
    const r = await call(update("pe_001", { rationale: "re-read" }), link("a_010", P));
    expect(r.ok, errs(r)).toBe(true);
  });

  it("A7 extraction_append's attachment links are exempt", async () => {
    await setup();
    const attach = (assertionId: string) => ({
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: assertionId, person_id: P, confidence: "speculative", match_score: null, rationale: ATTACHMENT_LINK_RATIONALE },
    });
    const r = await researchAppend({ projectPath: dir, ops: [attach("a_001"), attach("a_010")] } as any, {
      allowedSections: new Set(["person_evidence"]),
      toolName: "extraction_append",
      attachmentLink: true,
    });
    expect(r.ok, errs(r)).toBe(true);
  });

  it("A8 one source's links mixed with another section's op", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_001", P]);
    const r = await call(link("a_001", P), {
      section: "hypotheses",
      op: "append",
      entry: {
        claim: "John Smith of the census is the voter",
        status: "active",
        supporting_assertion_ids: [],
        contradicting_assertion_ids: [],
        ruled_out: false,
        related_question_ids: [],
      },
    });
    expect(r.ok, errs(r)).toBe(true);
  });

  it.each([
    ["only the voter record", [], true],
    ["the census materialized onto it first", [{ id: "I1-f1", type: "Residence", value: "Ohio", sources: [{ ref: "S1" }] }], false],
  ])("A5 an unscored link to a stub made from the voter record, when the stub carries %s", async (_label, facts, ok) => {
    const stub = { id: "I1", gender: "Male", names: [{ id: "I1-n1", given: "John", surname: "Smith", sources: [{ ref: "S2" }] }], facts };
    const t = tree();
    t.persons.push(stub);
    await writeFile(join(dir, "research.json"), JSON.stringify(research(), null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2));
    const r = await call(link("a_010", "I1"));
    expect(r.ok, errs(r)).toBe(ok);
  });

  it("A9 a link whose assertion is appended later in the same call is not counted", async () => {
    const r0 = research();
    await setup(r0);
    await attest(r0, ["a_001", P]);
    const r = await call(link("a_001", P), link("a_052", P), {
      section: "assertions",
      op: "append",
      entry: (({ id: _id, ...rest }) => rest)(assertion("x", "src_002", REC.voter, "principal", "residence", "Ohio")),
    });
    // Refused, but by the existing same-call score gate, not by this rule.
    expect(errs(r)).not.toContain(ONE_SOURCE);
    expect(errs(r)).toContain("is created by this same call");
  });
});
