import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null), standardPlaceToCoords: vi.fn(async () => null) };
});

import { treeEdit } from "../../src/tools/tree-edit.js";
import { treeCorrect } from "../../src/tools/tree-correct.js";

// The namesake check on tree writes (issue #3363, item 8): a record cited onto a
// fact or name of a person with a namesake row must tie to that person.

const P = "KWCB-111"; // John Smith, who has a recorded namesake
const W = "KWCB-222"; // Mary Smith, his wife

function source(id: string, sd: string) {
  return {
    id,
    gedcomx_source_description_id: sd,
    citation: "Test citation",
    citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
    source_classification: "original",
    repository: "Test Repository",
    access_date: "2026-01-01",
  };
}

function assertion(id: string, sourceId: string, recordId: string, role: string, factType: string, value: string, over = {}) {
  return {
    id,
    source_id: sourceId,
    record_id: recordId,
    record_role: role,
    record_persona_id: null,
    fact_type: factType,
    value,
    date: null,
    place: null,
    standard_place: null,
    information_quality: "primary" as const,
    informant: "unknown",
    informant_proximity: "official_duty" as const,
    record_basis: "stated" as const,
    extracted_for_question_ids: [] as string[],
    ...over,
  };
}

function link(id: string, assertionId: string, personId: string, confidence = "probable") {
  return {
    id,
    assertion_id: assertionId,
    person_id: personId,
    confidence,
    rationale: "test link",
    match_score: null,
    created: "2026-01-01",
    superseded_by: null,
  };
}

const row = (personId: string) => ({
  id: "ns_001",
  person_id: personId,
  name: "John Smith",
  place: "San Francisco, California, United States",
  time_period: "born about 1873",
  record_ids: ["REC-VOT"],
  created: "2026-10-01",
});

/** The census (S1) is tied through the wife; the voter list (S2) is not. */
const LINKS = () => [link("pe_1", "a_001", P), link("pe_2", "a_003", W), link("pe_3", "a_010", P)];

function research(opts: { links?: any[]; rowOn?: string | null } = {}) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: [P] },
    questions: [],
    plans: [],
    log: [],
    sources: [source("src_001", "S1"), source("src_002", "S2")],
    assertions: [
      assertion("a_001", "src_001", "REC-CEN", "head", "name", "John Smith"),
      assertion("a_003", "src_001", "REC-CEN", "wife", "name", "Mary Smith"),
      assertion("a_010", "src_002", "REC-VOT", "principal", "name", "John Smith"),
    ],
    person_evidence: opts.links ?? LINKS(),
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
    ...(opts.rowOn === null ? {} : { namesakes: [row(opts.rowOn ?? P)] }),
  };
}

