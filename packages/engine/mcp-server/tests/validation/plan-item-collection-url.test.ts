/**
 * `plan_item.collection_url` — issue #2995. Optional, so every plan item written
 * before it existed must still validate; when present it is a non-empty string.
 * Whether the URL is in `external-collections.json` is `research_append`'s
 * precondition, not the validator's: the validator reads research.json alone.
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
 *  well-formed planned item. */
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
            status: "planned",
            ...patch,
          },
        ],
      },
    ],
  };
}

async function validate(patch: Record<string, unknown>) {
  return validateParsed(withPlanItem(patch), minimalTree);
}

describe("plan_item.collection_url", () => {
  it("accepts an item without it", async () => {
    expect((await validate({})).valid).toBe(true);
  });

  it("accepts a URL string", async () => {
    const result = await validate({ collection_url: "https://www.ancestry.com/search/collections/7163/" });
    expect(result.errors).toEqual([]);
  });

  it.each([[""], [42], [null], [["https://x"]]])("rejects %j", async (value) => {
    const result = await validate({ collection_url: value });
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result.errors)).toContain("collection_url");
  });
});
