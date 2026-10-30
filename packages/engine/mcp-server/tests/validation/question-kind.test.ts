/**
 * `questions[].question_kind` — issue #1830 item 1, from the lead's 2026-08-31
 * ruling on #1917.
 *
 * `question-selection` marks each new question `enumerative` (it asks for every
 * member of a set of people) or `targeted`. `research-plan` reads it to decide
 * whether the five-event breadth obligation applies. The field is optional by
 * that ruling: a thirteenth required question field would break every scenario
 * fixture until backfilled, so every question written before it existed must
 * still validate — the accept-direction case below.
 *
 * `checkEnum` has no null tolerance, so the arm is guarded by `"question_kind"
 * in q`; an unguarded call would fault the whole existing corpus. The schema
 * has no null branch either, so an explicit `null` is refused, not waved
 * through.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { validateParsed } from "../../src/validation/validator.js";

const minimalTree = { persons: [], relationships: [], sources: [] };

/** A research document whose single question carries `patch` on top of a
 *  well-formed question with no `question_kind`. */
function withQuestion(patch: Record<string, unknown>) {
  return {
    project: {
      id: "rp_001",
      objective: "Test project",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [
      {
        id: "q_001",
        question: "Who were the children of Lewis Joseph Reese and Laura Amelia Scott?",
        status: "open",
        priority: "high",
        created: "2026-01-01",
        rationale: "The family group is the question under research.",
        selection_basis: "user_directed",
        depends_on: [],
        unblocks: [],
        resolved: null,
        resolution_assertion_ids: [],
        search_stop: {
          stopped_because: null,
          log_entry_ids: [],
          stop_criteria: null,
          not_reached: [],
        },
        ...patch,
      },
    ],
    plans: [],
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
}

// `validateParsed` is async; a missing `await` leaves `result.valid` undefined.
async function validate(patch: Record<string, unknown>) {
  return validateParsed(withQuestion(patch), minimalTree);
}

describe("questions[].question_kind", () => {
  it("the battery can fail — a bogus value is rejected and named", async () => {
    const result = await validate({ question_kind: "banana" });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result.errors)).toContain("question_kind");
  });

  it("accepts a question with no question_kind — the existing corpus", async () => {
    expect((await validate({})).valid).toBe(true);
  });

  it.each(["enumerative", "targeted"])("accepts `%s`", async (kind) => {
    expect((await validate({ question_kind: kind })).valid).toBe(true);
  });

  it("rejects an explicit null — the schema has no null branch", async () => {
    expect((await validate({ question_kind: null })).valid).toBe(false);
  });

  it("rejects a near-miss spelling", async () => {
    expect((await validate({ question_kind: "enumeration" })).valid).toBe(false);
  });

  it("the accepted set is exactly those two, in both schema trees", async () => {
    // A per-value accept loop cannot catch an EXTRA value; compare the set.
    for (const tree of [
      "../../../../../docs/specs/schemas/enums.schema.json",
      "../../../../schema/schemas/enums.schema.json",
    ]) {
      const doc = JSON.parse(
        readFileSync(new URL(tree, import.meta.url), "utf-8"),
      ) as { $defs: { question_kind: { enum: string[] } } };
      expect([...doc.$defs.question_kind.enum].sort()).toEqual(["enumerative", "targeted"]);
    }
  });

  it("stays optional — not in either tree's required list", async () => {
    for (const tree of [
      "../../../../../docs/specs/schemas/research.schema.json",
      "../../../../schema/schemas/research.schema.json",
    ]) {
      const doc = JSON.parse(
        readFileSync(new URL(tree, import.meta.url), "utf-8"),
      ) as { $defs: { question: { required: string[] } } };
      expect(doc.$defs.question.required).not.toContain("question_kind");
    }
  });
});
