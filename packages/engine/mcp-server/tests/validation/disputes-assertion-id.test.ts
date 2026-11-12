/**
 * `assertions[].disputes_assertion_id` (#4286; research-schema-spec.md): a page
 * reading names the index assertion on its own source that it disputes.
 */

import { describe, it, expect } from "vitest";
import { validateParsed } from "../../src/validation/validator.js";

function research() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [], log: [], sources: [] as any[], assertions: [] as any[], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

const src = (id: string) => ({
  id, citation: "c", source_classification: "derivative", repository: "r", access_date: "2026-01-01",
});

const a = (id: string, more: Record<string, unknown> = {}) => ({
  id, source_id: "src_001", record_id: "REC1", record_role: "principal", fact_type: "name", value: "X",
  information_quality: "primary", informant: "x", informant_proximity: "self", record_basis: "stated",
  extracted_for_question_ids: [], ...more,
});

async function errorsOf(assertions: any[]): Promise<string> {
  const doc = research();
  doc.sources.push(src("src_001"), src("src_002"));
  doc.assertions = assertions;
  const v = await validateParsed(doc, { persons: [], relationships: [], sources: [] });
  return v.errors.map((e: any) => e.message ?? String(e)).join(" | ");
}

describe("validator: an assertion's disputes_assertion_id", () => {
  it("accepts a dispute of an assertion on the same source", async () => {
    expect(await errorsOf([a("a_001"), a("a_002", { value: "Y [?]", disputes_assertion_id: "a_001" })])).not.toMatch(/disputes_assertion_id/);
  });

  it("accepts a dispute of a retired assertion, which the dispute follows to its successor", async () => {
    expect(
      await errorsOf([
        a("a_001", { superseded_by: "a_003" }),
        a("a_002", { value: "Y [?]", disputes_assertion_id: "a_001" }),
        a("a_003"),
      ]),
    ).not.toMatch(/disputes_assertion_id|does not exist/);
  });

  it.each([
    ["a dangling id", { disputes_assertion_id: "a_099" }, /a_099' which does not exist/],
    ["itself", { disputes_assertion_id: "a_002" }, /names the assertion itself/],
    ["a non-string", { disputes_assertion_id: 7 }, /disputes_assertion_id must be a string, got number/],
    ["null", { disputes_assertion_id: null }, /disputes_assertion_id must be a string, got null/],
    ["another prefix", { disputes_assertion_id: "pe_001" }, /must be an 'a_' id/],
  ])("refuses %s", async (_label, more, message) => {
    expect(await errorsOf([a("a_001"), a("a_002", more)])).toMatch(message);
  });

  it("refuses a dispute of another source's assertion", async () => {
    expect(
      await errorsOf([a("a_001", { source_id: "src_002" }), a("a_002", { disputes_assertion_id: "a_001" })]),
    ).toMatch(/is on source 'src_002', not this assertion's source 'src_001'/);
  });
});
