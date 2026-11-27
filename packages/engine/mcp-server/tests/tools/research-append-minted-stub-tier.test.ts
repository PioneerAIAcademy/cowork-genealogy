import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import { researchAppend } from "../../src/tools/research-append.js";

// Issue #4749 (ut_person_evidence_014, _wfh): a person minted from a record is
// the persona that record names, so every one-party fact of that persona is
// linked to it at `probable`. Shaped on flynn-stub-needed: Thomas Flynn's will
// names "my son James Flynn" (heir_2), James is minted from it as I4.

const PATRICK = "KWCB-100"; // a starting-tree person
const WILL = "ark:/61903/1:1:WILL-001";
const OTHER = "ark:/61903/1:1:CENS-002";

function assertion(id: string, sourceId: string, recordId: string, role: string, factType: string, value: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    source_id: sourceId,
    record_id: recordId,
    record_role: role,
    fact_type: factType,
    value,
    information_quality: "primary",
    informant: "Thomas Flynn (testator)",
    informant_proximity: "household_member",
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
    citation_detail: { who: "Clerk", what: `Record ${id}`, when_created: "1871", when_accessed: "2026-11-27", where: "Schuylkill", where_within: "page 1" },
    source_classification: "original",
    repository: "FamilySearch",
    access_date: "2026-11-27",
  };
}

const JAMES = { given: "James", surname: "Flynn" };

function research(extra: Record<string, unknown> = {}, assertionOverrides: Record<string, Record<string, unknown>> = {}): Record<string, any> {
  const all = [
    assertion("a_004", "src_004", WILL, "heir_1", "relationship", "Named as 'my son Patrick Flynn'", {
      structured_value: { relationship_type: "son", related_person_role: "testator" },
    }),
    assertion("a_005", "src_004", WILL, "heir_2", "name", "James Flynn", { structured_value: JAMES }),
    assertion("a_006", "src_004", WILL, "heir_2", "residence", "Schuylkill County", { place: "Schuylkill County, Pennsylvania" }),
    assertion("a_007", "src_004", WILL, "heir_3", "name", "Mary Flynn", { structured_value: { given: "Mary", surname: "Flynn" } }),
    assertion("a_008", "src_005", OTHER, "son", "name", "James Flynn", { structured_value: JAMES }),
    assertion("a_009", "src_004", WILL, "heir_2", "relationship", "Named as 'my son James Flynn'", {
      structured_value: { relationship_type: "son", related_person_role: "testator" },
    }),
  ].map((a) => ({ ...a, ...(assertionOverrides[a.id] ?? {}) }));
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [{ id: "log_001", plan_item_id: null, performed: "2026-11-27T00:00:00Z", tool: "fulltext_search", query: {}, outcome: "positive", results_examined: 1, external_site: null, results_ref: null }],
    sources: [source("src_004", "S4"), source("src_005", "S5")],
    assertions: all,
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...extra,
  };
}

/** I4 minted from the will (its only ref is S4); `refs` moves it elsewhere. */
function tree(refs: string[] = ["S4"], name = JAMES): Record<string, any> {
  return {
    persons: [
      { id: PATRICK, gender: "Male", names: [{ id: "N1", given: "Patrick", surname: "Flynn" }] },
      { id: "I4", gender: "Unknown", names: [{ id: "N4", ...name, sources: refs.map((r) => ({ ref: r })) }] },
    ],
    relationships: [],
    sources: [
      { id: "S4", title: "Schuylkill County probate records", url: `https://www.familysearch.org/${WILL}` },
      { id: "S5", title: "1880 census", url: `https://www.familysearch.org/${OTHER}` },
    ],
  };
}

const startingTree = {
  persons: [{ id: PATRICK, gender: "Male", names: [{ id: "N1", given: "Patrick", surname: "Flynn" }] }],
  relationships: [],
  sources: [],
};

const link = (assertionId: string, personId: string, confidence: string, extra: Record<string, unknown> = {}) => ({
  section: "person_evidence",
  op: "append",
  entry: { assertion_id: assertionId, person_id: personId, confidence, match_score: null, rationale: "The will names my son James Flynn.", superseded_by: null, ...extra },
});

const RULE = /was minted from this record's/;