function tree(opts: { wife?: any; couple?: boolean; facts?: any[] } = {}) {
  const wife = opts.wife ?? { id: W, gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith" }] };
  return {
    persons: [
      {
        id: P,
        gender: "Male",
        names: [{ id: "N1", given: "John", surname: "Smith", sources: [{ ref: "S1" }] }],
        facts: opts.facts ?? [],
      },
      wife,
    ],
    relationships: opts.couple === false ? [] : [{ id: "R1", type: "Couple", person1: P, person2: wife.id }],
    sources: [
      { id: "S1", title: "1880 census" },
      { id: "S2", title: "Voter list" },
      { id: "S9", title: "A source no research source cites" },
    ],
  };
}

const occupation = (...refs: string[]) => ({ type: "Occupation", value: "Clerk", sources: refs.map((ref) => ({ ref })) });

describe("tree_edit and tree_correct under a recorded namesake (#3363 PR 1e)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-edit-namesake-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(r: any, t: any, starting?: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(t, null, 2), "utf-8");
    if (starting) await writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify(starting, null, 2), "utf-8");
  }
  const files = async () => [
    await readFile(join(dir, "research.json"), "utf-8"),
    await readFile(join(dir, "tree.gedcomx.json"), "utf-8"),
  ];
  /** Runs `call`, expects a refusal, and checks that nothing was written. */
  async function refused(call: () => Promise<any>): Promise<string[]> {
    const before = await files();
    const r = await call();
    expect(r.ok).toBe(false);
    expect(await files()).toEqual(before);
    return r.ok ? [] : (r.errors as string[]);
  }
  const written = async (call: () => Promise<any>) => {
    const r = await call();
    expect(r.ok, JSON.stringify(r.errors ?? [])).toBe(true);
  };

  it("T1 refuses a fact onto the row holder citing a record whose link is not tied", async () => {
    await setup(research(), tree());
    const errors = await refused(() =>
      treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any),
    );
    expect(errors[0]).toMatch(
      /^ops\[0\]: 'KWCB-111' has a recorded namesake \('ns_001'\), so a record goes onto 'KWCB-111''s facts and names only when something in it ties it to 'KWCB-111'\. The fact '.*' \(Occupation\) this op adds cites S2 \(research source 'src_002'\), and its link 'pe_3' to 'KWCB-111' is not tied: /,
    );
    expect(errors[0]).toContain(
      "Nothing was written. Cite only records that tie to 'KWCB-111', or hand the link to the person-evidence agent, which owns person_evidence, to tie it first",
    );
    expect(errors[0]).not.toMatch(/\.\.\s/);
  });

  it("T2 writes a fact citing a record its wife's link ties", async () => {
    await setup(research(), tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S1") }] } as any));
  });

  it("T3 writes the same fact when no namesake is recorded", async () => {
    await setup(research({ rowOn: null }), tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any));
  });

  it("T4 does not judge a ref no research source cites", async () => {
    await setup(research(), tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S9") }] } as any));
  });

  it("T5 refuses a name citing the untied record", async () => {
    await setup(research(), tree());
    const errors = await refused(() =>
      treeEdit({
        projectPath: dir,
        ops: [{ operation: "add_name", personId: P, name: { given: "Johann", surname: "Schmidt", sources: [{ ref: "S2" }] } }],
      } as any),
    );
    expect(errors[0]).toMatch(/The name '.*' \(Johann Schmidt\) this op adds cites S2 \(research source 'src_002'\)/);
  });

  it("T6 refuses an update that adds the untied record to a fact", async () => {
    await setup(research(), tree({ facts: [{ id: "F1", type: "Occupation", value: "Clerk", sources: [{ ref: "S1" }] }] }));
    const errors = await refused(() =>
      treeCorrect({
        projectPath: dir,
        ops: [{ operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }, { ref: "S2" }] } }],
      } as any),
    );
    expect(errors[0]).toMatch(/The fact 'F1' \(Occupation\) this op changes cites S2 \(research source 'src_002'\)/);
  });

  it("T7 writes an update that changes only the value of a fact already citing the untied record", async () => {
    await setup(research(), tree({ facts: [{ id: "F2", type: "Occupation", value: "Clerk", sources: [{ ref: "S2" }] }] }));
    await written(() =>
      treeCorrect({ projectPath: dir, ops: [{ operation: "update_fact", personId: P, factId: "F2", fact: { value: "Bookkeeper" } }] } as any),
    );
  });

  it("T7b writes an update that restates the untied ref beside a new tied one", async () => {
    await setup(research(), tree({ facts: [{ id: "F2", type: "Occupation", value: "Clerk", sources: [{ ref: "S2" }] }] }));
    await written(() =>
      treeCorrect({
        projectPath: dir,
        ops: [{ operation: "update_fact", personId: P, factId: "F2", fact: { sources: [{ ref: "S2" }, { ref: "S1" }] } }],
      } as any),
    );
  });

  it("T7c writes an update that respells a cited ref without its leading #", async () => {
    await setup(research(), tree({ facts: [{ id: "F3", type: "Occupation", value: "Clerk", sources: [{ ref: "#S2" }] }] }));
    await written(() =>
      treeCorrect({ projectPath: dir, ops: [{ operation: "update_fact", personId: P, factId: "F3", fact: { sources: [{ ref: "S2" }] } }] } as any),
    );
  });

  it("T8 does not judge a fact on a relationship", async () => {
    await setup(research(), tree());
    await written(() =>
      treeEdit({
        projectPath: dir,
        ops: [{ operation: "add_fact", relationshipId: "R1", fact: { type: "Marriage", date: "1872", sources: [{ ref: "S2" }] } }],
      } as any),
    );
  });

  it("T9 judges on the tree before the call: a relationship the same call adds does not tie the record", async () => {
    await setup(research(), tree({ couple: false }));
    const errors = await refused(() =>
      treeEdit({
        projectPath: dir,
        ops: [
          { operation: "add_relationship", relationship: { type: "Couple", person1: P, person2: W, sources: [{ ref: "S1" }] } },
          { operation: "add_fact", personId: P, fact: occupation("S1") },
        ],
      } as any),
    );
    expect(errors[0]).toMatch(/^ops\[1\]: 'KWCB-111' has a recorded namesake/);
    expect(errors[0]).toContain("a relationship added in this same call does not count");
  });

  it("T10 refuses a name update that adds the untied record", async () => {
    await setup(research(), tree());
    const errors = await refused(() =>
      treeCorrect({
        projectPath: dir,
        ops: [{ operation: "update_name", personId: P, nameId: "N1", name: { sources: [{ ref: "S1" }, { ref: "S2" }] } }],
      } as any),
    );
    expect(errors[0]).toMatch(/The name 'N1' \(John Smith\) this op changes cites S2/);
  });

  it("T11 refuses a record linked to the row holder only at speculative", async () => {
    await setup(research({ links: [link("pe_1", "a_001", P), link("pe_2", "a_003", W), link("pe_3", "a_010", P, "speculative")] }), tree());
    const errors = await refused(() =>
      treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any),
    );
    expect(errors[0]).toContain("and it has no probable or confident link to 'KWCB-111'.");
  });

  it("T12 refuses the single op form without an op index", async () => {
    await setup(research(), tree());
    const errors = await refused(() => treeEdit({ projectPath: dir, operation: "add_fact", personId: P, fact: occupation("S2") } as any));
    expect(errors[0]).toMatch(/^'KWCB-111' has a recorded namesake/);
  });

  it("T13 refuses a fact citing a tied and an untied record, naming only the untied one", async () => {
    await setup(research(), tree());
    const errors = await refused(() =>
      treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S1", "S2") }] } as any),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("(research source 'src_002')");
    expect(errors[0]).not.toContain("'src_001'");
  });

  it("T14 does not judge a person whose relative holds the row", async () => {
    await setup(research({ rowOn: W }), tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any));
  });

  it("T15 reads the starting tree: a wife the project began with ties the record she was copied from", async () => {
    // I2 is a run style id whose only ref reaches the census, so without the
    // starting tree she would read as made from the census alone and tie nothing.
    const wife = { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith", sources: [{ ref: "S1" }] }] };
    const links = [link("pe_1", "a_001", P), link("pe_2", "a_003", "I2"), link("pe_3", "a_010", P)];
    const t = tree({ wife });
    await setup(research({ links }), t, { persons: [wife], relationships: [], sources: [] });
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S1") }] } as any));
  });

  it("T16 writes a fact citing an S entry two research sources share when one of them ties", async () => {
    // One research source per persona, on the census's S entry: src_003 is the
    // wife's, linked to her alone.
    const r = research({ links: [...LINKS(), link("pe_4", "a_020", W)] });
    r.sources.push(source("src_003", "S1"));
    r.assertions.push(assertion("a_020", "src_003", "REC-CEN-2", "principal", "name", "Mary Smith"));
    await setup(r, tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S1") }] } as any));
  });

  it("T16c known let through: writes a fact citing an S entry his tied census shares with the namesake's own record", async () => {
    // REC-VOT is the record the row lists as the namesake's. Filed on the
    // census's S entry, a fact copied from it passes on the census's tie.
    const r = research();
    r.sources = [source("src_001", "S1"), source("src_002", "S1")];
    await setup(r, tree());
    await written(() => treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S1") }] } as any));
  });

  it("T16b refuses an S entry two research sources share when neither ties, naming each", async () => {
    const r = research({ links: [...LINKS(), link("pe_4", "a_021", W)] });
    r.sources.push(source("src_004", "S2"));
    r.assertions.push(assertion("a_021", "src_004", "REC-VOT-2", "principal", "name", "Mary Smith"));
    await setup(r, tree());
    const errors = await refused(() =>
      treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any),
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("cites S2 (research source 'src_002'), and its link 'pe_3' to 'KWCB-111' is not tied: ");
    expect(errors[1]).toContain("cites S2 (research source 'src_004'), and it has no probable or confident link to 'KWCB-111'.");
  });

  it("T17 judges a batch by what it adds as a whole: a ref one op drops and a later op restores is not judged", async () => {
    await setup(research(), tree({ facts: [{ id: "F2", type: "Occupation", value: "Clerk", sources: [{ ref: "S2" }] }] }));
    await written(() =>
      treeCorrect({
        projectPath: dir,
        ops: [
          { operation: "update_fact", personId: P, factId: "F2", fact: { sources: [{ ref: "S1" }] } },
          { operation: "update_fact", personId: P, factId: "F2", fact: { sources: [{ ref: "S2" }, { ref: "S1" }] } },
        ],
      } as any),
    );
  });

  it("T17b does not judge an untied ref one op adds and a later op drops", async () => {
    await setup(research(), tree({ facts: [{ id: "F1", type: "Occupation", value: "Clerk", sources: [{ ref: "S1" }] }] }));
    await written(() =>
      treeCorrect({
        projectPath: dir,
        ops: [
          { operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }, { ref: "S2" }] } },
          { operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }] } },
        ],
      } as any),
    );
  });

  it("T17c charges a ref several ops add once, on the last of them", async () => {
    await setup(research(), tree({ facts: [{ id: "F1", type: "Occupation", value: "Clerk", sources: [{ ref: "S1" }] }] }));
    const errors = await refused(() =>
      treeCorrect({
        projectPath: dir,
        ops: [
          { operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }, { ref: "S2" }] } },
          { operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }] } },
          { operation: "update_fact", personId: P, factId: "F1", fact: { sources: [{ ref: "S1" }, { ref: "S2" }] } },
        ],
      } as any),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ops\[2\]: 'KWCB-111' has a recorded namesake/);
  });

  it("T18 refuses a record whose only link to the row holder rests on an assertion that records an absence", async () => {
    const r = research();
    r.assertions[2].record_basis = "absent" as any;
    await setup(r, tree());
    const errors = await refused(() =>
      treeEdit({ projectPath: dir, ops: [{ operation: "add_fact", personId: P, fact: occupation("S2") }] } as any),
    );
    expect(errors[0]).toContain("cites S2 (research source 'src_002'), and its only link to 'KWCB-111' rests on an assertion that records an absence, which ties nothing.");
  });
});
