import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../../src/tools/research-append.js";

const citationDetail = {
  who: "Census enumerator",
  what: "1850 U.S. Census",
  when_created: "1850",
  when_accessed: "2026-01-01",
  where: "Schuylkill County, Pennsylvania",
  where_within: "dwelling 201",
};
const validSource = (id: string) => ({
  id,
  gedcomx_source_description_id: "SD-001",
  citation: "1850 U.S. Census, Schuylkill County, PA",
  citation_detail: citationDetail,
  source_classification: "original",
  repository: "NARA",
  access_date: "2026-01-01",
});
const validAssertion = (id: string, sourceId = "src_001") => ({
  id,
  source_id: sourceId,
  record_id: "rec1",
  record_role: "principal",
  fact_type: "birth",
  value: "1850",
  information_quality: "primary",
  informant: "self",
  informant_proximity: "self",
  evidence_type: "direct",
  extracted_for_question_ids: [],
});

function baseResearch() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [validSource("src_001")],
    assertions: [validAssertion("a_001")],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}
const baseTree = {
  persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
  relationships: [],
  sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
};

describe("research_append (Phase 1)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("rejects an append entry that carries a real id (the tool assigns ids)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: validSource("src_999"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/must not carry an id/);
  });

  it("appends a source (no id) → src_002 and validates", async () => {
    await writeProject();
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: sourceNoId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryId).toBe("src_002");
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.sources.map((s: any) => s.id)).toEqual(["src_001", "src_002"]);
  });

  it("appends an assertion referencing an existing source", async () => {
    await writeProject();
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_001");
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionNoId });
    expect(r.ok && r.entryId).toBe("a_002");
  });

  it("appends a person_evidence link, stamps created, references an existing assertion + tree person", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "Name + birth year match", superseded_by: null },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryId).toBe("pe_001");
    const pe = (await readResearch()).person_evidence[0];
    expect(pe.person_id).toBe("I1");
    expect(typeof pe.created).toBe("string"); // tool-stamped
    expect(pe.created.length).toBeGreaterThanOrEqual(10);
  });

  it("assigns max + 1, not count + 1", async () => {
    const research = baseResearch();
    research.sources = [validSource("src_001"), validSource("src_003")];
    await writeProject(research);
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({ projectPath: dir, section: "sources", op: "append", entry: sourceNoId });
    expect(r.ok && r.entryId).toBe("src_004");
  });

  it("updates a field on an existing entry, preserving the id", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { value: "1851" },
    });
    expect(r.ok).toBe(true);
    const a = (await readResearch()).assertions[0];
    expect(a.id).toBe("a_001");
    expect(a.value).toBe("1851");
  });

  it("supports the person_evidence supersede pattern (append new + update old's superseded_by)", async () => {
    const research = baseResearch();
    research.person_evidence = [
      { id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence: "probable", rationale: "first guess", created: "2026-01-01", superseded_by: null },
    ];
    await writeProject(research);

    const appended = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "stronger match", superseded_by: null },
    });
    expect(appended.ok && appended.entryId).toBe("pe_002");

    const superseded = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "update",
      entryId: "pe_001",
      fields: { superseded_by: "pe_002" },
    });
    expect(superseded.ok).toBe(true);
    const pe = await readResearch();
    expect(pe.person_evidence).toHaveLength(2); // old entry not deleted
    expect(pe.person_evidence.find((e: any) => e.id === "pe_001").superseded_by).toBe("pe_002");
  });

  it("rejects update of a non-existent id and writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "update", entryId: "a_999", fields: { value: "x" } });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("writes nothing when the appended entry would invalidate the project", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_999"); // dangling source_id
    const r = await researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionNoId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/src_999|source/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects an unknown section name", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "bogus_section", op: "append", entry: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not supported/);
  });
});

// ─── Phase 2 ───────────────────────────────────────────────────────────────

