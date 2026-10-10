/**
 * `plan_item.skip_category` and `skip_reason` — issue #1830, Defect 1.
 *
 * `status: "skipped"` alone conflates claims that pull opposite ways at the
 * gate: a source that could not be evaluated at all (`inaccessible`,
 * `no_coverage`) against one reachable that a decision was taken about
 * (`answered`, `fallback_not_triggered`, `out_of_scope`,
 * `premise_invalidated`, `user_declined`). The exhaustiveness gate has to tell
 * those apart, and until this field existed the distinction lived only in
 * prose — the model was observed folding it into `rationale`, a required field
 * that means why the item was *planned*.
 *
 * Seven values, not the two an earlier draft of this suite asserted: the list
 * is fixed by a comment on #1830, and `user_declined` was added by the lead's
 * 2026-09-27 ruling on #2213 so a user's refusal stays separable from the
 * agent's own `out_of_scope` judgement. `unnecessary` was never one of them.
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

import { readFileSync } from "node:fs";
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

  it("rejects `unnecessary` — the value an earlier draft of this card invented", async () => {
    // Pinned rather than merely deleted. `unnecessary` reads like it belongs
    // and is what the card's "at minimum separating `unnecessary` from
    // `inaccessible`" line suggests, so without this the wrong value could be
    // reintroduced by someone reading only the issue body.
    const result = await validate({ skip_category: "unnecessary" });
    expect(result.valid).toBe(false);
  });

  it.each([
    "answered",
    "inaccessible",
    "no_coverage",
    "fallback_not_triggered",
    "out_of_scope",
    "premise_invalidated",
    "user_declined",
  ])("accepts `%s`", async (category) => {
    expect((await validate({ skip_category: category })).valid).toBe(true);
  });

  it("the accepted set is exactly those seven, in both schema trees", async () => {
    // A per-value accept loop cannot catch an EXTRA value: adding an eighth to
    // the enum leaves all seven passing. Compare the set.
    const expected = [
      "answered", "fallback_not_triggered", "inaccessible", "no_coverage",
      "out_of_scope", "premise_invalidated", "user_declined",
    ];
    for (const tree of [
      "../../../../../docs/specs/schemas/enums.schema.json",
      "../../../../schema/schemas/enums.schema.json",
    ]) {
      const doc = JSON.parse(
        readFileSync(new URL(tree, import.meta.url), "utf-8"),
      ) as { $defs: { skip_category: { enum: string[] } } };
      expect([...doc.$defs.skip_category.enum].sort()).toEqual(expected);
    }
  });

  it("accepts a category with a reason", async () => {
    const result = await validate({
      skip_category: "answered",
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