describe("research_append — a stub's own record links it at probable (#4749)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-minted-tier-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(r: Record<string, any> = research(), t: Record<string, any> = tree()) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2));
    await writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(startingTree, null, 2));
  }
  const call = (...ops: unknown[]) => researchAppend({ projectPath: dir, ops } as any);
  const errs = (r: any) => (r.ok ? "" : (r.errors as string[]).join("\n"));

  it("refuses the stub's own name at speculative, saying where the doubt goes", async () => {
    await setup();
    const r = await call(link("a_005", "I4", "speculative"));
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(RULE);
    expect(errs(r)).toMatch(/goes in the rationale/);
  });

  it("refuses it at confident, saying what opens confident", async () => {
    await setup();
    const r = await call(link("a_005", "I4", "confident"));
    expect(errs(r)).toMatch(RULE);
    expect(errs(r)).toMatch(/second record is linked and materialized/);
  });

  it("accepts it at probable", async () => {
    await setup();
    expect(errs(await call(link("a_005", "I4", "probable")))).toBe("");
  });

  it("refuses another one-party fact of the same persona at speculative (the wfh shape)", async () => {
    await setup();
    expect(errs(await call(link("a_006", "I4", "speculative")))).toMatch(RULE);
  });

  it("accepts the persona's name and facts together at probable", async () => {
    await setup();
    expect(errs(await call(link("a_005", "I4", "probable"), link("a_006", "I4", "probable")))).toBe("");
  });

  it("still judges a name assertion whose structured_value is null, by its value", async () => {
    await setup(research({}, { a_005: { structured_value: null } }));
    expect(errs(await call(link("a_005", "I4", "speculative")))).toMatch(RULE);
  });

  // ut_person_evidence_c4q's shape: with no baseline, a pre-existing person whose
  // other refs no research source cites reads as minted from the record.
  it("is silent when the project has no starting-tree baseline", async () => {
    await setup();
    await rm(join(dir, "starting-tree.gedcomx.json"));
    expect(errs(await call(link("a_005", "I4", "speculative")))).not.toMatch(RULE);
  });

  // A census role several people share names more than one person.
  it("is silent when the record gives the stub's role more than one name", async () => {
    await setup(research({}, { a_007: { record_role: "heir_2" } }));
    expect(errs(await call(link("a_006", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("reads the persona by record_persona_id when the assertions carry one", async () => {
    await setup(research({}, {
      a_005: { record_persona_id: "P2" },
      a_006: { record_persona_id: "P2" },
      a_007: { record_role: "heir_2", record_persona_id: "P3" },
    }));
    expect(errs(await call(link("a_006", "I4", "speculative")))).toMatch(RULE);
  });

  it("is silent on another persona's fact that shares the stub's role", async () => {
    await setup(research({}, {
      a_005: { record_persona_id: "P2" },
      a_006: { record_persona_id: "P3" },
      a_007: { record_role: "heir_2", record_persona_id: "P3" },
    }));
    expect(errs(await call(link("a_006", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("matches a value that carries the name's suffix", async () => {
    await setup(
      research({}, { a_005: { structured_value: null, value: "James Flynn Jr." } }),
      { ...tree(), persons: [tree().persons[0], { ...tree().persons[1], names: [{ id: "N4", given: "James", surname: "Flynn", suffix: "Jr.", sources: [{ ref: "S4" }] }] }] },
    );
    expect(errs(await call(link("a_005", "I4", "speculative")))).toMatch(RULE);
  });

  it("matches a structured value that holds the given name only", async () => {
    await setup(research({}, { a_005: { structured_value: { given: "James" } } }));
    expect(errs(await call(link("a_005", "I4", "speculative")))).toMatch(RULE);
  });

  it("reads two ARK spellings of one record as one record", async () => {
    await setup(research({}, { a_006: { record_id: `https://www.familysearch.org/${WILL}` } }));
    expect(errs(await call(link("a_005", "I4", "speculative")))).toMatch(RULE);
  });

  it("is silent on a two-party assertion of the same persona", async () => {
    await setup();
    expect(errs(await call(link("a_009", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("is silent on another persona of the same record whose name differs", async () => {
    await setup();
    expect(errs(await call(link("a_007", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("is silent on a person minted from another record", async () => {
    await setup(research(), tree(["S5"]));
    expect(errs(await call(link("a_005", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("is silent on a starting-tree person", async () => {
    await setup(research({}, { a_005: { structured_value: { given: "Patrick", surname: "Flynn" }, value: "Patrick Flynn" } }));
    expect(errs(await call(link("a_005", PATRICK, "speculative")))).not.toMatch(RULE);
  });

  it("is silent on a person with a recorded namesake", async () => {
    await setup(
      research({
        namesakes: [{ id: "ns_001", person_id: "I4", name: "James Flynn", place: "Schuylkill County, Pennsylvania, United States", time_period: "born about 1850", record_ids: [OTHER], log_entry_ids: ["log_001"], created: "2026-11-27" }],
      }),
    );
    expect(errs(await call(link("a_005", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("is silent on a speculative link that declares a core-identifier conflict", async () => {
    await setup();
    const r = await call(link("a_005", "I4", "speculative", { core_identifier_conflict: "record birth 1854, tree 1859" }));
    expect(errs(r)).not.toMatch(RULE);
  });

  it("is silent on negative evidence", async () => {
    await setup(research({}, { a_006: { record_basis: "absent" } }));
    expect(errs(await call(link("a_006", "I4", "speculative")))).not.toMatch(RULE);
  });

  it("never refuses an update that lowers the tier", async () => {
    await setup();
    expect(errs(await call(link("a_005", "I4", "probable")))).toBe("");
    const r = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "update", entryId: "pe_001", fields: { confidence: "speculative" },
    } as any);
    expect(errs(r)).not.toMatch(RULE);
  });

  it("refuses a raise to confident while the stub rests on this record alone", async () => {
    await setup();
    expect(errs(await call(link("a_005", "I4", "probable")))).toBe("");
    const r = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "update", entryId: "pe_001", fields: { confidence: "confident" },
    } as any);
    expect(errs(r)).toMatch(RULE);
  });

  it("allows confident once a second record is materialized onto the stub", async () => {
    await setup(research(), tree(["S4", "S5"]));
    expect(errs(await call(link("a_005", "I4", "confident")))).not.toMatch(RULE);
  });

  it("judges a re-point onto the stub", async () => {
    await setup();
    expect(errs(await call(link("a_007", "I4", "speculative")))).not.toMatch(RULE);
    const r = await researchAppend({
      projectPath: dir, section: "person_evidence", op: "update", entryId: "pe_001", fields: { assertion_id: "a_005" },
    } as any);
    expect(errs(r)).toMatch(RULE);
  });
});
