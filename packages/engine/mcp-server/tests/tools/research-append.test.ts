import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub the network place resolver so the composite place-lever tests are
// offline and deterministic. The wrong-geocode mapping (England → Cameroon)
// reproduces the silent-wrong-standard_place theme the country guard catches.
vi.mock("../../src/utils/place-resolver.js", () => ({
  resolveStandardPlace: vi.fn(async (text: string) => {
    if (text === "Schuylkill County, Pennsylvania") return "Schuylkill, Pennsylvania, United States";
    if (text === "West Bromwich, England") return "Bamenda, Mezam, Northwest Region, Cameroon";
    if (text === "West Bromwich, Staffordshire, England")
      return "West Bromwich, Staffordshire, England, United Kingdom";
    return null;
  }),
}));

import { researchAppend, countryConsistency } from "../../src/tools/research-append.js";
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";

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

  it("normalizes a GedcomX date object ({original}) on an appended assertion to a plain string", async () => {
    await writeProject();
    const { id: _omit, ...assertionNoId } = validAssertion("x", "src_001");
    // The model routinely emits `date` as a GedcomX object instead of the
    // schema's plain string (observed in the record-extraction eval,
    // ut_record_extraction_003). Without normalization this fails
    // validate_research_schema (`date` is not of type string/null).
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "append",
      entry: { ...assertionNoId, date: { original: "~1818", formal: "+1818" } as any },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const appended = (await readResearch()).assertions.find((a: any) => a.id === r.entryId);
    expect(appended.date).toBe("~1818");
  });

  it("normalizes a date object on an assertion update too", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_001",
      fields: { date: { formal: "+1850" } as any },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const updated = (await readResearch()).assertions.find((a: any) => a.id === "a_001");
    expect(updated.date).toBe("+1850");
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

  it("appends a locality → loc_001, initializes the optional section, stamps created", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "localities",
      op: "append",
      entry: {
        place: "Norway",
        for_place: "Ringebu, Oppland, Norway",
        jurisdictions: [{ name: "Ringebu, Oppland, Norway", date_range: "1838-" }],
        collections: [{ id: "4237104", title: "Norway, Church Books", date_range: "1797-1958" }],
        quirks: ["Indexed only at county level."],
        pages_read: [{ section: "home", url: "u1", found: true }],
        source: "locality-guide",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entryId).toBe("loc_001");
    const loc = (await readResearch()).localities[0];
    expect(loc.place).toBe("Norway");
    expect(loc.source).toBe("locality-guide");
    expect(typeof loc.created).toBe("string"); // tool-stamped
    expect(loc.created.length).toBeGreaterThanOrEqual(10);
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

  it("refuses to write a source whose citation_detail carries an unknown key, and writes nothing", async () => {
    // The persisted-location incident: a run appended a source with
    // citation_detail.location and the hand-maintained validator let it
    // through — only the harness's JSON-Schema gate (additionalProperties:
    // false on citation_detail) caught it. The closed-shape check must stop
    // it at the tool boundary.
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _omit, ...sourceNoId } = validSource("x");
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: {
        ...sourceNoId,
        citation_detail: { ...citationDetail, location: "district 40, p. 3" },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/unexpected property 'location'/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
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
    if (r.ok) return;
    // mapValidationErrors remaps the whole-doc validation error onto the op that induced it
    expect(r.errors.some((e) => e.startsWith("ops[1]:"))).toBe(true);
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

  // ── String-coercion: the model sometimes serializes a large `ops` batch as a
  // JSON *string* (see coerce-json-arg.ts). The tool recovers it rather than
  // rejecting it and driving the model into slow one-op-per-call writes.
  it("(coerce) applies an ops batch that arrives as a JSON string", async () => {
    await writeProject(); // seeded with sources [src_001]
    const opsArray = [
      { section: "sources", op: "append", entry: noId(validSource("x")) },
      { section: "sources", op: "append", entry: noId(validSource("y")) },
    ];
    const r = await researchAppend({
      projectPath: dir,
      ops: JSON.stringify(opsArray) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.entryId)).toEqual(["src_002", "src_003"]);
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002", "src_003"]);
  });

  it("(coerce) recovers a stringified ops batch even with redundant top-level section/op (the observed record-extraction failure)", async () => {
    await writeProject();
    const opsArray = [
      { section: "sources", op: "append", entry: noId(validSource("x")) }, // → src_002
      { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) }, // forward ref
    ];
    // Exactly what Sonnet emitted: ops as a JSON string AND leftover top-level
    // section/op (ignored once ops is present).
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      ops: JSON.stringify(opsArray) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => `${x.section}:${x.entryId}`)).toEqual(["sources:src_002", "assertions:a_002"]);
    expect((await readResearch()).assertions[1].source_id).toBe("src_002");
  });

  it("(coerce) applies a single-op append whose entry arrives as a JSON string", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: JSON.stringify(noId(validSource("x"))) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await readResearch()).sources.map((s: any) => s.id)).toEqual(["src_001", "src_002"]);
  });

  it("(coerce) leaves a non-JSON ops string alone → the existing non-empty-array error, writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: "not valid json" as any,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });
});

