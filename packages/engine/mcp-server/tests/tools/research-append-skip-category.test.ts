/**
 * `research_append` refuses a bare `skipped` — issue #1830, the writer half.
 *
 * The schema makes `skip_category` legal; this is what makes it arrive. Six
 * skills may write a plan item's status, so the rule lives in the tool rather
 * than in six prose bodies (ADR-0011's first question: it is decidable from the
 * entry alone).
 *
 * Both directions are asserted, because the expensive failure here is the
 * accept direction. Every project on disk carries bare `skipped` items written
 * before the field existed, and `research-exhaustiveness` is not a permitted
 * writer of `plan_items` — so a refusal that fires on one of those would strand
 * the question with no route to repair.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchAppend } from "../../src/tools/research-append.js";

let dir: string;

const QUESTION = {
  id: "q_001",
  question: "Who did Anders Monsen marry?",
  status: "open",
  priority: "high",
  created: "2026-01-01",
  rationale: "The marriage is the question under research.",
  selection_basis: "user_directed",
  depends_on: [],
  unblocks: [],
  resolved: null,
  resolution_assertion_ids: [],
  exhaustive_declaration: { declared: false, log_entry_ids: [], stop_criteria: null },
};

function item(over: Record<string, unknown> = {}) {
  return {
    id: "pli_001",
    sequence: 1,
    record_type: "census",
    jurisdiction: "Hordaland, Norway",
    date_range: "1786",
    repository: "FamilySearch",
    rationale: "Why this item was planned.",
    fallback_for: null,
    status: "planned",
    ...over,
  };
}

function seed(items: Record<string, unknown>[]) {
  const research = {
    project: {
      id: "rp_001",
      objective: "Test",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [QUESTION],
    plans: [
      { id: "pl_001", question_id: "q_001", status: "active", created: "2026-01-01", items },
    ],
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
  writeFileSync(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    "utf-8",
  );
}

async function update(fields: Record<string, unknown>, entryId = "pli_001") {
  return researchAppend(
    {
      projectPath: dir,
      section: "plan_items",
      op: "update",
      planId: "pl_001",
      entryId,
      fields,
    } as never,
    undefined as never,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skipcat-"));
  mkdirSync(join(dir, "results"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("research_append refuses a bare skipped", () => {
  it("the battery can fail — a well-formed skip with a category is accepted", async () => {
    // The control. Without it a broken call signature reports every refusal
    // below as a pass.
    seed([item()]);
    const r = await update({ status: "skipped", skip_category: "answered" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("REFUSES status: skipped with no skip_category", async () => {
    seed([item()]);
    const r = await update({ status: "skipped" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("skip_category");
  });

  it("the refusal names every value the agent may pick", async () => {
    // A refusal that does not say what to send instead costs a retry loop.
    seed([item()]);
    const r = await update({ status: "skipped" });
    const msg = JSON.stringify(r);
    for (const v of [
      "answered",
      "inaccessible",
      "no_coverage",
      "fallback_not_triggered",
      "out_of_scope",
      "premise_invalidated",
      "user_declined",
    ]) {
      expect(msg, `missing ${v}`).toContain(v);
    }
  });

  it("ACCEPTS re-sending the UNCHANGED rationale alongside the skip", async () => {
    // A batched update that re-sends the whole entry has destroyed nothing.
    // Firing on mere presence refused a shape with no defect in it, which is
    // how an agent most naturally sends a status move (review, 2026-10-01).
    seed([item()]);
    const r = await update({
      status: "skipped",
      skip_category: "answered",
      rationale: "Why this item was planned.", // identical to the stored value
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("REFUSES an op that sets status and rewrites rationale together", async () => {
    seed([item()]);
    const r = await update({
      status: "skipped",
      skip_category: "answered",
      rationale: "Skipped because pli_002 already answered it.",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("rationale");
  });

  // --- the accept direction, which is the expensive one to get wrong --------

  it("ACCEPTS re-stating a bare skip written before this rule existed", async () => {
    // The whole installed corpus is this shape. Refusing it would strand the
    // question: the exhaustiveness agent cannot write plan_items to repair it.
    seed([item({ status: "skipped" })]);
    const r = await update({ status: "skipped" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("ACCEPTS a rationale correction on its own, with no status move", async () => {
    seed([item()]);
    const r = await update({ rationale: "Corrected: the register covers 1780-1790." });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("ACCEPTS the other status moves untouched", async () => {
    for (const status of ["in_progress", "planned"]) {
      seed([item()]);
      const r = await update({ status });
      expect(r.ok, `${status}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("ACCEPTS every one of the seven categories", async () => {
    for (const skip_category of [
      "answered",
      "inaccessible",
      "no_coverage",
      "fallback_not_triggered",
      "out_of_scope",
      "premise_invalidated",
      "user_declined",
    ]) {
      seed([item()]);
      const r = await update({ status: "skipped", skip_category });
      expect(r.ok, `${skip_category}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("refuses a bare skip arriving inline on a plans op, not just a plan_items op", async () => {
    // `{ ...entry }` on a plans append lands items[] directly, so a rule held
    // only in the plan_items arm is one spread away from being bypassed.
    seed([]);
    const r = await researchAppend(
      {
        projectPath: dir,
        section: "plans",
        op: "append",
        entry: {
          question_id: "q_001",
          status: "active",
          created: "2026-01-01",
          items: [item({ id: "pli_009", status: "skipped" })],
        },
      } as never,
      undefined as never,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("skip_category");
  });

  it("nothing is written when the call is refused", async () => {
    // A refusal that persisted half the op would be worse than no rule.
    seed([item()]);
    await update({ status: "skipped" });
    const after = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    expect(after.plans[0].items[0].status).toBe("planned");
  });
});
