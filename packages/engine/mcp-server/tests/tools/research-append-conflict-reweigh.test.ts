import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { cp, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { conflictReweighRefusals, researchAppend } from "../../src/tools/research-append.js";

// An analysed conflict is not weighed again, and a new one is not written
// already weighed, while another open conflict on the same question has never
// been weighed. thomas-hanrahan-marriage 2026-11-18 14:12: conflict-resolution
// re-weighed c_003 three times and appended an analysed c_004, and never weighed
// c_001 or c_002, until the tool-call cap.

const MESSAGE = "never been weighed";

const analysed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  conflict_type: "identity",
  identity_question: `Question ${id}?`,
  competing_assertion_ids: ["a_001", "a_002"],
  status: "unresolved",
  preferred_assertion_id: null,
  independence_analysis: "Different creators.",
  weighing_analysis: "Neither outweighs the other.",
  resolution_rationale: null,
  blocks_question_ids: ["q_001"],
  ...extra,
});
const bare = (id: string, extra: Record<string, unknown> = {}) =>
  analysed(id, { independence_analysis: null, weighing_analysis: null, ...extra });

const doc = (conflicts: any[], extra: Record<string, unknown> = {}) => ({
  questions: [
    { id: "q_001", question: "When did they marry?", status: "open" },
    { id: "q_002", question: "Where was he born?", status: "open" },
  ],
  assertions: [
    { id: "a_001", extracted_for_question_ids: ["q_001"] },
    { id: "a_002", extracted_for_question_ids: ["q_001"] },
    { id: "a_009", extracted_for_question_ids: ["q_002"] },
  ],
  conflicts,
  ...extra,
});

const upd = (entryId: string, opIndex = 0) => ({ section: "conflicts", entryId, opIndex, noop: false }) as any;

function reweigh(before: any[], change: (c: any[]) => void, applied = [upd("c_003")]) {
  const b = doc(structuredClone(before));
  const a = doc(structuredClone(before));
  change(a.conflicts);
  return conflictReweighRefusals(b, a, applied);
}

describe("conflictReweighRefusals", () => {
  it("refuses re-weighing an analysed conflict while a sibling blocking the same question is bare", () => {
    for (const field of ["independence_analysis", "weighing_analysis", "resolution_rationale"]) {
      const r = reweigh([bare("c_001"), analysed("c_003")], (c) => { c[1][field] = "Weighed again."; });
      expect(r).toHaveLength(1);
      expect(r[0].message).toContain(MESSAGE);
      expect(r[0].message).toContain("c_001");
      expect(r[0].message).toContain("c_003");
      expect(r[0].message).toContain("q_001");
    }
  });

  it("refuses resolving an analysed unresolved conflict beside a bare sibling", () => {
    const r = reweigh([bare("c_001"), analysed("c_003")], (c) => {
      Object.assign(c[1], { status: "resolved", preferred_assertion_id: "a_001", resolution_kind: "competitor", resolution_rationale: "The census." });
    });
    expect(r).toHaveLength(1);
  });

  it("finds a sibling that blocks through the question's assertions rather than blocks_question_ids", () => {
    const r = reweigh([bare("c_001", { blocks_question_ids: [] }), analysed("c_003")], (c) => { c[1].weighing_analysis = "Again."; });
    expect(r).toHaveLength(1);
  });

  it("refuses appending a conflict already weighed while a pre-call sibling is bare", () => {
    const before = doc([bare("c_001")]);
    const after = doc([bare("c_001"), analysed("c_004")]);
    const r = conflictReweighRefusals(before, after, [upd("c_004")]);
    expect(r).toHaveLength(1);
    expect(r[0].message).toContain("c_001");
    expect(r[0].message).toContain("without its analysis");
  });

  it("is silent on a first analysis", () => {
    expect(reweigh([bare("c_001"), bare("c_003")], (c) => { Object.assign(c[1], analysed("c_003")); })).toEqual([]);
  });

  it("is silent when the bare siblings are registered in the same call as an analysed append", () => {
    const after = doc([bare("c_001"), bare("c_002"), analysed("c_003")]);
    const applied = [upd("c_001", 0), upd("c_002", 1), upd("c_003", 2)];
    expect(conflictReweighRefusals(doc([]), after, applied)).toEqual([]);
  });

  it("is silent when the call also weighs the bare sibling, in either order", () => {
    for (const applied of [[upd("c_001", 0), upd("c_003", 1)], [upd("c_003", 0), upd("c_001", 1)]]) {
      const r = reweigh([bare("c_001"), analysed("c_003")], (c) => {
        Object.assign(c[0], { independence_analysis: "First look.", weighing_analysis: "Open." });
        c[1].weighing_analysis = "Again.";
      }, applied);
      expect(r).toEqual([]);
    }
  });

  it("is silent on a description edit, a stamped weighed_log_entry_ids, or a move to moot", () => {
    const changes: ((c: any[]) => void)[] = [
      (c) => { c[1].description = "Reworded."; },
      (c) => { c[1].weighed_log_entry_ids = ["log_001"]; },
      (c) => { Object.assign(c[1], { status: "moot", resolution_rationale: "A duplicate of c_001." }); },
    ];
    for (const change of changes) expect(reweigh([bare("c_001"), analysed("c_003")], change)).toEqual([]);
  });

  it("is silent when the bare conflict blocks another question, or is resolved or moot", () => {
    for (const sibling of [
      bare("c_001", { blocks_question_ids: ["q_002"], competing_assertion_ids: ["a_009"] }),
      bare("c_001", { status: "moot", resolution_rationale: "Does not bear." }),
    ]) {
      expect(reweigh([sibling, analysed("c_003")], (c) => { c[1].weighing_analysis = "Again."; })).toEqual([]);
    }
  });

  it("is silent on re-opening a resolved conflict beside a bare sibling", () => {
    const resolved = analysed("c_003", { status: "resolved", preferred_assertion_id: "a_001", resolution_kind: "competitor", resolution_rationale: "The census." });
    const r = reweigh([bare("c_001"), resolved], (c) => {
      Object.assign(c[1], { status: "unresolved", preferred_assertion_id: null, resolution_kind: null, independence_analysis: null, weighing_analysis: null, resolution_rationale: null });
    });
    expect(r).toEqual([]);
  });

  it("is silent when the write clears the analysis", () => {
    const r = reweigh([bare("c_001"), analysed("c_003")], (c) => { Object.assign(c[1], { independence_analysis: null, weighing_analysis: null }); });
    expect(r).toEqual([]);
  });
});

