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

  it("evaluations takes only targetId/focus — another filter is an error naming them", async () => {
    await writeResearch({ evaluations: [{ id: "ev_001" }] });
    const result = await researchQuery({ projectPath: dir, section: "evaluations", status: "open" } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(
      /'status' is not a supported filter for section 'evaluations' \(supported: targetId, focus\)/,
    );
  });

  it("filters evaluations by targetId + focus", async () => {
    await writeResearch({
      evaluations: [
        { id: "ev_001", focus: "proof-critique", target_id: "ps_001", superseded_by: "ev_003" },
        { id: "ev_002", focus: "on-demand", target_id: "ps_001", superseded_by: null },
        { id: "ev_003", focus: "proof-critique", target_id: "ps_001", superseded_by: null },
        { id: "ev_004", focus: "proof-critique", target_id: "ps_002", superseded_by: null },
      ],
    });

    const result = await researchQuery({
      projectPath: dir,
      section: "evaluations",
      targetId: "ps_001",
      focus: "proof-critique",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
    expect(result.items.map((e: any) => e.id)).toEqual(["ev_001", "ev_003"]);
  });

  // The filter layer deliberately cannot express `superseded_by: null` —
  // `matches()` compares against a string, and the field is `string | null`.
  // Both the superseded and the live verdict come back; picking the live one
  // is the caller's step (gps-mentor.md's existing-verdict skip says so). This
  // test pins that boundary so a future reader doesn't assume it filters.
  it("does not filter evaluations by superseded_by — both entries are returned", async () => {
    await writeResearch({
      evaluations: [
        { id: "ev_001", focus: "proof-critique", target_id: "ps_001", superseded_by: "ev_002" },
        { id: "ev_002", focus: "proof-critique", target_id: "ps_001", superseded_by: null },
      ],
    });

    const result = await researchQuery({
      projectPath: dir,
      section: "evaluations",
      targetId: "ps_001",
      focus: "proof-critique",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
    expect(result.items.filter((e: any) => e.superseded_by === null)).toHaveLength(1);
  });

  it("returns the whole evaluations section when no filter is supplied", async () => {
    await writeResearch({
      evaluations: [
        { id: "ev_001", focus: "proof-critique", target_id: "ps_001" },
        { id: "ev_002", focus: "on-demand", target_id: "project" },
      ],
    });
    const result = await researchQuery({ projectPath: dir, section: "evaluations" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
  });

  // ── offset pagination (#1031) ────────────────────────────────────────────

  it("pages the tail with offset: the 51st+ items are reachable", async () => {
    // 57 matches — the exact shape of the proof-conclusion gate that saw 50 of 57.
    const assertions = Array.from({ length: 57 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(57); // count stays the true total, unaffected by offset
    expect(result.items).toHaveLength(7); // items 51..57
    expect(result.items.map((i) => i.id)).toEqual([
      "a_50", "a_51", "a_52", "a_53", "a_54", "a_55", "a_56",
    ]);
    expect(result.truncated).toBe(false); // nothing beyond this page
  });

  it("still reports truncated:true when matches remain beyond the offset page", async () => {
    const assertions = Array.from({ length: 120 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(120);
    expect(result.items).toHaveLength(50); // items 51..100
    expect(result.truncated).toBe(true); // 101..120 still remain
  });

  it("truncated is false when the page ends exactly at count (offset + 50 == count)", async () => {
    // The > vs >= boundary: 100 total, offset 50 returns 51..100 and nothing is left.
    const assertions = Array.from({ length: 100 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(50);
    expect(result.truncated).toBe(false);
  });

  it("offset: 0 is identical to omitting offset (backward compatible)", async () => {
    const assertions = Array.from({ length: 60 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const withZero = await researchQuery({ projectPath: dir, section: "assertions", offset: 0 });
    const without = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(withZero).toEqual(without);
    if (!withZero.ok) return;
    expect(withZero.items).toHaveLength(50);
    expect(withZero.truncated).toBe(true);
  });

  it("an offset past the end returns an empty page, not an error", async () => {
    await writeResearch({
      assertions: [{ id: "a_0" }, { id: "a_1" }, { id: "a_2" }],
    });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(3); // the true total is still reported
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("offset pages the FILTERED set, not the raw array", async () => {
    const assertions = [
      ...Array.from({ length: 55 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" })),
      { id: "b_0", record_id: "REC2" },
      { id: "b_1", record_id: "REC2" },
    ];
    await writeResearch({ assertions });
    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      recordId: "REC1",
      offset: 50,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(55); // only the REC1 matches
    expect(result.items.map((i) => i.id)).toEqual(["a_50", "a_51", "a_52", "a_53", "a_54"]);
    expect(result.truncated).toBe(false);
  });

  // Reproduces the exact call from hannah-earnest-children idx 79
  // (offset: "50"), which was silently ignored before #1031. It is now a loud
  // rejection, not a wrong page. Reject rather than coerce — mirrors
  // person_search.offset's Number.isInteger validation.
  it("rejects a string offset ('50') instead of silently ignoring it", async () => {
    await writeResearch({ assertions: [{ id: "a_0", record_id: "REC1" }] });
    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      offset: "50" as any,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/offset must be a non-negative whole number/);
  });

  it("rejects a negative offset", async () => {
    await writeResearch({ assertions: [{ id: "a_0" }] });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/offset must be a non-negative whole number/);
  });

  it("rejects a non-integer offset", async () => {
    await writeResearch({ assertions: [{ id: "a_0" }] });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 1.5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/offset must be a non-negative whole number/);
  });
});