const validQuestion = (id: string) => ({
  id,
  question: "Who were the parents of John Smith?",
  rationale: "Timeline gap before 1850",
  selection_basis: "objective_decomposition",
  priority: "high",
  status: "open",
  depends_on: [],
  unblocks: [],
  created: "2026-01-01",
  resolved: null,
  resolution_assertion_ids: [],
  exhaustive_declaration: { declared: false, log_entry_ids: [] },
});
const validPlan = (id: string, questionId: string, status = "active") => ({
  id,
  question_id: questionId,
  status,
  created: "2026-01-01",
  items: [],
});
const validPlanItem = () => ({
  sequence: 1,
  record_type: "census",
  jurisdiction: "Schuylkill, Pennsylvania, United States",
  date_range: "1850-1860",
  repository: "NARA",
  rationale: "Census should list the household",
  fallback_for: null,
  status: "planned",
});
const validConflict = () => ({
  conflict_type: "fact",
  description: "Two different birth years",
  competing_assertion_ids: ["a_001", "a_002"],
  status: "unresolved",
  blocks_question_ids: [],
  disputed_attribute: "birth_year",
});
const validHypothesis = () => ({
  claim: "John is the son of Robert",
  status: "active",
  supporting_assertion_ids: [],
  contradicting_assertion_ids: [],
  ruled_out: false,
  related_question_ids: [],
});

describe("research_append (Phase 2)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-p2-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function phase2Research() {
    const r = baseResearch();
    r.assertions.push(validAssertion("a_002")); // a second assertion for fact-conflict competing
    r.questions = [validQuestion("q_001")];
    return r;
  }
  async function writeProject(research: any = phase2Research(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("appends a question and stamps created", async () => {
    await writeProject();
    const { id: _o, created: _c, ...q } = validQuestion("x");
    const r = await researchAppend({ projectPath: dir, section: "questions", op: "append", entry: q });
    expect(r.ok && r.entryId).toBe("q_002");
    const created = (await readResearch()).questions.find((x: any) => x.id === "q_002").created;
    expect(typeof created).toBe("string");
  });

  it("appends a plan, then rejects a second active plan for the same question", async () => {
    await writeProject();
    const { id: _o, ...plan } = validPlan("x", "q_001", "active");
    const first = await researchAppend({ projectPath: dir, section: "plans", op: "append", entry: plan });
    expect(first.ok && first.entryId).toBe("pl_001");

    const { id: _o2, ...plan2 } = validPlan("y", "q_001", "active");
    const second = await researchAppend({ projectPath: dir, section: "plans", op: "append", entry: plan2 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.errors.join(" ")).toMatch(/already has an active plan/);
  });

  it("rejects an update that flips a superseded plan back to active when one is already active", async () => {
    const research = phase2Research();
    research.plans = [validPlan("pl_001", "q_001", "active"), validPlan("pl_002", "q_001", "superseded")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "update",
      entryId: "pl_002",
      fields: { status: "active" }, // would create a second active plan for q_001
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already has an active plan/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("appends a plan_item into the named plan", async () => {
    const research = phase2Research();
    research.plans = [validPlan("pl_001", "q_001", "active")];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: validPlanItem(),
    });
    expect(r.ok && r.entryId).toBe("pli_001");
    const items = (await readResearch()).plans[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("pli_001");
  });

  it("requires planId for plan_items", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "plan_items", op: "append", entry: validPlanItem() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/requires a 'planId'/);
  });

  it("appends a fact conflict referencing two assertions", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "conflicts", op: "append", entry: validConflict() });
    expect(r.ok && r.entryId).toBe("c_001");
  });

  it("rejects resolving a conflict without the resolution analysis fields", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: { status: "resolved", preferred_assertion_id: "a_001" }, // missing weighing/independence/rationale
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/weighing_analysis|independence_analysis|resolution_rationale/);
  });

  it("rejects a resolved conflict whose preferred_assertion_id is not among the competing", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        independence_analysis: "independent sources",
        weighing_analysis: "census outweighs the later record",
        resolution_rationale: "primary informant",
        preferred_assertion_id: "a_999",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/preferred_assertion_id/);
  });

  it("accepts a fully-resolved conflict", async () => {
    const research = phase2Research();
    research.conflicts = [{ ...validConflict(), id: "c_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "conflicts",
      op: "update",
      entryId: "c_001",
      fields: {
        status: "resolved",
        independence_analysis: "independent sources",
        weighing_analysis: "census outweighs the later record",
        resolution_rationale: "primary informant",
        preferred_assertion_id: "a_001",
      },
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).conflicts[0].status).toBe("resolved");
  });

  it("rejects ruling out a hypothesis without a reason (validator)", async () => {
    const research = phase2Research();
    research.hypotheses = [{ ...validHypothesis(), id: "h_001" }];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "hypotheses",
      op: "update",
      entryId: "h_001",
      fields: { ruled_out: true, status: "ruled_out" },
    });
    expect(r.ok).toBe(false);
  });

  it("treats re-declaring an already-declared question as a no-op", async () => {
    const research = phase2Research();
    research.questions = [
      { ...validQuestion("q_001"), status: "exhaustive_declared", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: {} } },
    ];
    research.log = [
      { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "negative", results_examined: 0, external_site: null, results_ref: null },
    ];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { exhaustive_declaration: { declared: true, log_entry_ids: ["log_001", "log_002"], stop_criteria: {} } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual([]); // no-op, nothing written
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("does NOT no-op a bundled update that re-declares AND changes another field", async () => {
    const sc = {
      goal_alignment: true, repository_breadth: true, original_substitution: true,
      independent_verification: true, evidence_class: true, conflict_resolution: true, overturn_risk: true,
    };
    const research = phase2Research();
    research.questions = [
      { ...validQuestion("q_001"), status: "exhaustive_declared", priority: "high", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: sc } },
    ];
    research.log = [
      { id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "negative", results_examined: 0, external_site: null, results_ref: null },
    ];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      section: "questions",
      op: "update",
      entryId: "q_001",
      fields: { priority: "low", exhaustive_declaration: { declared: true, log_entry_ids: ["log_001"], stop_criteria: sc } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual(["research.json"]); // wrote — not a no-op
    expect((await readResearch()).questions[0].priority).toBe("low");
  });
});

