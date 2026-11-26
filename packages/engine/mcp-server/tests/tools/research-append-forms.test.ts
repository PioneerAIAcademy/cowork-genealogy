/**
 * research_append's flat ops and plan form (issue #4866) convert into the
 * canonical batch before anything else reads the call, so each test below
 * compares the written project against the canonical call it stands for, or
 * checks that an ambiguous call writes nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchAppend, researchAppendFromCaller } from "../../src/tools/research-append.js";
import { canonicalOp, planFormMessage, PLAN_FORM_PLAN_ID } from "../../src/tools/research-append-forms.js";
import { writeProjectFileSync } from "../helpers/project-files.js";

const dirs: string[] = [];

const QUESTION = {
  id: "q_001",
  question: "Who were the parents of Patrick Flynn?",
  status: "open",
  priority: "high",
  created: "2026-01-01",
  rationale: "The parentage is the question under research.",
  selection_basis: "user_directed",
  depends_on: [],
  unblocks: [],
  resolved: null,
  resolution_assertion_ids: [],
  search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
};

const OLD_ITEM = {
  id: "pli_001",
  sequence: 1,
  record_type: "census",
  jurisdiction: "Schuylkill County, Pennsylvania",
  date_range: "1850",
  repository: "FamilySearch",
  rationale: "The 1850 census lists Patrick's household.",
  fallback_for: null,
  status: "completed",
};

function project(planStatus: "active" | "superseded"): string {
  const dir = mkdtempSync(join(tmpdir(), "ra-forms-"));
  dirs.push(dir);
  mkdirSync(join(dir, "results"), { recursive: true });
  const research = {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [QUESTION],
    plans: [{ id: "pl_001", question_id: "q_001", status: planStatus, created: "2026-01-01", items: [OLD_ITEM] }],
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
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf-8");
  return dir;
}

function plans(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, "research.json"), "utf-8")).plans;
}

function research(dir: string): string {
  return readFileSync(join(dir, "research.json"), "utf-8");
}

const PLAN = { question_id: "q_001", status: "active", created: "2026-05-04" };

function newItem(sequence: number, over: Record<string, unknown> = {}) {
  return {
    sequence,
    record_type: "vital_record",
    jurisdiction: "Schuylkill County, Pennsylvania",
    date_range: "1908",
    repository: "FamilySearch",
    rationale: `Item ${sequence}: Patrick's death certificate may name his parents.`,
    fallback_for: null,
    status: "planned",
    ...over,
  };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("plan form", () => {
  it("writes the same plans section as the canonical ops batch it stands for", async () => {
    const viaForm = project("superseded");
    const viaOps = project("superseded");
    const items = [newItem(1), newItem(2, { fallback_for: "pli_002" })];

    const a = await researchAppend({ projectPath: viaForm, plan: PLAN, planItems: items });
    const b = await researchAppend({
      projectPath: viaOps,
      ops: [
        { section: "plans", op: "append", entry: PLAN },
        ...items.map((entry) => ({ section: "plan_items" as const, op: "append" as const, planId: "pl_002", entry })),
      ],
    });

    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    expect(plans(viaForm)).toEqual(plans(viaOps));
    const ids = a.ok && "results" in a ? a.results.map((r) => r.entryId) : [];
    expect(ids).toEqual(["pl_002", "pli_002", "pli_003"]);
  });

  it("decodes a stringified plan and planItems", async () => {
    const dir = project("superseded");
    const r = await researchAppend({
      projectPath: dir,
      plan: JSON.stringify(PLAN) as never,
      planItems: JSON.stringify([newItem(1)]) as never,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("addresses a refused item by its planItems index, and writes nothing", async () => {
    const dir = project("superseded");
    const before = research(dir);
    const r = await researchAppend({
      projectPath: dir,
      plan: PLAN,
      planItems: [newItem(1), newItem(2, { status: "not_started" }), newItem(3, { status: "skipped" })],
    });
    expect(r.ok).toBe(false);
    const errors = r.ok ? [] : r.errors;
    // An op-level refusal is re-addressed to the item; a whole-document one names
    // the item by its index in the plan's `items`, which is its planItems index.
    expect(errors.some((e) => e.startsWith("planItems[2]: ")), JSON.stringify(errors)).toBe(true);
    expect(errors.some((e) => /^plan: research\.json\/plans\[1\]\/items\[1\]/.test(e)), JSON.stringify(errors)).toBe(true);
    expect(errors.some((e) => e.startsWith("ops[")), JSON.stringify(errors)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(PLAN_FORM_PLAN_ID);
    expect(research(dir)).toBe(before);
  });

  it("is refused by the canonical rules: a second active plan for the question", async () => {
    const dir = project("active");
    const before = research(dir);
    const r = await researchAppend({ projectPath: dir, plan: PLAN, planItems: [newItem(1)] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(PLAN_FORM_PLAN_ID);
    expect(research(dir)).toBe(before);
  });

  it.each([
    ["with ops", { ops: [{ section: "plans", op: "append", entry: PLAN }] }, "one of the three"],
    ["with section", { section: "plans", op: "append" }, "one of the three"],
    ["a plan that is not an object", { plan: ["x"] }, "`plan` must be"],
    ["no planItems", { planItems: undefined }, "`planItems` must be"],
    ["an item that is not an object", { planItems: ["x"] }, "planItems[0] must be an object"],
  ])("refuses the plan form %s, writing nothing", async (_label, over, message) => {
    const dir = project("superseded");
    const before = research(dir);
    const r = await researchAppend({ projectPath: dir, plan: PLAN, planItems: [newItem(1)], ...over } as never);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain(message);
    expect(research(dir)).toBe(before);
  });
});

describe("flat ops", () => {
  it("writes the same document as the wrapped ops, appends and updates both", async () => {
    const flat = project("active");
    const wrapped = project("active");
    const item = newItem(2);
    const a = await researchAppend({
      projectPath: flat,
      ops: [
        { section: "plan_items", op: "append", planId: "pl_001", ...item } as never,
        { section: "questions", op: "update", entryId: "q_001", priority: "medium" } as never,
      ],
    });
    const b = await researchAppend({
      projectPath: wrapped,
      ops: [
        { section: "plan_items", op: "append", planId: "pl_001", entry: item },
        { section: "questions", op: "update", entryId: "q_001", fields: { priority: "medium" } },
      ],
    });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    const strip = (s: string) => {
      const doc = JSON.parse(s);
      delete doc.project.updated;
      return doc;
    };
    expect(strip(research(flat))).toEqual(strip(research(wrapped)));
  });

  it("never moves one of the call's own arguments into an op's payload", async () => {
    // Measured: 24 committed person_evidence appends carry resolveStandardPlace
    // beside `entry`, and it has always been ignored there.
    const flat = project("active");
    const wrapped = project("active");
    const item = newItem(2);
    const a = await researchAppend({
      projectPath: flat,
      ops: [{ section: "plan_items", op: "append", planId: "pl_001", resolveStandardPlace: false, ...item } as never],
    });
    const b = await researchAppend({
      projectPath: wrapped,
      ops: [{ section: "plan_items", op: "append", planId: "pl_001", resolveStandardPlace: false, entry: item } as never],
    });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    expect(plans(flat)).toEqual(plans(wrapped));
  });

  it("refuses an op carrying both a wrapper and loose fields, writing nothing", async () => {
    const dir = project("active");
    const before = research(dir);
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "questions", op: "update", entryId: "q_001", fields: { priority: "medium" } },
        { section: "plan_items", op: "append", planId: "pl_001", entry: newItem(2), status: "planned" } as never,
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.errors.join("\n")).toMatch(/^ops\[1\]: carries both `entry`/);
    expect(research(dir)).toBe(before);
  });

  it("still refuses a flat assertions write from a caller", async () => {
    const dir = project("active");
    const r = await researchAppendFromCaller(
      { projectPath: dir, ops: [{ section: "assertions", op: "update", entryId: "a_001", value: "x" } as never] },
      null,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("does not write assertions");
  });

  it("lets a flat informant_bias_notes update past the caller guard", async () => {
    const dir = project("active");
    const r = await researchAppendFromCaller(
      {
        projectPath: dir,
        ops: [{ section: "assertions", op: "update", entryId: "a_001", informant_bias_notes: "re-read" } as never],
      },
      null,
    );
    expect(JSON.stringify(r)).not.toContain("does not write assertions");
  });
});

describe("canonicalOp", () => {
  it.each([
    ["no payload keys", { section: "plans", op: "update", entryId: "pl_001", fields: { status: "completed" } }],
    ["an unknown op kind", { section: "plans", op: "delete", entryId: "pl_001", status: "x" }],
    ["a string", "not an op"],
    ["null", null],
  ])("leaves %s unchanged", (_label, op) => {
    expect(canonicalOp(op)).toEqual({ op });
  });

  it("moves `verdict` into the payload: it is a field of hit_verdicts and evaluations entries", () => {
    const append = { section: "hit_verdicts", op: "append", log_id: "log_001", hit_id: "h1", verdict: "match" };
    expect(canonicalOp(append).op).toEqual({
      section: "hit_verdicts",
      op: "append",
      entry: { log_id: "log_001", hit_id: "h1", verdict: "match" },
    });
    const update = { section: "evaluations", op: "update", entryId: "ev_001", verdict: "pass" };
    expect(canonicalOp(update).op).toEqual({
      section: "evaluations",
      op: "update",
      entryId: "ev_001",
      fields: { verdict: "pass" },
    });
  });

  it("keeps every canonical key on the op and moves the rest", () => {
    const op = { section: "proof_summaries", op: "update", entryId: "ps_001", edits: [], tier: "probable" };
    expect(canonicalOp(op).op).toEqual({
      section: "proof_summaries",
      op: "update",
      entryId: "ps_001",
      edits: [],
      fields: { tier: "probable" },
    });
  });
});

describe("planFormMessage", () => {
  it("maps ops[0] to plan and ops[k] to planItems[k-1], leaving other text alone", () => {
    expect(planFormMessage("ops[0]: bad plan")).toBe("plan: bad plan");
    expect(planFormMessage("ops[3]: bad item")).toBe("planItems[2]: bad item");
    expect(planFormMessage("validation: ops[2] mentioned mid-text")).toBe("validation: ops[2] mentioned mid-text");
  });
});