const RUN_1412 = join(__dirname, "../../../../../eval/runlogs/e2e/thomas-hanrahan-marriage/run-2026-11-18_14-12-58");

async function runDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "conflict-reweigh-"));
  await cp(`${RUN_1412}.final-research.json`, join(dir, "research.json"));
  await cp(`${RUN_1412}.final-tree.gedcomx.json`, join(dir, "tree.gedcomx.json"));
  return dir;
}

const weigh = (entryId: string, text: string) => ({
  section: "conflicts",
  op: "update",
  entryId,
  fields: { independence_analysis: `${text} independence.`, weighing_analysis: `${text} weighing.` },
});

describe("research_append on run 2026-11-18 14:12 (c_001, c_002 bare; c_003, c_004 analysed)", () => {
  it("refuses re-weighing c_003 and names the bare conflicts", async () => {
    const dir = await runDir();
    try {
      const r: any = await researchAppend({ projectPath: dir, ...weigh("c_003", "Again") } as any);
      expect(r.ok).toBe(false);
      const text = JSON.stringify(r.errors);
      expect(text).toContain(MESSAGE);
      expect(text).toContain("c_001");
      expect(text).toContain("c_002");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses appending another analysed conflict on q_001", async () => {
    const dir = await runDir();
    try {
      const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
      const c4 = research.conflicts.find((c: any) => c.id === "c_004");
      const { id: _id, ...entry } = { ...c4, competing_assertion_ids: ["a_027", "a_064", "a_026"] };
      const r: any = await researchAppend({ projectPath: dir, section: "conflicts", op: "append", entry } as any);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r.errors)).toContain(MESSAGE);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts weighing c_002, and re-weighing c_003 in the call that weighs both bare ones", async () => {
    const dir = await runDir();
    try {
      const first: any = await researchAppend({ projectPath: dir, ...weigh("c_002", "First") } as any);
      expect(first.ok).toBe(true);
      const both: any = await researchAppend({
        projectPath: dir,
        ops: [weigh("c_003", "Again"), weigh("c_001", "First")],
      } as any);
      expect(both.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("once c_001 and c_002 are weighed, accepts a not_proved proof rejecting Ballylooby and refuses Ballylooby at possible", async () => {
    const dir = await runDir();
    try {
      const weighed: any = await researchAppend({ projectPath: dir, ops: [weigh("c_001", "First"), weigh("c_002", "First")] } as any);
      expect(weighed.ok).toBe(true);
      const proof = (entry: Record<string, unknown>) => researchAppend({
        projectPath: dir,
        section: "proof_summaries",
        op: "append",
        entry: { question_id: "q_001", vehicle: "argument", resolved_conflict_ids: [], claims: [], shortfall: "gap", exhaustive_search_summary: "New York censuses and marriage indexes; the Tipperary registers.", ...entry },
      } as any);
      const ballylooby: any = await proof({
        tier: "possible",
        supporting_assertion_ids: ["a_084", "a_095"],
        narrative_markdown: "## Conclusion\nThomas Hanrahan and Johanna Ryan possibly married at Ballylooby on 1 February 1868.\n",
      });
      expect(ballylooby.ok).toBe(false);
      expect(JSON.stringify(ballylooby.errors)).toContain("c_003");
      const unidentified: any = await proof({
        tier: "not_proved",
        supporting_assertion_ids: ["a_120", "a_026", "a_027", "a_052"],
        narrative_markdown: "## Conclusion\nThe Saratoga marriage is not identified. The 1868 Ballylooby marriage is rejected: the 1870 and 1880 censuses give the couple New York-born children from about 1864. Ryan is not established as Johanna's surname.\n",
      });
      expect(unidentified.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Keep the fixture honest: the run state this file replays is the starvation shape.
it("the 14:12 final state holds two bare and two analysed open conflicts on q_001", async () => {
  const research = JSON.parse(readFileSync(`${RUN_1412}.final-research.json`, "utf-8"));
  const open = research.conflicts.filter((c: any) => c.status === "unresolved");
  const isA = (c: any) => typeof c.independence_analysis === "string" && c.independence_analysis.trim() !== "";
  expect(open.filter(isA).map((c: any) => c.id)).toEqual(["c_003", "c_004"]);
  expect(open.filter((c: any) => !isA(c)).map((c: any) => c.id)).toEqual(["c_001", "c_002"]);
});