// ─── Phase 3 ───────────────────────────────────────────────────────────────

describe("research_append (Phase 3)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-p3-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function phase3Research() {
    const r = baseResearch();
    r.questions = [validQuestion("q_001")];
    return r;
  }
  async function writeProject(research: any = phase3Research(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("appends a timeline and stamps `generated` (datetime), refs an existing person", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "timelines",
      op: "append",
      entry: { label: "John Smith timeline", person_ids: ["I1"], events: [], gaps: [], impossibilities: [] },
    });
    expect(r.ok && r.entryId).toBe("t_001");
    const t = (await readResearch()).timelines[0];
    expect(t.generated).toMatch(/T.*:/); // ISO datetime, not a bare date
  });

  it("appends a proof_summary referencing an existing question", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "append",
      entry: {
        question_id: "q_001",
        tier: "probable",
        vehicle: "summary",
        supporting_assertion_ids: ["a_001"],
        resolved_conflict_ids: [],
        exhaustive_search_summary: "Searched census + vitals",
        narrative_markdown: "## Conclusion\n...",
      },
    });
    expect(r.ok && r.entryId).toBe("ps_001");
  });

  it("appends an evaluation and stamps `timestamp` (datetime)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "evaluations",
      op: "append",
      entry: {
        focus: "conclusion-readiness",
        target_id: "q_001",
        target_type: "question",
        verdict: "looks_solid",
        file_path: "evaluations/ev_001.md",
        superseded_by: null,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryId).toBe("ev_001");
    expect((await readResearch()).evaluations[0].timestamp).toMatch(/T.*:/);
  });

  it("appends a known_holding and stamps `created` (date)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "known_holdings",
      op: "append",
      entry: { holding_type: "document", description: "Family bible", confidence: "confident", promoted: false },
    });
    expect(r.ok && r.entryId).toBe("kh_001");
    const kh = (await readResearch()).known_holdings[0];
    expect(kh.created).toMatch(/^\d{4}-\d{2}-\d{2}$/); // bare date
  });
});

