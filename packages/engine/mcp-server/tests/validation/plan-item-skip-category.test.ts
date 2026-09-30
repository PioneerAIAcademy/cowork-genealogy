/**
 * `plan_item.skip_category` and `skip_reason` — issue #1830, Defect 1.
 *
 * `status: "skipped"` alone conflates two opposite claims: a decision was made
 * not to pursue the source (`unnecessary`), or the source could not be reached
 * so no decision about its content was possible (`inaccessible`). The
 * exhaustiveness gate has to tell those apart, and until this field existed the
 * distinction lived only in prose — the model was observed folding it into
 * `rationale`, a required field that means why the item was *planned*.
 *
 * Both fields are optional, so every plan item written before they existed must
 * still validate. That is the accept-direction case below, and it is the one a
 * guard on an optional field gets wrong: `checkEnum` has no null tolerance, so
 * an unguarded call faults on the whole existing corpus.
 *
 * The suite carries a fails-everything control for the same reason
 * `gate-vectors.test.ts` does: a miscalled signature reports success silently,
 * and a battery where nothing can fail is worse than no battery.
 */

import { describe, it, expect } from "vitest";
import { validateParsed } from "../../src/validation/validator.js";

const minimalResearch = {
  project: {
    id: "rp_001",
    objective: "Test project",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
  },
  questions: [],
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

const minimalTree = { persons: [], relationships: [], sources: [] };

/** A research document whose single plan item carries `patch` on top of a
 *  well-formed skipped item. */
function withPlanItem(patch: Record<string, unknown>) {
  return {
    ...minimalResearch,
    // The plan's question_id is a checked FK — without this the document is
    // invalid for a reason that has nothing to do with the field under test.
    questions: [
      {
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
        exhaustive_declaration: {
          declared: false,
          log_entry_ids: [],
          stop_criteria: null,
        },
      },
    ],
    plans: [
      {
        id: "pl_001",
        question_id: "q_001",
        status: "active",
        created: "2026-01-01",
        items: [
          {
            id: "pli_001",
            sequence: 1,
            record_type: "census",
            jurisdiction: "Hordaland, Norway",
            date_range: "1786",
            repository: "FamilySearch",
            rationale: "Why this item was planned.",
            fallback_for: null,
            status: "skipped",
            ...patch,
          },
        ],
      },
    ],
  };
}

// `validateParsed` is async. Awaiting it is not incidental: a missing `await`
// leaves `result.valid` undefined, which reads as neither true nor false and
// made all six cases below fail at once the first time this was written.
async function validate(patch: Record<string, unknown>) {
  return validateParsed(withPlanItem(patch), minimalTree);
}

describe("plan_item.skip_category", () => {
  it("the battery can fail — a bogus enum value is rejected", async () => {
    const result = await validate({ skip_category: "banana" });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result.errors)).toContain("skip_category");
  });

  it("rejects an unknown property — additionalProperties stays false", async () => {
    const result = await validate({ not_a_real_field: "x" });
    expect(result.valid).toBe(false);
  });

  it("accepts `inaccessible`", async () => {
    expect((await validate({ skip_category: "inaccessible" })).valid).toBe(true);
  });

  it("accepts `unnecessary` with a reason", async () => {
    const result = await validate({
      skip_category: "unnecessary",
      skip_reason: "The question was answered by pli_001; this item is moot.",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a skipped item carrying neither field", async () => {
    // Every plan item written before #1830 is this shape. Both fields are
    // optional, and the enum check is guarded, so the existing corpus validates
    // unchanged. Without the guard `checkEnum` faults on undefined here.
    expect((await validate({})).valid).toBe(true);
  });

  it("accepts a reason without a category", async () => {
    // Independent fields: prose alone is legal, it just tells the gate nothing.
    expect((await validate({ skip_reason: "Could not open the register." })).valid).toBe(true);
  });
});
