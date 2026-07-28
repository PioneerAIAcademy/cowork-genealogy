import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { researchQuery } from "../../src/tools/research-query.js";

describe("research_query", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeResearch(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  }

  it("filters assertions by recordId + recordRole", async () => {
    await writeResearch({
      assertions: [
        { id: "a_001", record_id: "REC1", record_role: "principal", fact_type: "birth" },
        { id: "a_002", record_id: "REC1", record_role: "child", fact_type: "birth" },
        { id: "a_003", record_id: "REC2", record_role: "principal", fact_type: "death" },
      ],
    });

    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      recordId: "REC1",
      recordRole: "principal",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.section).toBe("assertions");
    expect(result.count).toBe(1);
    expect(result.items.map((i) => i.id)).toEqual(["a_001"]);
    expect(result.truncated).toBe(false);
  });

  it("filters assertions by questionId — a CONTAINS match on extracted_for_question_ids", async () => {
    await writeResearch({
      assertions: [
        { id: "a_001", extracted_for_question_ids: ["q_001", "q_002"] },
        { id: "a_002", extracted_for_question_ids: ["q_003"] },
        { id: "a_003", extracted_for_question_ids: [] },
      ],
    });

    const result = await researchQuery({ projectPath: dir, section: "assertions", questionId: "q_002" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.id)).toEqual(["a_001"]);
  });

  it("filters person_evidence by personId", async () => {
    await writeResearch({
      person_evidence: [
        { id: "pe_001", assertion_id: "a_001", person_id: "I1" },
        { id: "pe_002", assertion_id: "a_002", person_id: "I2" },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "person_evidence", personId: "I1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.id)).toEqual(["pe_001"]);
  });

  it("filters proof_summaries by questionId", async () => {
    await writeResearch({
      proof_summaries: [
        { id: "ps_001", question_id: "q_001", tier: "probable" },
        { id: "ps_002", question_id: "q_002", tier: "proved" },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "proof_summaries", questionId: "q_002" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.id)).toEqual(["ps_002"]);
  });

  it("filters hypotheses by assertionId across EITHER supporting or contradicting ids", async () => {
    await writeResearch({
      hypotheses: [
        { id: "h_001", supporting_assertion_ids: ["a_001"], contradicting_assertion_ids: [] },
        { id: "h_002", supporting_assertion_ids: [], contradicting_assertion_ids: ["a_001"] },
        { id: "h_003", supporting_assertion_ids: ["a_999"], contradicting_assertion_ids: [] },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "hypotheses", assertionId: "a_001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.id).sort()).toEqual(["h_001", "h_002"]);
  });

  it("filters conflicts by questionId — a CONTAINS match on blocks_question_ids", async () => {
    await writeResearch({
      conflicts: [
        { id: "c_001", blocks_question_ids: ["q_001"], status: "unresolved" },
        { id: "c_002", blocks_question_ids: ["q_002"], status: "resolved" },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((i) => i.id)).toEqual(["c_001"]);
  });

  it("filters sources by sourceId (exact match on id)", async () => {
    await writeResearch({
      sources: [
        { id: "src_001", repository: "FamilySearch" },
        { id: "src_002", repository: "Ancestry" },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "sources", sourceId: "src_002" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([{ id: "src_002", repository: "Ancestry" }]);
  });

  it("returns the whole section, capped, when no filters are supplied", async () => {
    await writeResearch({
      proof_summaries: [{ id: "ps_001" }, { id: "ps_002" }],
    });
    const result = await researchQuery({ projectPath: dir, section: "proof_summaries" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
    expect(result.items).toHaveLength(2);
  });

  it("caps at 50 items and reports truncated:true with the true count", async () => {
    const assertions = Array.from({ length: 60 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const result = await researchQuery({ projectPath: dir, section: "assertions", recordId: "REC1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(60);
    expect(result.items).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("returns an empty (not an error) result when nothing matches", async () => {
    await writeResearch({ assertions: [{ id: "a_001", record_id: "REC1", record_role: "principal" }] });
    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      recordId: "REC9",
      recordRole: "principal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("rejects a filter not supported by the chosen section", async () => {
    await writeResearch({ proof_summaries: [{ id: "ps_001", question_id: "q_001" }] });
    const result = await researchQuery({
      projectPath: dir,
      section: "proof_summaries",
      recordId: "REC1", // recordId is an assertions-only filter
    } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/'recordId' is not a supported filter for section 'proof_summaries'/);
  });

  it("rejects an unknown section", async () => {
    await writeResearch({});
    const result = await researchQuery({ projectPath: dir, section: "not_a_real_section" as any });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/not one of/);
  });

  it("rejects when the section is missing or not an array", async () => {
    await writeResearch({ assertions: "not-an-array" });
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/missing or not an array/);
  });

  it("rejects when research.json is missing", async () => {
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/not found/);
  });

  it("evaluations takes no filters — combining any filter with it is an error", async () => {
    await writeResearch({ evaluations: [{ id: "ev_001" }] });
    const result = await researchQuery({ projectPath: dir, section: "evaluations", status: "open" } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/this section takes no filters/);
  });
});
