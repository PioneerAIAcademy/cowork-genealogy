import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { evaluationAppend } from "../../src/tools/evaluation-append.js";

// `evaluation_append` is `research_append` scoped to the `evaluations` section by
// tool identity (ADR-0006). These tests pin the lane: an `evaluations` write is
// accepted, and a write to any other section is refused with the lane error and
// leaves research.json untouched.
//
// DELIBERATE-BREAK DISCRIMINATOR: the refuse tests assert the *lane* error
// (`is not writable by evaluation_append`), which the gate emits BEFORE any
// validation. Widen `EVALUATION_SECTIONS` in `evaluation-append.ts` to include
// `proof_summaries` / `conflicts` and these two tests fail — the gate lets the op
// through and the error is gone. That is the proof the lane, not an invalid
// entry shape, is what does the refusing. (An invalid `proof_summaries` entry
// would otherwise also fail, which is why the message, not merely `ok: false`,
// is asserted.)

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
  record_basis: "stated",
  extracted_for_question_ids: [],
});

function baseResearch(): Record<string, unknown> {
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

describe("evaluation_append (lane gate)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "evaluation-append-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  it("appends an evaluation and assigns an ev_ id", async () => {
    await writeProject();
    const r = await evaluationAppend({
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
    } as any);
    expect(r.ok).toBe(true);
    const ev = (await readResearch()).evaluations;
    expect(ev).toHaveLength(1);
    expect(ev[0].id).toMatch(/^ev_/);
  });

  it("refuses a single op outside the lane, naming only evaluation_append, writing nothing", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await evaluationAppend({
      projectPath: dir,
      section: "proof_summaries",
      op: "append",
      entry: { narrative_markdown: "## Conclusion", question_id: "q_001" },
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected evaluation_append to refuse the proof_summaries op");
    const text = (r.errors ?? []).join(" ");
    expect(text).toContain("section 'proof_summaries' is not writable by evaluation_append");
    expect(text).toContain("it writes only: evaluations");
    // The message must not hand the agent a routing map to the broad writer.
    expect(text).not.toContain("research_append");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("refuses an ops batch the moment one op leaves the lane", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await evaluationAppend({
      projectPath: dir,
      ops: [
        {
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
        },
        { section: "conflicts", op: "append", entry: {} },
      ],
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected evaluation_append to refuse the batch with a conflicts op");
    const text = (r.errors ?? []).join(" ");
    expect(text).toContain("is not writable by evaluation_append");
    // All-or-nothing: the valid evaluations op in the same batch is not written.
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });
});
