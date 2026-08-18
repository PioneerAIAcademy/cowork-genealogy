/**
 * Clone-contract guard for the in-place tree/research mutators (#1572, Gennecis
 * review; folded from issue #1701).
 *
 * validateIntroduced blocks a writer only on errors its call INTRODUCED, by
 * diffing a pre-mutation snapshot (`before`) against the mutated state (`after`).
 * Each in-place mutator must therefore pass a pre-mutation `structuredClone` as
 * `before`; if a refactor drops it, `before === after`, the diff is empty, and
 * every introduced error is silently demoted to a warning — the tool fails open.
 *
 * tree_edit is already pinned by its own invalid-edit tests. materialize_facts
 * and merge_tree_persons were not: neither has an organic path where the call
 * introduces a validateParsed error (materialize_facts resolves + validates its
 * refs before writing; merge_tree_persons repoints refs correctly), so dropping
 * the clone left both suites green. These tests manufacture that path by stubbing
 * validateParsed to fail on a marker the mutation itself adds — a minted person
 * for materialize, a repointed research ref for merge — then assert the tool
 * BLOCKS. Drop either clone and `before === after` carries the marker in `before`
 * too, the error demotes, `ok` flips to true, and the matching test goes red.
 *
 * materialize_facts clones the TREE (research is not mutated); merge_tree_persons
 * clones the RESEARCH (the tree is already a fresh `merged` object). Each test
 * keys its marker on the document that tool actually clones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// A per-test predicate over (research, tree): when it returns true the stubbed
// validateParsed reports one error. Each test sets it to key on its own marker.
const stub = vi.hoisted(() => ({
  fails: (_research: any, _tree: any): boolean => false,
}));

vi.mock("../../src/validation/validator.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/validation/validator.js")>();
  return {
    ...actual,
    validateParsed: vi.fn(async (research: any, tree: any) =>
      stub.fails(research, tree)
        ? {
            valid: false,
            errors: [
              { path: "", message: "forced call-introduced error (clone-contract test)" },
            ],
            warnings: [],
          }
        : { valid: true, errors: [], warnings: [] },
    ),
  };
});

import { materializeFacts } from "../../src/tools/materialize-facts.js";
import { mergeTreePersons } from "../../src/tools/merge-tree-persons.js";

describe("in-place mutators pass a pre-mutation clone to validateIntroduced (#1572)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clone-contract-"));
    stub.fails = () => false;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });
  const readText = (name: string) => readFile(join(dir, name), "utf-8");

  it("materialize_facts blocks on an introduced tree error (clone = beforeTree)", async () => {
    // A persona that mints a NEW tree person I2 (name + gender + birth). The stub
    // fails only when person I2 exists in the TREE: absent before the materialize,
    // present after — so the error is genuinely introduced by this call.
    const researchDoc = {
      project: {
        id: "rp_001", objective: "Test", status: "active",
        created: "2026-01-01", updated: "2026-01-01", subject_person_ids: ["I1"],
      },
      questions: [], plans: [], log: [],
      sources: [
        {
          id: "src_001", gedcomx_source_description_id: "S1", citation: "Test citation",
          citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
          source_classification: "original", repository: "Test Repository", access_date: "2026-01-01",
        },
      ],
      assertions: [
        assertionFor("a_001", { fact_type: "name", value: "Robert Smith" }),
        assertionFor("a_002", { fact_type: "gender", value: "Male" }),
        assertionFor("a_003", { fact_type: "birth", date: "1855", place: "Provo, Utah, United States" }),
      ],
      person_evidence: [], conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
    };
    const treeDoc = {
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
      relationships: [],
      sources: [{ id: "S1", title: "1850 Census" }],
    };
    await writeFile(join(dir, "research.json"), JSON.stringify(researchDoc, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(treeDoc, null, 2), "utf-8");
    const treeBefore = await readText("tree.gedcomx.json");

    stub.fails = (_research, tree) =>
      Array.isArray(tree?.persons) && tree.persons.some((p: any) => p?.id === "I2");

    const result: any = await materializeFacts({
      projectPath: dir, personId: "I2", recordId: "REC", recordRole: "principal",
    });

    expect(result.ok).toBe(false);
    expect((result.errors ?? []).join(" ")).toContain("clone-contract test");
    // nothing written — the introduced error blocked the call.
    expect(await readText("tree.gedcomx.json")).toBe(treeBefore);
  });

  it("merge_tree_persons blocks on an introduced research error (clone = beforeResearch)", async () => {
    // subject + timeline point at the COLLAPSED id I2; the merge repoints both to
    // the SURVIVOR I1, so "I1" appears in research ONLY after the remap. The stub
    // fails only when research references I1 — introduced by this call's remap.
    const researchDoc = {
      project: {
        id: "rp_001", objective: "Test", status: "active",
        created: "2026-01-01", updated: "2026-01-01", subject_person_ids: ["I2"],
      },
      questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [], conflicts: [], hypotheses: [],
      timelines: [{ id: "t_001", label: "T", person_ids: ["I2"], generated: "2026-01-01T00:00:00Z", events: [], gaps: [] }],
      proof_summaries: [], evaluations: [],
    };
    const treeDoc = {
      persons: [
        { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] },
        { id: "I2", gender: "Male", names: [{ id: "N2", given: "J", surname: "Smith" }] },
      ],
      relationships: [], sources: [],
    };
    await writeFile(join(dir, "research.json"), JSON.stringify(researchDoc, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(treeDoc, null, 2), "utf-8");
    const researchBefore = await readText("research.json");
    const treeBefore = await readText("tree.gedcomx.json");

    stub.fails = (research) => JSON.stringify(research).includes('"I1"');

    const result: any = await mergeTreePersons({ projectPath: dir, merges: [["I1", "I2"]] });

    expect(result.ok).toBe(false);
    expect((result.errors ?? []).join(" ")).toContain("clone-contract test");
    // both files unchanged — nothing written on the block.
    expect(await readText("research.json")).toBe(researchBefore);
    expect(await readText("tree.gedcomx.json")).toBe(treeBefore);
  });
});

function assertionFor(id: string, over: Record<string, unknown>) {
  return {
    id, source_id: "src_001", record_id: "REC", record_role: "principal", record_persona_id: null,
    fact_type: "birth", value: "", date: null, place: null, standard_place: null,
    information_quality: "primary", informant: "unknown", informant_proximity: "official_duty",
    evidence_type: "direct", extracted_for_question_ids: [],
    ...over,
  };
}