// ─── Composite persist (D1) + enforcement (D2) + place guards ────────────────

describe("research_append (composite persist + enforcement)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-composite-"));
    vi.mocked(resolveStandardPlace).mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  const searchLogEntry = (resultsRef: string | null) => ({
    id: "log_001",
    plan_item_id: null,
    performed: "2026-01-01T00:00:00Z",
    tool: "record_search",
    query: {},
    outcome: "positive",
    results_examined: 1,
    external_site: null,
    results_ref: resultsRef,
  });

  const sidecarRecord = () => ({
    recordId: "ark:/61903/1:1:ABCD-123",
    primaryId: "p_1",
    gedcomx: {
      persons: [
        {
          id: "p_1",
          facts: [
            {
              id: "F1",
              type: "Residence",
              place: "Pottsville, Pennsylvania",
              standard_place: "Pottsville, Schuylkill, Pennsylvania, United States",
            },
          ],
        },
        { id: "p_2" },
      ],
    },
  });

  async function writeSidecar(records: any[] = [sidecarRecord()]) {
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "log_001.json"),
      JSON.stringify(
        {
          log_id: "log_001",
          tool: "record_search",
          retrieved: "2026-01-01T00:00:00Z",
          returned_count: records.length,
          payload: { results: records },
        },
        null,
        2,
      ),
    );
  }

  /** research seeded with a search log entry pointing at the sidecar. */
  function sidecarResearch() {
    const r = baseResearch();
    r.log = [searchLogEntry("results/log_001.json")] as any;
    return r;
  }

  const sourceOpNoRef = () => {
    const { id: _i, gedcomx_source_description_id: _g, ...rest } = validSource("x");
    return rest;
  };

  // ── D1: composite create + reuse-or-create ──

  it("creates the tree S entry from sourceDescription, stamps the source op, writes both files (tree first)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Federal Census", author: "U.S. Census Bureau", url: "https://example.org" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        // record_id must be fresh — "rec1" already has a source (src_001), which
        // would trigger §3.4.1 reuse detection instead of the create path.
        { section: "assertions", op: "append", entry: { ...noId(validAssertion("x", "src_002")), record_id: "rec-new" } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
    const tree = await readTree();
    expect(tree.sources.map((s: any) => s.id)).toEqual(["SD-001", "S1"]);
    expect(tree.sources[1]).toEqual({
      id: "S1",
      title: "1850 U.S. Federal Census",
      author: "U.S. Census Bureau",
      url: "https://example.org",
    });
    const research = await readResearch();
    expect(research.sources[1].gedcomx_source_description_id).toBe("S1");
    expect(await exists("tree.gedcomx.json.bak")).toBe(true); // one-deep tree backup
  });

  it("accepts a sources append that reuses an existing S id (multi-repository pattern); tree untouched", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // carries gedcomx_source_description_id: "SD-001"
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: src }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.filesWritten).toEqual(["research.json"]);
    expect(r.sourceDescriptionId).toBeUndefined();
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("rejects a sources append whose gedcomx_source_description_id is dangling — as an op error with opsReceived", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: { ...src, gedcomx_source_description_id: "S99" } },
        { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'S99' not found/);
    expect(r.errors[0]).toMatch(/sourceDescription/); // actionable: how to create it
    expect(r.opsReceived).toBe(2);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects a sources append with neither sourceDescription nor an S reference", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: sourceOpNoRef() }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*either.*sourceDescription.*or.*gedcomx_source_description_id/s);
  });

  it("rejects sourceDescription combined with an op-supplied S reference (use one)", async () => {
    await writeProject();
    const { id: _i, ...src } = validSource("x"); // has SD-001
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "sources", op: "append", entry: src }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/use one/);
  });

  it("rejects sourceDescription when the batch has no (or 2+) sources append ops", async () => {
    await writeProject();
    const none = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "assertions", op: "append", entry: noId(validAssertion("x")) }],
    });
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.errors.join(" ")).toMatch(/exactly one sources append op.*found 0/);

    const two = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "sources", op: "append", entry: sourceOpNoRef() },
      ],
    });
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.errors.join(" ")).toMatch(/found 2/);
  });

  it("supports the composite on the single-op form too", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: sourceOpNoRef(),
      sourceDescription: { title: "1850 U.S. Federal Census" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.entryId).toBe("src_002");
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
  });

  // ── D1: source_id auto-stamp ──

  it("auto-stamps source_id on assertions that omit it when the batch has exactly one sources append", async () => {
    await writeProject();
    // fresh record_id: "rec1" would engage §3.4.1 reuse (same repository)
    const { source_id: _s, ...assertionNoSource } = { ...noId(validAssertion("x")), record_id: "rec-new" };
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "assertions", op: "append", entry: assertionNoSource },
        { section: "assertions", op: "append", entry: { ...assertionNoSource, source_id: null } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const research = await readResearch();
    expect(research.assertions[1].source_id).toBe("src_002"); // omitted → stamped
    expect(research.assertions[2].source_id).toBe("src_002"); // null → stamped
  });

  it("an explicit source_id always wins over the auto-stamp", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() }, // → src_002
        // fresh record_id keeps §3.4.1 out of the picture (explicit source_id is the subject here)
        { section: "assertions", op: "append", entry: { ...noId(validAssertion("x", "src_001")), record_id: "rec-new" } }, // explicit, pre-existing
      ],
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).assertions[1].source_id).toBe("src_001");
  });

  it("does NOT auto-stamp in a batch with two sources appends — the omitted source_id fails validation", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // SD-001 exists, precondition passes
    const { source_id: _s, ...assertionNoSource } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src },
        { section: "sources", op: "append", entry: src },
        { section: "assertions", op: "append", entry: assertionNoSource },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/source_id/);
    expect(r.errors.join(" ")).toMatch(/ops\[2\]/); // validation error mapped back to the op
    expect(r.opsReceived).toBe(3);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ── D2: persona/record-id matrix ──

  it("auto-fills record_persona_id from the sidecar and canonicalizes record_id to the sidecar's form", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const { source_id: _s, ...a } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...a,
            source_id: "src_001",
            // URL form on purpose — the sidecar stores the bare-ARK form
            record_id: "https://www.familysearch.org/ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const persisted = (await readResearch()).assertions[1];
    expect(persisted.record_persona_id).toBe("p_1"); // auto-filled, never silently null
    expect(persisted.record_id).toBe("ark:/61903/1:1:ABCD-123"); // canonicalized
  });

  it("auto-fills across a multi-assertion batch when all ops share one record_id and one record_role", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base } },
        { section: "assertions", op: "append", entry: { ...base, fact_type: "residence", value: "Pottsville" } },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_1");
  });

  it("hard-errors omitted personas in a multi-role batch on a multi-persona record, naming the searched persona", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...base, record_role: "father_of_deceased", fact_type: "name", value: "Thomas Flynn" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Both omitted-persona ops are named; stamping p_1 onto the father's
    // assertions was the observed silent corruption this scoping closes.
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*multiple personas in this record \(p_1, p_2\)/);
    expect(r.errors[1]).toMatch(/^ops\[1\]:/);
    expect(r.errors[0]).toMatch(/supply record_persona_id per assertion/);
    expect(r.errors[0]).toMatch(/searched persona is 'p_1'/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before); // nothing written
  });

  it("explicit record_persona_ids are unaffected by the multi-role scoping (verified as before)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased", record_persona_id: "p_1" } },
        {
          section: "assertions",
          op: "append",
          entry: {
            ...base,
            record_role: "father_of_deceased",
            fact_type: "name",
            value: "Thomas Flynn",
            record_persona_id: "p_2",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_2");
  });

  it("still auto-fills in a multi-role batch when the record holds a single persona (nothing to confuse)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar([
      { recordId: "ark:/61903/1:1:ABCD-123", primaryId: "p_1", gedcomx: { persons: [{ id: "p_1" }] } },
    ]);
    const base = {
      ...noId(validAssertion("x", "src_001")),
      record_id: "ark:/61903/1:1:ABCD-123",
      log_entry_id: "log_001",
    };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: { ...base, record_role: "deceased" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...base, record_role: "informant", fact_type: "name", value: "Mary Flynn" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    const research = await readResearch();
    expect(research.assertions[1].record_persona_id).toBe("p_1");
    expect(research.assertions[2].record_persona_id).toBe("p_1");
  });

  it("hard-errors when a supplied record_persona_id contradicts the sidecar, naming the expected personas", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            record_persona_id: "p_9",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'p_9' does not resolve/);
    expect(r.errors[0]).toMatch(/p_1, p_2/); // names the expected values
    expect(r.errors[0]).toMatch(/primary persona: p_1/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("hard-errors when a supplied record_id contradicts the sidecar (persona claimed), naming the stored recordIds", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ZZZZ-999",
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*'ark:\/61903\/1:1:ZZZZ-999' does not match any result/);
    expect(r.errors[0]).toMatch(/ABCD-123/); // names the expected value
  });

  it("allows a non-matching record_id when no persona is claimed (negative evidence against a collection)", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "1850-census-schuylkill",
            record_role: "absent",
            evidence_type: "negative",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect((await readResearch()).assertions[1].record_persona_id).toBeUndefined();
  });

  it("hard-errors a supplied record_persona_id when the log entry has no sidecar (results_ref null)", async () => {
    const research = baseResearch();
    research.log = [searchLogEntry(null)] as any;
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_persona_id: "p_1",
            log_entry_id: "log_001",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]: record_persona_id must be null/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("accepts an absent record_persona_id when the log entry has no sidecar (no error for absence)", async () => {
    const research = baseResearch();
    research.log = [searchLogEntry(null)] as any;
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), log_entry_id: "log_001" },
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  // ── Joint write: nothing written on failure ──

  it("writes NEITHER file when the research side fails validation after the in-memory tree mutation", async () => {
    await writeProject();
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    // fresh record_id so §3.4.1 doesn't divert to reuse; missing required `informant`
    const { informant: _i, ...badAssertion } = { ...noId(validAssertion("x", "src_002")), record_id: "rec-new" };
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" }, // would create S1 in the in-memory tree
      ops: [
        { section: "sources", op: "append", entry: sourceOpNoRef() },
        { section: "assertions", op: "append", entry: badAssertion },
      ],
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore); // S1 never persisted
    expect(await exists("tree.gedcomx.json.bak")).toBe(false); // no backup of a write that never happened
  });

  // ── Place levers ──

  it("resolves an omitted standard_place (geocode), echoes it in resolvedPlaces, and warns when no country to cross-check", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "Schuylkill County, Pennsylvania" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces).toEqual([
      {
        place: "Schuylkill County, Pennsylvania",
        standardPlace: "Schuylkill, Pennsylvania, United States",
        source: "geocoded",
      },
    ]);
    expect(r.validation.warnings.join(" ")).toMatch(/names no country/);
    expect((await readResearch()).assertions[1].standard_place).toBe("Schuylkill, Pennsylvania, United States");
  });

  it("copies the sidecar's resolved standard_place for the same place string instead of geocoding", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Pottsville, Pennsylvania",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces).toEqual([
      {
        place: "Pottsville, Pennsylvania",
        standardPlace: "Pottsville, Schuylkill, Pennsylvania, United States",
        source: "sidecar",
      },
    ]);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled(); // sidecar copy, no geocode
    expect((await readResearch()).assertions[1].standard_place).toBe(
      "Pottsville, Schuylkill, Pennsylvania, United States",
    );
  });

  it("rejects a geocode whose country contradicts the place text (England → Cameroon), writes nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, England" },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[0\]:.*Cameroon.*contradicts.*West Bromwich, England/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("rejects a SUPPLIED standard_place whose country contradicts the place text", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            place: "West Bromwich, England",
            standard_place: "Bamenda, Mezam, Northwest Region, Cameroon",
          },
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/contradicts/);
  });

  it("accepts a resolution whose country agrees with the place text, with no country warning", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, Staffordshire, England" },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.resolvedPlaces?.[0]?.standardPlace).toBe("West Bromwich, Staffordshire, England, United Kingdom");
    expect(r.validation.warnings.join(" ")).not.toMatch(/names no country/);
  });

  it("standard_place: null is an explicit opt-out — no resolution, no guard", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "West Bromwich, England", standard_place: null },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
    expect((await readResearch()).assertions[1].standard_place).toBeNull();
  });

  it("warns (never fails) when geocoding resolves nothing — the field is left unset", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x", "src_001")), place: "Nowhere Particular" }, // resolver mock → null
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.validation.warnings.join(" ")).toMatch(/could not resolve standard_place for 'Nowhere Particular'/);
    expect(r.resolvedPlaces).toBeUndefined();
    expect((await readResearch()).assertions[1].standard_place).toBeUndefined();
  });

  it("rejects an in-batch update of an id appended earlier in the same batch", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { id: _i, ...src } = validSource("x"); // carries SD-001
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src }, // → src_002
        { section: "sources", op: "update", entryId: "src_002", fields: { repository: "Ancestry" } },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:.*appended earlier in this batch/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("resolveStandardPlace: false skips geocoding but the sidecar copy still applies", async () => {
    await writeProject(sidecarResearch());
    await writeSidecar();
    const r = await researchAppend({
      projectPath: dir,
      resolveStandardPlace: false,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Pottsville, Pennsylvania",
          },
        },
        {
          section: "assertions",
          op: "append",
          entry: {
            ...noId(validAssertion("x", "src_001")),
            record_id: "ark:/61903/1:1:ABCD-123",
            log_entry_id: "log_001",
            place: "Somewhere Unstaged, Pennsylvania",
          },
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
    const research = await readResearch();
    expect(research.assertions[1].standard_place).toBe("Pottsville, Schuylkill, Pennsylvania, United States");
    expect(research.assertions[2].standard_place).toBeUndefined();
  });

  // ── §3.4.1: source-reuse auto-detection ──

  /** A schema-valid source without id/S-ref, with an overridable repository. */
  const reuseSourceOp = (repository = "NARA", extra: Record<string, unknown> = {}) => ({
    ...sourceOpNoRef(),
    repository,
    ...extra,
  });
  /** A schema-valid assertion without id/source_id, citing `recordId`. */
  const reuseAssertionOp = (recordId: string) => {
    const { source_id: _s, ...rest } = noId(validAssertion("x"));
    return { ...rest, record_id: recordId };
  };

  it("created: no existing source for the record_id → S created, sourceReuse echoed", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Federal Census" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp() },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec-new") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "created", srcId: "src_002", sId: "S1" });
    expect(r.sourceDescriptionId).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
  });

  it("updated_existing: same record_id + same repository → append converted to update, no new src/S", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "ignored — reuse wins" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("NARA", { notes: "refined on re-extraction" }) },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "updated_existing", srcId: "src_001", sId: "SD-001" });
    expect(r.sourceDescriptionId).toBeUndefined(); // sourceDescription ignored, no S created
    expect(r.filesWritten).toEqual(["research.json"]); // research-only write
    expect(r.results[0]).toEqual({ section: "sources", op: "update", entryId: "src_001" });
    const research = await readResearch();
    expect(research.sources).toHaveLength(1); // no duplicate source
    expect(research.sources[0].notes).toBe("refined on re-extraction"); // fields merged
    expect(research.sources[0].gedcomx_source_description_id).toBe("SD-001"); // S link kept
    expect(research.assertions[1].source_id).toBe("src_001"); // stamped with the existing src
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("updated_existing: repository matches on normalized form (case + whitespace)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("  nara ") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse?.action).toBe("updated_existing");
    expect(r.sourceReuse?.srcId).toBe("src_001");
  });

  it("new_source_reused_s: same record_id, different repository → new src_ citing the existing S; no S created", async () => {
    await writeProject();
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "ignored — the record's S already exists" },
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("Ancestry") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toEqual({ action: "new_source_reused_s", srcId: "src_002", sId: "SD-001" });
    expect(r.sourceDescriptionId).toBeUndefined();
    expect(r.filesWritten).toEqual(["research.json"]); // tree untouched
    const research = await readResearch();
    expect(research.sources).toHaveLength(2);
    expect(research.sources[1].id).toBe("src_002");
    expect(research.sources[1].repository).toBe("Ancestry");
    expect(research.sources[1].gedcomx_source_description_id).toBe("SD-001"); // reused S
    expect(research.assertions[1].source_id).toBe("src_002"); // auto-stamp with the NEW src
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
  });

  it("explicit gedcomx_source_description_id keeps today's semantics — no detection, no sourceReuse echo", async () => {
    await writeProject();
    const { id: _i, ...src } = validSource("x"); // carries SD-001 explicitly, repository NARA
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: src },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toBeUndefined();
    const research = await readResearch();
    expect(research.sources).toHaveLength(2); // a second NARA source was created as asked
    expect(research.sources[1].id).toBe("src_002");
  });

  it("multi-repo edge: updates the repository-equal source, not the first; a third repo reuses the FIRST match's S", async () => {
    const research = baseResearch();
    research.sources = [
      validSource("src_001"), // NARA, SD-001
      { ...validSource("src_002"), repository: "Ancestry", gedcomx_source_description_id: "SD-002" },
    ];
    research.assertions = [
      validAssertion("a_001", "src_001"), // rec1 via NARA
      validAssertion("a_002", "src_002"), // rec1 via Ancestry
    ];
    const tree = { ...baseTree, sources: [...baseTree.sources, { id: "SD-002", title: "Same census via Ancestry" }] };
    await writeProject(research, tree);

    // (a) repository matches the SECOND source → that one is updated.
    const a = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("Ancestry") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(a.ok).toBe(true);
    if (!a.ok || !("results" in a)) return;
    expect(a.sourceReuse).toEqual({ action: "updated_existing", srcId: "src_002", sId: "SD-002" });

    // (b) a third repository → new src_003 reusing the FIRST match's S (sources order).
    const b = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("MyHeritage") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("rec1") },
      ],
    });
    expect(b.ok).toBe(true);
    if (!b.ok || !("results" in b)) return;
    expect(b.sourceReuse).toEqual({ action: "new_source_reused_s", srcId: "src_003", sId: "SD-001" });
  });

  it("matches canonicalized record_id forms (resolver URL vs bare ARK vs type-prefixed)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), record_id: "https://www.familysearch.org/ark:/61903/1:1:MXYZ-TP4" },
    ];
    await writeProject(research);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: reuseSourceOp("NARA") },
        { section: "assertions", op: "append", entry: reuseAssertionOp("1:1:MXYZ-TP4") },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse?.action).toBe("updated_existing");
    expect(r.sourceReuse?.srcId).toBe("src_001");
  });

  it("no assertion appends in the batch → detection stays out (no sourceReuse)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "T" },
      ops: [{ section: "sources", op: "append", entry: reuseSourceOp() }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.sourceReuse).toBeUndefined();
    expect(r.sourceDescriptionId).toBe("S1");
  });
});

describe("countryConsistency heuristic", () => {
  it.each([
    ["West Bromwich, England", "West Bromwich, Staffordshire, England, United Kingdom", "ok"],
    ["West Bromwich, England", "Bamenda, Mezam, Northwest Region, Cameroon", "contradiction"],
    ["Oslo, Norway", "Oslo, Oslo, Norway", "ok"],
    ["Boston, USA", "Boston, Suffolk, Massachusetts, United States", "ok"], // alias
    ["Dublin, Ireland", "Belfast, Antrim, Northern Ireland, United Kingdom", "ok"], // historic-Ireland carve-out
    ["Glasgow, Scotland", "Cardiff, Wales, United Kingdom", "contradiction"], // different UK constituent
    ["Glasgow, Scotland", "Glasgow, Lanarkshire, United Kingdom", "ok"], // constituent within UK
    ["Schuylkill County, Pennsylvania", "Schuylkill, Pennsylvania, United States", "unverifiable"], // no country named
  ])("%s vs %s → %s", (place, standard, expected) => {
    expect(countryConsistency(place as string, standard as string)).toBe(expected);
  });
});