describe("research_append (project singleton section)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-project-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("updates project.status and stamps project.updated (bare date)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { status: "completed" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryId).toBe("project"); // singleton echoes the section name
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.project.status).toBe("completed");
    expect(research.project.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects op 'append' on the project singleton", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "append",
      entry: { status: "completed" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/only op 'update'/);
  });

  it("rejects a field that isn't allowed on project (e.g. objective)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { objective: "rewritten" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not updatable on 'project'/);
  });

  it("rejects an invalid status value (whole-project validation)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "project",
      op: "update",
      fields: { status: "done" },
    });
    expect(r.ok).toBe(false);
  });

  it("requires a fields object for a project update", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, section: "project", op: "update" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/requires a .?fields/);
  });
});

// ─── Batch ops ───────────────────────────────────────────────────────────────

const noId = (o: any) => {
  const { id: _omit, ...rest } = o;
  return rest;
};

describe("research_append (batch ops)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-batch-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("(a/c) applies a homogeneous batch, returns ordered ids, sequences intra-batch", async () => {
    await writeProject(); // seeded with sources [src_001]
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        { section: "sources", op: "append", entry: noId(validSource("y")) },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["src_002", "src_003"]); // op #2 sees op #1's append
    expect(r.filesWritten).toEqual(["research.json"]);
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002", "src_003"]);
  });

  it("(d) applies a heterogeneous record in one write; assertion references a source from the same batch", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // → src_002
        { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) }, // forward ref to op #0
        { section: "assertions", op: "append", entry: noId(validAssertion("y", "src_002")) },
        {
          section: "person_evidence",
          op: "append",
          entry: { assertion_id: "a_002", person_id: "I1", confidence: "confident", rationale: "match", superseded_by: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => `${x.section}:${x.entryId}`)).toEqual([
      "sources:src_002",
      "assertions:a_002",
      "assertions:a_003",
      "person_evidence:pe_001",
    ]);
    const research = await readResearch();
    expect(research.sources).toHaveLength(2);
    expect(research.assertions.map((a: any) => a.id)).toEqual(["a_001", "a_002", "a_003"]);
    expect(research.assertions[1].source_id).toBe("src_002"); // intra-batch forward ref persisted + validated
    expect(research.person_evidence).toHaveLength(1);
  });

  it("(d2) appends a plan + its items in one batch, referencing the predicted plan id pl_001", async () => {
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) }, // → pl_001
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // → pli_001
        { section: "plan_items", op: "append", entry: validPlanItem(), planId: "pl_001" }, // → pli_002
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["pl_001", "pli_001", "pli_002"]);
    const out = await readResearch();
    expect(out.plans[0].id).toBe("pl_001");
    expect(out.plans[0].items.map((i: any) => i.id)).toEqual(["pli_001", "pli_002"]);
  });

  it("(b) rolls back the whole batch on a mid-batch validation failure — writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // valid on its own
        { section: "assertions", op: "append", entry: noId(validAssertion("y", "src_999")) }, // dangling → whole-project validation fails
      ],
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before); // including the valid op #0
  });

  it("(b2) indexes a per-op precondition failure as ops[i] and writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // op 0 ok
        { section: "assertions", op: "append", entry: validAssertion("z", "src_001") }, // op 1 carries an id → throws
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:/);
    expect(r.errors.join(" ")).toMatch(/must not carry an id/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("(b3) enforces section invariants across the batch (second active plan → ops[1])", async () => {
    const research = baseResearch();
    research.questions = [validQuestion("q_001")];
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plans", op: "append", entry: noId(validPlan("x", "q_001", "active")) },
        { section: "plans", op: "append", entry: noId(validPlan("y", "q_001", "active")) }, // same question, second active plan
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:.*already has an active plan/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects an empty ops array", async () => {
    await writeProject();
    const r = await researchAppend({ projectPath: dir, ops: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
  });

  it("(d3) applies a project-singleton update inside a batch and writes once", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results).toContainEqual({ section: "project", op: "update", entryId: "project" });
    expect(r.filesWritten).toEqual(["research.json"]);
    const research = await readResearch();
    expect(research.project.status).toBe("completed");
    expect(research.project.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(research.sources).toHaveLength(2);
  });

  it("(d3b) fails the whole batch on an invalid project status — writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) }, // valid op #0
        { section: "project", op: "update", fields: { status: "done" } }, // invalid enum → whole batch fails
      ],
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });
});
