/**
 * `research_append` refuses a plan that buries the objective's target record —
 * issue #2030, the writer half (lead decision 2026-08-31).
 *
 * Both directions, through the tool: the #1945 ordering is refused whether the
 * plan arrives whole or an item at a time, and nothing that leaves the order
 * alone is refused — a status-only update, a later question's plan, an objective
 * that names no record, and a plan already out of order before this rule.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchAppend } from "../../src/tools/research-append.js";
import { writeProjectFileSync } from "../helpers/project-files.js";

let dir: string;

const OBJECTIVE =
  "Find the birth or baptism record of Hoval Hansen, born approximately 1780 in Kongsberg, Norway, " +
  "and died in Trysil, Norway 18 August 1860.";
const T = "Trysil, Hedmark, Norway";
const K = "Kongsberg, Buskerud, Norway";

function question(id: string) {
  return {
    id,
    question: `Question ${id}`,
    status: "open",
    priority: "high",
    created: "2026-01-01",
    rationale: "Under research.",
    selection_basis: "user_directed",
    depends_on: [],
    unblocks: [],
    resolved: null,
    resolution_assertion_ids: [],
    search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
  };
}

function item(id: string, sequence: number, jurisdiction: string, over: Record<string, unknown> = {}) {
  return {
    id,
    sequence,
    record_type: "church",
    jurisdiction,
    date_range: "1775-1785",
    repository: "FamilySearch",
    rationale: "Why this item was planned.",
    fallback_for: null,
    status: "planned",
    ...over,
  };
}

function newItem(sequence: number, jurisdiction: string, over: Record<string, unknown> = {}) {
  const { id: _id, ...rest } = item("x", sequence, jurisdiction, over);
  return rest;
}

function seed(opts: { objective?: string; plans?: unknown[]; questions?: unknown[] } = {}) {
  const research = {
    project: {
      id: "rp_001",
      objective: opts.objective ?? OBJECTIVE,
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: opts.questions ?? [question("q_001"), question("q_002")],
    plans: opts.plans ?? [],
    log: [],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
  writeProjectFileSync(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2), "utf-8");
}

const plan = (id: string, questionId: string, items: unknown[]) => ({
  id,
  question_id: questionId,
  status: "active",
  created: "2026-01-01",
  items,
});

const storedPlans = () => JSON.parse(readFileSync(join(dir, "research.json"), "utf-8")).plans;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-objective-target-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("research_append — the objective's target record leads the plan (#2030)", () => {
  it("refuses a whole plan that puts the Trysil burial ahead of the Kongsberg baptism", async () => {
    seed();
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "append",
      entry: {
        question_id: "q_001",
        status: "active",
        items: [item("pli_001", 1, T), item("pli_002", 2, K)],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/objective asks for a baptism record.*kongsberg.*Give pli_002 sequence 1/s);
    expect(storedPlans()).toEqual([]);
  });

  it("refuses appending the target item behind an existing item", async () => {
    seed({ plans: [plan("pl_001", "q_001", [item("pli_001", 1, T)])] });
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: newItem(2, K),
    });
    expect(r.ok).toBe(false);
    expect(storedPlans()[0].items).toHaveLength(1);
  });

  it("refuses making the target a fallback_for a Trysil item", async () => {
    seed({ plans: [plan("pl_001", "q_001", [item("pli_001", 1, T)])] });
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: newItem(1, K, { fallback_for: "pli_001" }),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/fallback_for pli_001/);
  });

  it("accepts the same items with the target first", async () => {
    seed();
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "append",
      entry: {
        question_id: "q_001",
        status: "active",
        items: [item("pli_001", 1, K), item("pli_002", 2, T)],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a reorder that fixes the plan", async () => {
    seed({ plans: [plan("pl_001", "q_001", [item("pli_001", 1, K), item("pli_002", 2, T)])] });
    const r: any = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_002", fields: { sequence: 3 } },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("does not judge a status-only update", async () => {
    seed({ plans: [plan("pl_001", "q_001", [item("pli_001", 1, T), item("pli_002", 2, K)])] });
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "update",
      planId: "pl_001",
      entryId: "pli_001",
      fields: { status: "in_progress" },
    });
    expect(r.ok).toBe(true);
  });

  it("does not strand a plan already out of order before the rule", async () => {
    seed({ plans: [plan("pl_001", "q_001", [item("pli_001", 1, T), item("pli_002", 2, K)])] });
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plan_items",
      op: "append",
      planId: "pl_001",
      entry: newItem(3, "Oslo, Norway"),
    });
    expect(r.ok).toBe(true);
  });

  it("does not hold a later question's plan to the project objective", async () => {
    seed();
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "append",
      entry: {
        question_id: "q_002",
        status: "active",
        items: [item("pli_001", 1, T), item("pli_002", 2, K)],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("does not fire when the objective names no record", async () => {
    seed({ objective: "Who were the parents of Hoval Hansen, born approximately 1780 in Kongsberg, Norway?" });
    const r: any = await researchAppend({
      projectPath: dir,
      section: "plans",
      op: "append",
      entry: {
        question_id: "q_001",
        status: "active",
        items: [item("pli_001", 1, T), item("pli_002", 2, K)],
      },
    });
    expect(r.ok).toBe(true);
  });
});
