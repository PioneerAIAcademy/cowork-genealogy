import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

import {
  researchQuery,
  RESEARCH_QUERY_SECTIONS,
  RESEARCH_QUERY_EXCLUDED,
  RESEARCH_QUERY_OPTIONAL_SECTIONS,
  SECTION_FILTERS,
  flattenAssertionGroups,
} from "../../src/tools/research-query.js";

/** An `assertions` answer as flat assertions (the tool returns them grouped). */
const flat = (r: { items: unknown[] }, questionId?: string): any[] =>
  flattenAssertionGroups(r.items, questionId) as any[];

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
    expect(flat(result).map((i) => i.id)).toEqual(["a_001"]);
    expect(result.truncated).toBe(false);
  });

  it("filters assertions by assertionId — an EXACT match on the assertion's own id", async () => {
    // The field is `id`. An assertion object has no `assertion_id` key — that
    // is person_evidence's POINTER to one — so a rule on `assertion_id` here
    // is accepted by the tool and matches nothing, ever, returning a silent
    // `count: 0` indistinguishable from "no such assertion".
    //
    // Two assertions, and the assertion is on EXACTLY one: a test that only
    // checked "did not throw", or "returned something", passes under the wrong
    // field (0 items) and under a widened mode.
    await writeResearch({
      assertions: [
        { id: "a_001", record_id: "REC1", record_role: "principal", fact_type: "birth" },
        { id: "a_002", record_id: "REC2", record_role: "child", fact_type: "death" },
      ],
    });

    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      assertionId: "a_002",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(1);
    expect(flat(result).map((i) => i.id)).toEqual(["a_002"]);
  });

  it("every SECTION_FILTERS field names a real property on that section's schema", async () => {
    // The class guard, not a second one-off. A rule naming a field the section
    // does not have compiles, passes every test, is accepted by the tool, and
    // returns `count: 0` forever -- the exact defect the `assertionId`/
    // `assertion_id` comment warns about in prose. CLAUDE.md: when the bug is
    // the second instance of a class, write one shared guard.
    const schema = JSON.parse(
      readFileSync(
        join(__dirname, "..", "..", "..", "..", "..", "docs", "specs", "schemas", "research.schema.json"),
        "utf-8",
      ),
    );
    const bad: string[] = [];
    for (const [section, filters] of Object.entries(SECTION_FILTERS)) {
      const ref = schema.properties?.[section]?.items?.$ref;
      if (!ref) continue; // not an array-of-objects section; nothing to check
      const def = schema.$defs?.[ref.replace("#/$defs/", "")];
      const props = def?.properties ?? {};
      for (const [key, rule] of Object.entries(filters as Record<string, any>)) {
        for (const f of rule.fields ?? [rule.field]) {
          if (f && !(f in props)) bad.push(`${section}.${key} -> ${f}`);
        }
      }
    }
    expect(
      bad,
      `these filter rules name a field the section's schema does not have, so ` +
        `they are accepted by the tool and match nothing, ever: ${bad.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps assertionId mapped to a DIFFERENT field on each sibling section", async () => {
    // Five sections take `assertionId` and it means two different things: on
    // `assertions` the item's own `id`, everywhere else a field REFERENCING an
    // assertion. Only `assertions` and `hypotheses` were pinned, so an editor
    // seeing `{field:"id"}` directly above `person_evidence: {field:
    // "assertion_id"}` could "fix the inconsistency" to `id` — after which
    // person_evidence matches nothing ever (a pe_ entry's id starts with pe_),
    // person-evidence's "an empty result IS the answer: unlinked" idiom calls
    // every assertion unlinked, and the suite stays green.
    await writeResearch({
      assertions: [{ id: "a_001", fact_type: "birth" }],
      person_evidence: [{ id: "pe_001", person_id: "P1", assertion_id: "a_001" }],
      conflicts: [{ id: "c_001", competing_assertion_ids: ["a_001"], status: "open" }],
      proof_summaries: [{ id: "ps_001", supporting_assertion_ids: ["a_001"] }],
    });

    for (const [section, id] of [
      ["person_evidence", "pe_001"],
      ["conflicts", "c_001"],
      ["proof_summaries", "ps_001"],
    ] as const) {
      const r = await researchQuery({ projectPath: dir, section, assertionId: "a_001" });
      expect(r.ok, section).toBe(true);
      if (!r.ok) return;
      expect(r.count, section).toBe(1);
      expect(r.items.map((i) => i.id), section).toEqual([id]);
    }

    // ...and the same id on `assertions` returns the assertion itself, not
    // anything referencing it.
    const own = await researchQuery({
      projectPath: dir,
      section: "assertions",
      assertionId: "a_001",
    });
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(flat(own).map((i) => i.id)).toEqual(["a_001"]);
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
    expect(flat(result).map((i) => i.id)).toEqual(["a_001"]);
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
      assertions: [],
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

  it("conflicts × questionId also matches a conflict over the question's own assertions, at any status", async () => {
    // ut_search_external_sites_013: the birthplace conflict was resolved, so its
    // blocks_question_ids was empty, and a questionId read returned nothing.
    await writeResearch({
      assertions: [
        { id: "a_009", extracted_for_question_ids: ["q_001"] },
        { id: "a_012", extracted_for_question_ids: ["q_001", "q_002"] },
        { id: "a_020", extracted_for_question_ids: ["q_002"] },
        { id: "a_030" },
      ],
      conflicts: [
        { id: "c_001", competing_assertion_ids: ["a_009", "a_030"], blocks_question_ids: [], status: "resolved" },
        { id: "c_002", competing_assertion_ids: ["a_020", "a_030"], blocks_question_ids: [], status: "unresolved" },
        { id: "c_003", competing_assertion_ids: ["a_030"], blocks_question_ids: ["q_001"], status: "unresolved" },
      ],
    });
    const q1 = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_001" });
    expect(q1.ok).toBe(true);
    if (!q1.ok) return;
    expect(q1.items.map((i) => i.id)).toEqual(["c_001", "c_003"]);
    const q2 = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_002" });
    expect(q2.ok && q2.items.map((i) => i.id)).toEqual(["c_002"]);
    const q3 = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_003" });
    expect(q3.ok && q3.count).toBe(0);
    const resolvedOnly = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_001", status: "resolved" });
    expect(resolvedOnly.ok && resolvedOnly.items.map((i) => i.id)).toEqual(["c_001"]);
  });

  it("conflicts × questionId errors (not count:0) when assertions is missing — a corrupt document", async () => {
    await writeResearch({ conflicts: [{ id: "c_001", competing_assertion_ids: ["a_001"], status: "resolved" }] });
    const r = await researchQuery({ projectPath: dir, section: "conflicts", questionId: "q_001" });
    expect(r.ok).toBe(false);
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
    expect(flat(result)).toHaveLength(50);
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

  it("names the singular parameter when the caller sends plural `sections`", async () => {
    await writeResearch({});
    const result = await researchQuery({ projectPath: dir, sections: '["log"]' } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = result.errors.join(" ");
    expect(msg).toMatch(/not one of/);
    // The near-miss key is called out so the model can learn `section` is singular.
    expect(msg).toMatch(/'section' \(singular\)/);
    expect(msg).toMatch(/you sent 'sections'/);
  });

  it("points `plan_items` at the `plans` section", async () => {
    await writeResearch({});
    const result = await researchQuery({ projectPath: dir, section: "plan_items" } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = result.errors.join(" ");
    expect(msg).toMatch(/not one of/);
    expect(msg).toMatch(/Plan items live under section 'plans'/);
  });

  it("reports a JSON-encoded string value rather than undefined", async () => {
    await writeResearch({});
    const result = await researchQuery({ projectPath: dir, section: '"log"' } as any);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = result.errors.join(" ");
    expect(msg).toMatch(/not one of/);
    // The received value is rendered so the quotes are visible — not swallowed
    // into a bare `undefined`.
    expect(msg).toContain('"\\"log\\""');
    expect(msg).not.toMatch(/section undefined/);
  });

  it("rejects when the section is missing or not an array", async () => {
    await writeResearch({ assertions: "not-an-array" });
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/missing or not an array/);
  });

  it("fails with the project refusal when the folder is not a project", async () => {
    // `dir` is a bare temp directory — neither project file. That is not a read
    // failure, it is a user who is not in a research project (issue #1695), and
    // research_query is one of the two READS the issue calls out. The loud
    // half-a-project case (a tree present, research.json gone) is pinned in
    // tests/tools/no-project.test.ts.
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result as any).reason).toBeUndefined();
    expect(result.errors.join(" ")).toContain("No project:");
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
    expect(flat(result)).toHaveLength(7); // items 51..57
    expect(flat(result).map((i) => i.id)).toEqual([
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
    expect(flat(result)).toHaveLength(50); // items 51..100
    expect(result.truncated).toBe(true); // 101..120 still remain
  });

  it("truncated is false when the page ends exactly at count (offset + 50 == count)", async () => {
    // The > vs >= boundary: 100 total, offset 50 returns 51..100 and nothing is left.
    const assertions = Array.from({ length: 100 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const result = await researchQuery({ projectPath: dir, section: "assertions", offset: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(flat(result)).toHaveLength(50);
    expect(result.truncated).toBe(false);
  });

  it("offset: 0 is identical to omitting offset (backward compatible)", async () => {
    const assertions = Array.from({ length: 60 }, (_, i) => ({ id: `a_${i}`, record_id: "REC1" }));
    await writeResearch({ assertions });
    const withZero = await researchQuery({ projectPath: dir, section: "assertions", offset: 0 });
    const without = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(withZero).toEqual(without);
    if (!withZero.ok) return;
    expect(flat(withZero)).toHaveLength(50);
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
    expect(flat(result)).toEqual([]);
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
    expect(flat(result).map((i) => i.id)).toEqual(["a_50", "a_51", "a_52", "a_53", "a_54"]);
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

  // The error names what was actually sent. JSON.stringify renders NaN and
  // Infinity as `null`, which would report a value no caller ever sent — the
  // dev script's `Number(value)` coercion makes `offset=abc` land here as NaN.
  it("names NaN and Infinity in the rejection instead of reporting 'null'", async () => {
    await writeResearch({ assertions: [{ id: "a_0" }] });
    for (const [bad, shown] of [
      [NaN, "NaN"],
      [Infinity, "Infinity"],
    ] as const) {
      const result = await researchQuery({ projectPath: dir, section: "assertions", offset: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.join(" ")).toContain(`(got ${shown})`);
      expect(result.errors.join(" ")).not.toContain("got null");
    }
  });

  it("still quotes a string offset so the type mismatch is visible", async () => {
    await writeResearch({ assertions: [{ id: "a_0" }] });
    const result = await researchQuery({
      projectPath: dir,
      section: "assertions",
      offset: "50" as any,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain('(got "50")');
  });
});

// --- conflicts: unregistered disagreements (ut_research_h22) -------------

describe("research_query — conflicts reports unregistered disagreements", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-disagree-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // I2's birthplace: England on one census, Alabama on another, for q_001.
  // I3's birthplace disagrees too, but only on q_002's assertions.
  const research = (conflicts: any[] = []) => ({
    assertions: [
      { id: "a_1", fact_type: "birth", place: "England", extracted_for_question_ids: ["q_001"] },
      { id: "a_2", fact_type: "birth", place: "Alabama, United States", extracted_for_question_ids: ["q_001"] },
      { id: "a_3", fact_type: "birth", place: "Alabama", extracted_for_question_ids: ["q_002"] },
      { id: "a_4", fact_type: "birth", place: "Mississippi", extracted_for_question_ids: ["q_002"] },
    ],
    person_evidence: [
      { id: "pe_1", person_id: "I2", assertion_id: "a_1" },
      { id: "pe_2", person_id: "I2", assertion_id: "a_2" },
      { id: "pe_3", person_id: "I3", assertion_id: "a_3" },
      { id: "pe_4", person_id: "I3", assertion_id: "a_4" },
    ],
    conflicts,
  });

  async function query(extra: Record<string, unknown>, conflicts: any[] = []) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research(conflicts)), "utf-8");
    const result = await researchQuery({ projectPath: dir, section: "conflicts", ...extra } as any);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return result;
  }

  it("reports a disagreement nobody registered while count stays 0", async () => {
    const result = await query({});
    expect(result.count).toBe(0);
    expect(result.unregisteredDisagreements).toEqual([
      { personId: "I2", fact: "birth place", assertionIds: ["a_1", "a_2"] },
      { personId: "I3", fact: "birth place", assertionIds: ["a_3", "a_4"] },
    ]);
  });

  it("scopes to the conflict's own competing assertions under conflictId", async () => {
    // c_9 registers I2's pair; I3's pair is unregistered and has nothing to do with c_9.
    const c9 = [{ id: "c_9", conflict_type: "fact", status: "unresolved", competing_assertion_ids: ["a_1", "a_2"] }];
    expect((await query({}, c9)).unregisteredDisagreements).toEqual([
      { personId: "I3", fact: "birth place", assertionIds: ["a_3", "a_4"] },
    ]);
    expect((await query({ conflictId: "c_9" }, c9)).unregisteredDisagreements).toEqual([]);
    expect((await query({ conflictId: "c_404" }, c9)).unregisteredDisagreements).toEqual([]);
  });

  it("scopes to the question's own assertions under questionId", async () => {
    const result = await query({ questionId: "q_001" });
    expect(result.unregisteredDisagreements).toEqual([
      { personId: "I2", fact: "birth place", assertionIds: ["a_1", "a_2"] },
    ]);
  });

  it("drops a pair a conflicts entry already names", async () => {
    const conflict = { id: "c_001", status: "unresolved", competing_assertion_ids: ["a_1", "a_2"] };
    const result = await query({}, [conflict]);
    expect(result.count).toBe(1);
    expect(result.unregisteredDisagreements?.map((d) => d.personId)).toEqual(["I3"]);
  });

  it("narrows to disagreements naming assertionId", async () => {
    const result = await query({ assertionId: "a_4" });
    expect(result.unregisteredDisagreements?.map((d) => d.personId)).toEqual(["I3"]);
  });

  it("reports them under status 'unresolved' and omits them under any other status", async () => {
    expect((await query({ status: "unresolved" })).unregisteredDisagreements).toHaveLength(2);
    expect((await query({ status: "resolved" })).unregisteredDisagreements).toBeUndefined();
  });

  it("adds nothing to another section's read", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify(research()), "utf-8");
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok && "unregisteredDisagreements" in result).toBe(false);
  });
});

// --- #2936: localities, and the completeness guard -----------------------

describe("research_query — localities (#2936)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-loc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = (research: any) =>
    writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");

  it("returns locality entries when the section is present", async () => {
    await write({
      localities: [
        { place: "Zulia, Venezuela", guide_markdown: "# Zulia\nCivil registration from 1873." },
        { place: "Ontario County, New York", guide_markdown: "# Ontario\nDeath index 1880-1956." },
      ],
    });
    const r: any = await researchQuery({ projectPath: dir, section: "localities" });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.items[0].place).toBe("Zulia, Venezuela");
    expect(r.truncated).toBe(false);
  });

  it("returns count 0 when the key is absent, rather than erroring", async () => {
    // The issue #2864 case. `localities` is not in the schema's `required`
    // list, so it is legitimately missing on every project older than the
    // field — 90 of the 102 committed fixtures.
    await write({ questions: [{ id: "q_001" }] });
    const r: any = await researchQuery({ projectPath: dir, section: "localities" });
    expect(r).toEqual({ ok: true, section: "localities", count: 0, items: [], truncated: false });
  });

  it("returns count 0 on a document that is empty but still a document", async () => {
    // `{}` is the shape the suite's own idiom writes, and it IS a document —
    // an object that parses with no sections yet. Distinct from the non-object
    // cases below, which must still throw. Nothing pinned this before: the
    // three existing `writeResearch({})` cases all query an invalid section
    // and never reach the read site.
    await write({});
    const r: any = await researchQuery({ projectPath: dir, section: "localities" });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });

  it.each([
    ["bare null", null],
    ["a bare array", []],
    ["a bare string", "x"],
    ["a bare number", 42],
  ])("still errors for localities when research.json is %s", async (_label, doc) => {
    // `research?.[section]` is `undefined` for every one of these, exactly as
    // it is for a missing key. Keying the empty result on `undefined` alone
    // would answer a confident "no localities" on a file that is not a
    // research document — the issue #2864 failure inverted.
    await write(doc);
    const r: any = await researchQuery({ projectPath: dir, section: "localities" });
    expect(r.ok).toBe(false);
    expect(String(r.errors)).toMatch(/missing or not an array/);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an object", { a: 1 }],
  ])("still errors when localities is present but is %s", async (_label, value) => {
    await write({ localities: value });
    const r: any = await researchQuery({ projectPath: dir, section: "localities" });
    expect(r.ok).toBe(false);
    expect(String(r.errors)).toMatch(/missing or not an array/);
  });

  it("rejects a filter on localities", async () => {
    await write({ localities: [{ place: "Zulia, Venezuela" }] });
    const r: any = await researchQuery({
      projectPath: dir,
      section: "localities",
      questionId: "q_001",
    } as any);
    expect(r.ok).toBe(false);
    expect(String(r.errors)).toMatch(/takes no filters/);
  });

  it("a REQUIRED section that is missing still errors", async () => {
    // The optional rule is narrow: it must not widen to sections the schema
    // says are always present.
    await write({ localities: [] });
    const r: any = await researchQuery({ projectPath: dir, section: "questions" });
    expect(r.ok).toBe(false);
    expect(String(r.errors)).toMatch(/missing or not an array/);
  });
});

describe("research_query — every array section is queryable or deliberately excluded (#2936)", () => {
  // Derived from the schema at runtime, never a hardcoded copy: a copy cannot
  // fail when someone adds a section, which is exactly how `localities` stayed
  // unreadable long enough to reach a user (issue #2864).
  const schemaPath = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "docs",
    "specs",
    "schemas",
    "research.schema.json",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  /** Resolve `$ref` against `$defs` until a concrete subschema falls out.
   *
   *  `project` and `researcher_profile` are written as bare `{"$ref": …}` with
   *  NO `type` key, so a plain `type === "array"` scan skips them silently —
   *  and would skip any future section written in that style, which is the one
   *  thing this test exists to prevent. Resolving a single level would fix
   *  today and re-arm the same trap for the next shape, so this loops, and
   *  `classify` below throws rather than returning "not an array" when it
   *  cannot tell. An unclassifiable shape reds this test instead of vanishing
   *  from it.
   */
  function resolve(node: any, depth = 0): any {
    if (depth > 10) throw new Error("$ref chain too deep or cyclic");
    if (node && typeof node.$ref === "string") {
      const name = node.$ref.replace("#/$defs/", "");
      const target = schema.$defs?.[name];
      if (!target) throw new Error(`unresolvable $ref: ${node.$ref}`);
      return resolve(target, depth + 1);
    }
    return node;
  }

  function classify(name: string, node: any): string {
    const resolved = resolve(node);
    if (typeof resolved?.type !== "string") {
      throw new Error(
        `top-level property '${name}' has no resolvable string 'type' — this test ` +
          `cannot tell whether it is an array section, so it would silently skip it. ` +
          `Teach 'resolve'/'classify' the new shape rather than letting it disappear.`,
      );
    }
    return resolved.type;
  }

  const props: Record<string, any> = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const arraySections = Object.keys(props).filter((k) => classify(k, props[k]) === "array");

  it("every top-level array section is queryable or listed as excluded", () => {
    const queryable = new Set<string>(RESEARCH_QUERY_SECTIONS);
    const unreachable = arraySections.filter(
      (s) => !queryable.has(s) && !(s in RESEARCH_QUERY_EXCLUDED),
    );
    expect(unreachable, `add these to RESEARCH_QUERY_SECTIONS or RESEARCH_QUERY_EXCLUDED`).toEqual(
      [],
    );
  });

  it("the optional set is exactly the queryable array sections the schema does not require", () => {
    // NOT simply "array sections not required" — that set also holds
    // `warning_justifications`, which is excluded and so has no absence
    // behaviour at all.
    const expected = arraySections
      .filter((s) => !required.has(s) && !(s in RESEARCH_QUERY_EXCLUDED))
      .sort();
    expect([...RESEARCH_QUERY_OPTIONAL_SECTIONS].sort()).toEqual(expected);
  });

  it("every excluded section is still a top-level array section of the schema", () => {
    // Deleting a section from the schema reds this until its
    // RESEARCH_QUERY_EXCLUDED entry goes with it — so the exclusion map cannot
    // rot into a list of sections that no longer exist (it fired for #2069).
    const stale = Object.keys(RESEARCH_QUERY_EXCLUDED).filter((s) => !arraySections.includes(s));
    expect(stale, `RESEARCH_QUERY_EXCLUDED names section(s) the schema no longer has`).toEqual([]);
  });

});

// --- log × questionId: one call replacing the per-plan-item walk (T2.1) ---
describe("research_query — log × questionId", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-plan-question-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeResearch(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  }

  const plansFixture = {
    plans: [
      { id: "pl_001", question_id: "q_001", status: "active",
        items: [{ id: "pli_001" }, { id: "pli_002" }] },
      { id: "pl_002", question_id: "q_001", status: "superseded",
        items: [{ id: "pli_003" }] },
      { id: "pl_003", question_id: "q_002", status: "active",
        items: [{ id: "pli_004" }] },
    ],
    log: [
      { id: "log_001", plan_item_id: "pli_001" },
      { id: "log_002", plan_item_id: "pli_002" },
      { id: "log_003", plan_item_id: "pli_003" },
      { id: "log_004", plan_item_id: "pli_004" },
      { id: "log_005", plan_item_id: null },
      { id: "log_006", plan_item_id: "pli_001" },
    ],
  };

  it("log × questionId returns every entry for any plan item of the question's plans", async () => {
    await writeResearch(plansFixture);
    const result = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Includes the superseded plan's item (audit trail); excludes q_002's and the unplanned entry.
    expect(result.items.map((i) => i.id)).toEqual(["log_001", "log_002", "log_003", "log_006"]);
    expect(result.count).toBe(4);
  });

  it("log × questionId equals the union of the per-item planItemId walk", async () => {
    await writeResearch(plansFixture);
    const joined = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001" });
    const walked: string[] = [];
    for (const planItemId of ["pli_001", "pli_002", "pli_003"]) {
      const r = await researchQuery({ projectPath: dir, section: "log", planItemId });
      if (r.ok) walked.push(...r.items.map((i) => i.id));
    }
    if (!joined.ok) throw new Error("joined call failed");
    expect(joined.items.map((i) => i.id).sort()).toEqual(walked.sort());
  });

  it("log × questionId ANDs with planItemId like every other filter", async () => {
    await writeResearch(plansFixture);
    const r = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001", planItemId: "pli_002" });
    if (!r.ok) throw new Error("failed");
    expect(r.items.map((i) => i.id)).toEqual(["log_002"]);
    const none = await researchQuery({ projectPath: dir, section: "log", questionId: "q_002", planItemId: "pli_002" });
    if (!none.ok) throw new Error("failed");
    expect(none.count).toBe(0);
  });

  it("log × questionId for a question with no plans is an empty result, not an error", async () => {
    await writeResearch(plansFixture);
    const r = await researchQuery({ projectPath: dir, section: "log", questionId: "q_009" });
    expect(r).toMatchObject({ ok: true, count: 0, items: [] });
  });

  it("log × questionId errors (not count:0) when plans is missing — a corrupt document", async () => {
    await writeResearch({ log: plansFixture.log });
    const r = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(JSON.stringify(r)).toContain("'plans' is missing or not an array");
  });

  it("log × questionId pages a >50-entry result with offset", async () => {
    const log = Array.from({ length: 60 }, (_, k) => ({ id: `log_${k}`, plan_item_id: "pli_001" }));
    await writeResearch({ plans: plansFixture.plans, log });
    const first = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001" });
    const second = await researchQuery({ projectPath: dir, section: "log", questionId: "q_001", offset: 50 });
    if (!first.ok || !second.ok) throw new Error("failed");
    expect(first).toMatchObject({ count: 60, truncated: true });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(10);
    expect(second.truncated).toBe(false);
  });

  it("the unsupported-filter error for log now names questionId", async () => {
    await writeResearch(plansFixture);
    const r = await researchQuery({ projectPath: dir, section: "log", personId: "P1" } as never);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("supported: planItemId, questionId");
  });
});

// --- T2.3: the four id keys take a list ------------------------------------

describe("research_query — plural ids", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-plural-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const fixture = {
    plans: [],
    log: [
      { id: "log_001", plan_item_id: "pli_001" },
      { id: "log_002", plan_item_id: null },
    ],
    sources: [{ id: "src_001" }, { id: "src_002" }, { id: "src_003" }],
    assertions: [
      { id: "a_1", record_id: "R1", record_role: "principal", source_id: "src_001", fact_type: "birth", place: "England" },
      { id: "a_2", record_id: "R2", record_role: "principal", source_id: "src_002", fact_type: "birth", place: "Alabama, United States" },
      { id: "a_3", record_id: "R1", record_role: "child", source_id: "src_001", fact_type: "birth" },
      { id: "a_4", record_id: "R3", record_role: "principal", source_id: "src_003", fact_type: "death" },
    ],
    // Interleaved, so document order is not "all of I1, then all of I2".
    person_evidence: [
      { id: "pe_1", person_id: "I1", assertion_id: "a_1" },
      { id: "pe_2", person_id: "I2", assertion_id: "a_2" },
      { id: "pe_3", person_id: "I1", assertion_id: "a_3" },
      { id: "pe_4", person_id: "I3", assertion_id: "a_4" },
      { id: "pe_5", person_id: "I2", assertion_id: "a_1" },
    ],
    conflicts: [
      { id: "c_1", status: "unresolved", competing_assertion_ids: ["a_1", "a_2"] },
      { id: "c_2", status: "unresolved", competing_assertion_ids: ["a_2", "a_4"] },
      { id: "c_3", status: "resolved", competing_assertion_ids: ["a_3", "a_4"] },
    ],
    hypotheses: [{ id: "h_1", supporting_assertion_ids: ["a_1"], contradicting_assertion_ids: ["a_2"] }],
    timelines: [{ id: "t_1", person_ids: ["I1", "I2"] }],
    proof_summaries: [],
  };

  async function query(args: Record<string, unknown>, research: any = fixture) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
    return researchQuery({ projectPath: dir, ...args } as never);
  }

  async function ok(args: Record<string, unknown>, research: any = fixture) {
    const r = await query(args, research);
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r;
  }

  async function rejected(args: Record<string, unknown>, research: any = fixture) {
    const r = await query(args, research);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    return r.errors.join(" ");
  }

  it("a list answers the union of the singular answers, in document order, with countById", async () => {
    const plural = await ok({ section: "person_evidence", personId: ["I2", "I1"] });
    const singles = [
      await ok({ section: "person_evidence", personId: "I2" }),
      await ok({ section: "person_evidence", personId: "I1" }),
    ];
    const union = new Set(singles.flatMap((s) => s.items.map((i) => i.id)));
    expect(plural.items.map((i) => i.id)).toEqual(
      fixture.person_evidence.filter((p) => union.has(p.id)).map((p) => p.id),
    );
    expect(plural.items.map((i) => i.id)).toEqual(["pe_1", "pe_2", "pe_3", "pe_5"]);
    expect(plural.count).toBe(4);
    expect(plural.countById).toEqual({ I2: singles[0].count, I1: singles[1].count });
    expect(plural.truncated).toBe(false);
  });

  it("a list ANDs with a fixed filter, and countById counts under it", async () => {
    const plural = await ok({ section: "assertions", recordId: ["R1", "R2"], recordRole: "principal" });
    expect(flat(plural).map((i) => i.id)).toEqual(["a_1", "a_2"]);
    expect(plural.countById).toEqual({ R1: 1, R2: 1 });
  });

  it("a singular answer keeps exactly today's keys, with no countById", async () => {
    const single = await ok({ section: "person_evidence", personId: "I1" });
    expect(Object.keys(single).sort()).toEqual(["count", "items", "ok", "section", "truncated"]);
  });

  it("an item naming two listed ids appears once and counts under both", async () => {
    const r = await ok({ section: "conflicts", assertionId: ["a_1", "a_2"], status: "unresolved" });
    expect(r.items.map((i) => i.id)).toEqual(["c_1", "c_2"]);
    expect(r.count).toBe(2);
    expect(r.countById).toEqual({ a_1: 1, a_2: 2 });
    const sum = Object.values(r.countById ?? {}).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(r.count);
  });

  it("contains-any (hypotheses) and contains (timelines) take a list too", async () => {
    const h = await ok({ section: "hypotheses", assertionId: ["a_2", "a_9"] });
    expect(h.items.map((i) => i.id)).toEqual(["h_1"]);
    expect(h.countById).toEqual({ a_2: 1, a_9: 0 });
    const t = await ok({ section: "timelines", personId: ["I2", "I3"] });
    expect(t.items.map((i) => i.id)).toEqual(["t_1"]);
    expect(t.countById).toEqual({ I2: 1, I3: 0 });
  });

  it("pages a 60-match list exactly as a singular answer pages, countById identical on every page", async () => {
    const person_evidence = Array.from({ length: 60 }, (_, k) => ({
      id: `pe_${k}`,
      person_id: `I${k % 3}`,
      assertion_id: "a_1",
    }));
    const research = { ...fixture, person_evidence };
    const first = await ok({ section: "person_evidence", personId: ["I0", "I1", "I2"] }, research);
    const second = await ok({ section: "person_evidence", personId: ["I0", "I1", "I2"], offset: 50 }, research);
    expect(first).toMatchObject({ count: 60, truncated: true });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(10);
    expect(second.truncated).toBe(false);
    expect(first.countById).toEqual({ I0: 20, I1: 20, I2: 20 });
    expect(second.countById).toEqual(first.countById);
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(60);
  });

  it("an unmatched id is present in countById as 0, not omitted", async () => {
    const r = await ok({ section: "person_evidence", personId: ["I1", "NOPE"] });
    expect(r.countById).toEqual({ I1: 2, NOPE: 0 });
    const empty = await ok({ section: "sources", sourceId: ["src_9", "src_8"] });
    expect(empty).toMatchObject({ count: 0, items: [], countById: { src_9: 0, src_8: 0 } });
  });

  it("narrows unregisteredDisagreements to those naming any listed assertionId", async () => {
    // a_1 and a_2 are both I2's birth, and their places disagree; nobody registered it.
    const disagree = {
      ...fixture,
      conflicts: [],
      person_evidence: [
        { id: "pe_1", person_id: "I2", assertion_id: "a_1" },
        { id: "pe_2", person_id: "I2", assertion_id: "a_2" },
      ],
    };
    const naming = await ok({ section: "conflicts", assertionId: ["a_4", "a_2"] }, disagree);
    expect(naming.unregisteredDisagreements?.map((d) => d.assertionIds)).toEqual([["a_1", "a_2"]]);
    const other = await ok({ section: "conflicts", assertionId: ["a_3", "a_4"] }, disagree);
    expect(other.unregisteredDisagreements).toEqual([]);
  });

  it("a JSON-array string is the same answer as the list", async () => {
    const list = await ok({ section: "person_evidence", personId: ["I1", "I2"] });
    // Pinned, so "both forms answer count 0" (the pre-T2.3 build) cannot pass.
    expect(list).toMatchObject({ count: 4, countById: { I1: 2, I2: 2 } });
    expect(await ok({ section: "person_evidence", personId: '["I1","I2"]' })).toEqual(list);
    expect(await ok({ section: "person_evidence", personId: ' [ "I1" , "I2" ] ' })).toEqual(list);
  });

  it("duplicate ids collapse to one countById key", async () => {
    const r = await ok({ section: "person_evidence", personId: ["I1", "I1"] });
    expect(r.countById).toEqual({ I1: 2 });
    expect(r.count).toBe(2);
  });

  it("rejects a string that starts with '[' but is not JSON", async () => {
    expect(await rejected({ section: "person_evidence", personId: "[not json" })).toMatch(
      /'personId' starts with '\[' but is not a JSON array/,
    );
  });

  it("rejects a JSON-array string of non-strings", async () => {
    expect(await rejected({ section: "person_evidence", personId: "[1,2]" })).toMatch(
      /'personId' must list non-empty id strings/,
    );
  });

  it("rejects an empty list, as a list and as a string", async () => {
    expect(await rejected({ section: "person_evidence", personId: [] })).toMatch(/'personId' is an empty list/);
    expect(await rejected({ section: "person_evidence", personId: "[]" })).toMatch(/'personId' is an empty list/);
  });

  it("rejects a mixed list", async () => {
    expect(await rejected({ section: "person_evidence", personId: ["I1", 3] })).toMatch(
      /must list non-empty id strings/,
    );
  });

  it("rejects an empty-string id in a list", async () => {
    expect(await rejected({ section: "person_evidence", personId: [""] })).toMatch(/must list non-empty id strings/);
  });

  it("rejects more than 50 distinct ids", async () => {
    const ids = Array.from({ length: 51 }, (_, k) => `I${k}`);
    expect(await rejected({ section: "person_evidence", personId: ids })).toMatch(/lists 51 ids; the limit is 50/);
    // 51 entries that dedupe to 50 are within the limit.
    await ok({ section: "person_evidence", personId: [...ids.slice(0, 50), "I0"] });
  });

  it("rejects two list-valued filters in one call", async () => {
    expect(await rejected({ section: "person_evidence", personId: ["I1"], assertionId: ["a_1"] })).toMatch(
      /only one filter may be a list per call \(got lists on 'personId' and 'assertionId'\)/,
    );
    // One list plus a singular id key is fine.
    const r = await ok({ section: "person_evidence", personId: ["I1", "I2"], assertionId: "a_1" });
    expect(r.items.map((i) => i.id)).toEqual(["pe_1", "pe_5"]);
  });

  it.each([
    ["questions", "questionId"],
    ["log", "planItemId"],
    ["external_collections", "place"],
  ])("rejects a list on %s × %s, a key that takes one value", async (section, key) => {
    expect(await rejected({ section, [key]: ["x", "y"] })).toMatch(
      new RegExp(`'${key}' must be a string; only personId, assertionId, sourceId, recordId, conflictId take a list`),
    );
  });

  it.each([5, null, {}, true])("rejects personId: %j instead of answering count 0", async (value) => {
    expect(await rejected({ section: "person_evidence", personId: value })).toMatch(
      /'personId' must be a string or a list of strings/,
    );
  });

  it("rejects planItemId: null, which used to match the null-plan-item log entries", async () => {
    expect(await rejected({ section: "log", planItemId: null })).toMatch(/'planItemId' must be a string \(got null\)/);
  });

  it("a non-plural key's string that starts with '[' stays one value", async () => {
    const r = await ok({ section: "log", planItemId: "[pli_001]" });
    expect(r.count).toBe(0);
  });

  it("rejects a JSON-array string on a key that takes one value", async () => {
    expect(await rejected({ section: "conflicts", questionId: '["q_1","q_2"]' })).toMatch(
      /'questionId' must be a string; only personId, assertionId, sourceId, recordId, conflictId take a list/,
    );
  });

  it("conflicts × questionId ANDs with an assertionId list", async () => {
    const research = {
      ...fixture,
      assertions: [
        { id: "a_1", extracted_for_question_ids: ["q_1"] },
        { id: "a_2", extracted_for_question_ids: ["q_2"] },
        { id: "a_4", extracted_for_question_ids: ["q_2"] },
      ],
      person_evidence: [],
      conflicts: [
        { id: "c_1", status: "unresolved", blocks_question_ids: [], competing_assertion_ids: ["a_1", "a_2"] },
        { id: "c_2", status: "unresolved", blocks_question_ids: ["q_1"], competing_assertion_ids: ["a_2", "a_4"] },
        { id: "c_3", status: "resolved", blocks_question_ids: [], competing_assertion_ids: ["a_2", "a_4"] },
      ],
    };
    const r = await ok({ section: "conflicts", questionId: "q_1", assertionId: ["a_1", "a_4", "a_9"] }, research);
    expect(r.items.map((i: any) => i.id)).toEqual(["c_1", "c_2"]);
    expect(r.countById).toEqual({ a_1: 1, a_4: 1, a_9: 0 });
    const single = await ok({ section: "conflicts", questionId: "q_1", assertionId: "a_4" }, research);
    expect(single.count).toBe(r.countById?.a_4);
  });
});

// --- conflicts: a conflict's own id ---------------------------------------

describe("research_query — conflicts by their own id", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-conflict-id-"));
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        assertions: [],
        sources: [],
        conflicts: [
          { id: "c_001", conflict_type: "fact", status: "unresolved", competing_assertion_ids: ["a_002", "a_009"] },
          { id: "c_002", conflict_type: "identity", status: "resolved", competing_assertion_ids: ["a_001"] },
        ],
      }),
      "utf-8",
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the one conflict conflictId names", async () => {
    const r = await researchQuery({ projectPath: dir, section: "conflicts", conflictId: "c_002" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((c: any) => c.id)).toEqual(["c_002"]);
  });

  // ut_conflict_resolution_008 (v4, run 2) read c_001 this way, got 0, and
  // appended a duplicate of it.
  it.each([["c_001"], [["a_002", "c_001"]]])("refuses a conflict id passed as assertionId (%j)", async (assertionId) => {
    const r = await researchQuery({ projectPath: dir, section: "conflicts", assertionId } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/'c_001' is a conflict id.*conflictId 'c_001'/);
  });

  it("still matches competing assertions by assertionId", async () => {
    const r = await researchQuery({ projectPath: dir, section: "conflicts", assertionId: "a_009" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((c: any) => c.id)).toEqual(["c_001"]);
  });

  it("is not a filter on other sections", async () => {
    const r = await researchQuery({ projectPath: dir, section: "hypotheses", conflictId: "c_001" } as any);
    expect(r.ok).toBe(false);
  });

  it("takes a list, with a count per id", async () => {
    const r = await researchQuery({ projectPath: dir, section: "conflicts", conflictId: ["c_001", "c_002", "c_404"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((c: any) => c.id)).toEqual(["c_001", "c_002"]);
    expect(r.countById).toEqual({ c_001: 1, c_002: 1, c_404: 0 });
  });

  // The same silent 0 on any id filter sent a known id of another kind.
  it.each([
    [{ section: "hypotheses", assertionId: "c_001" }, /'c_001' is a conflict id, but assertionId takes a_ ids\.$/],
    [{ section: "proof_summaries", assertionId: "q_001" }, /'q_001' is a question id.*pass questionId 'q_001'/],
    [{ section: "conflicts", conflictId: "a_002" }, /'a_002' is an assertion id.*pass assertionId 'a_002'/],
    [{ section: "assertions", sourceId: "a_002" }, /'a_002' is an assertion id.*pass assertionId 'a_002'/],
  ])("refuses %j", async (args, message) => {
    const r = await researchQuery({ projectPath: dir, ...args } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(message);
  });

  it.each([
    [{ section: "conflicts", assertionId: "a_002" }],
    [{ section: "conflicts", questionId: "q_001" }],
    [{ section: "sources", sourceId: "src_001" }],
    [{ section: "assertions", recordId: "c_001" }],
    [{ section: "assertions", assertionId: "a_002b" }],
  ])("accepts %j", async (args) => {
    const r = await researchQuery({ projectPath: dir, ...args } as any);
    expect(r.ok, JSON.stringify((r as any).errors)).toBe(true);
  });
});

// --- Fields no caller reads -------------------------------------------------

describe("research_query — fields no caller reads are left out", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-omit-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeResearch(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  }

  const PLANS = [
    { id: "pl_001", question_id: "q_001", status: "superseded", items: [
      { id: "pli_001", sequence: 1, record_type: "census", status: "planned", rationale: "R1" },
      { id: "pli_002", sequence: 2, record_type: "vital_record", jurisdiction: "J", status: "completed", rationale: "R2" },
      { id: "pli_008", sequence: 3, record_type: "tax", status: "skipped", rationale: "R8" },
      { id: "pli_009", sequence: 4, record_type: "court", status: "skipped", rationale: "R9",
        skip_category: "out_of_scope", skip_reason: "S9" },
    ] },
    { id: "pl_002", question_id: "q_001", status: "active", items: [
      { id: "pli_003", sequence: 1, record_type: "census", jurisdiction: "J", status: "completed", rationale: "R3" },
      { id: "pli_004", sequence: 2, record_type: "church", status: "skipped", rationale: "R4",
        skip_category: "no_coverage", skip_reason: "S4" },
      { id: "pli_005", sequence: 3, record_type: "probate", status: "in_progress", rationale: "R5" },
      { id: "pli_006", sequence: 4, record_type: "land", status: "planned", rationale: "R6", fallback_for: "pli_005" },
    ] },
    { id: "pl_003", question_id: "q_002", status: "completed", items: [
      { id: "pli_007", sequence: 1, record_type: "census", status: "completed", rationale: "R7" },
      { id: "pli_010", sequence: 2, record_type: "military", status: "skipped", rationale: "R10" },
    ] },
  ];

  function rationaleById(items: any[]): Record<string, unknown> {
    return Object.fromEntries(items.flatMap((p: any) => p.items.map((i: any) => [i.id, i.rationale])));
  }

  it("plans: every item of the active plan keeps its rationale, completed and skipped included", async () => {
    await writeResearch({ plans: PLANS });
    const r = await researchQuery({ projectPath: dir, section: "plans" });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.items.find((p: any) => p.id === "pl_002")).toEqual(PLANS[1]);
  });

  it("plans: an item of a plan that is not active carries no rationale, and every other field as stored", async () => {
    await writeResearch({ plans: PLANS });
    const r = await researchQuery({ projectPath: dir, section: "plans" });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(rationaleById(r.items)).toEqual({
      pli_001: undefined, // planned, on a superseded plan
      pli_002: undefined, // completed, on a superseded plan
      pli_008: "R8", // skipped with no skip_category
      pli_009: undefined, // skipped with a skip_category, on a superseded plan
      pli_003: "R3",
      pli_004: "R4",
      pli_005: "R5",
      pli_006: "R6",
      pli_007: undefined, // on a completed plan
      pli_010: "R10", // skipped with no skip_category
    });
    const superseded = r.items.find((p: any) => p.id === "pl_001");
    expect(superseded.items[1]).toEqual({ id: "pli_002", sequence: 2, record_type: "vital_record", jurisdiction: "J", status: "completed" });
    expect(superseded.items[3]).toEqual({ id: "pli_009", sequence: 4, record_type: "court", status: "skipped",
      skip_category: "out_of_scope", skip_reason: "S9" });
    expect(r.items.map((p: any) => [p.id, p.question_id, p.status])).toEqual(
      PLANS.map((p) => [p.id, p.question_id, p.status]),
    );
  });

  it("plans: a skipped item with no skip_category keeps its rationale on a superseded or completed plan", async () => {
    await writeResearch({ plans: PLANS });
    const r = await researchQuery({ projectPath: dir, section: "plans" });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(r.items.find((p: any) => p.id === "pl_001").items[2]).toEqual(PLANS[0].items[2]);
    expect(r.items.find((p: any) => p.id === "pl_003").items[1]).toEqual(PLANS[2].items[1]);
  });

  it("plans: a plan with no status counts as active", async () => {
    await writeResearch({ plans: [{ id: "pl_001", question_id: "q_001", items: [
      { id: "pli_001", status: "completed", rationale: "R1" },
      { id: "pli_002", status: "skipped", rationale: "R2", skip_category: "answered", skip_reason: "S2" },
      { id: "pli_003", status: "planned", rationale: "R3" },
    ] }] });
    const r = await researchQuery({ projectPath: dir, section: "plans" });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(rationaleById(r.items)).toEqual({ pli_001: "R1", pli_002: "R2", pli_003: "R3" });
  });

  it("plans: a filtered read leaves the same rationale out", async () => {
    await writeResearch({ plans: PLANS });
    const r = await researchQuery({ projectPath: dir, section: "plans", questionId: "q_001" });
    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(rationaleById(r.items)).toEqual({
      pli_001: undefined, pli_002: undefined, pli_008: "R8", pli_009: undefined,
      pli_003: "R3", pli_004: "R4", pli_005: "R5", pli_006: "R6",
    });
  });

  it("plans: the omission is in the answer only, never in research.json", async () => {
    await writeResearch({ plans: PLANS });
    await researchQuery({ projectPath: dir, section: "plans" });
    const stored = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    expect(stored.plans).toEqual(PLANS);
  });

  it("log: an entry carries no staged_ref, and every other field as stored", async () => {
    const unstaged = {
      id: "log_001", tool: "record_search", query: { surname: "X" }, outcome: "positive",
      plan_item_id: "pli_005", results_ref: "results/log_001.json", notes: "N",
    };
    const entry = { ...unstaged, staged_ref: "results/.staging/record_search-1.json" };
    const bare = { id: "log_002", tool: "record_read", outcome: "negative", plan_item_id: "pli_005" };
    await writeResearch({ plans: PLANS, log: [entry, bare] });
    for (const args of [{}, { questionId: "q_001" }, { planItemId: "pli_005" }]) {
      const r = await researchQuery({ projectPath: dir, section: "log", ...args });
      if (!r.ok) throw new Error(r.errors.join(" "));
      expect(r.items).toEqual([unstaged, bare]);
    }
  });

  it("person_evidence orderBy review: reviewReasons covers the returned page's links only", async () => {
    const links = [
      ...Array.from({ length: 53 }, (_, k) => ({ id: `pe_c${k}`, assertion_id: `a_c${k}`, person_id: "I1", confidence: "confident" })),
      ...Array.from({ length: 5 }, (_, k) => ({ id: `pe_s${k}`, assertion_id: `a_s${k}`, person_id: "I1", confidence: "confident", superseded_by: "pe_c0" })),
      ...Array.from({ length: 2 }, (_, k) => ({ id: `pe_p${k}`, assertion_id: `a_p${k}`, person_id: "I1", confidence: "speculative" })),
    ];
    await writeResearch({ person_evidence: links });
    const first = await researchQuery({ projectPath: dir, section: "person_evidence", orderBy: "review" });
    const second = await researchQuery({ projectPath: dir, section: "person_evidence", orderBy: "review", offset: 50 });
    if (!first.ok || !second.ok) throw new Error("failed");
    expect(first.count).toBe(60);
    // The speculative links rank first and the superseded ones last, so each
    // page's reasons are its own links' reasons, unchanged.
    expect(first.reviewReasons).toEqual({ pe_p0: ["speculative match"], pe_p1: ["speculative match"] });
    expect(second.reviewReasons).toEqual(
      Object.fromEntries(Array.from({ length: 5 }, (_, k) => [`pe_s${k}`, ["superseded"]])),
    );
    for (const page of [first, second]) {
      const ids = new Set(page.items.map((i: any) => i.id));
      expect(Object.keys(page.reviewReasons ?? {}).every((id) => ids.has(id))).toBe(true);
    }
  });

  it("person_evidence orderBy review: a page whose links carry no reason has no reviewReasons", async () => {
    const links = [
      ...Array.from({ length: 55 }, (_, k) => ({ id: `pe_c${k}`, assertion_id: `a_c${k}`, person_id: "I1", confidence: "confident" })),
      { id: "pe_s0", assertion_id: "a_s0", person_id: "I1", confidence: "confident", superseded_by: "pe_c0" },
    ];
    await writeResearch({ person_evidence: links });
    const first = await researchQuery({ projectPath: dir, section: "person_evidence", orderBy: "review" });
    if (!first.ok) throw new Error("failed");
    expect(first.items).toHaveLength(50);
    expect(first).not.toHaveProperty("reviewReasons");
  });
});

// ── page budget (#4411) ──────────────────────────────────────────────────────
// A page holds at most 50 items and stops short when the WHOLE answer, as
// writerToolResult sends it (JSON.stringify, compact), would pass
// TOOL_RESULT_CHAR_BUDGET. Pages are cut greedily from 0, so an offset that is
// not a page start is refused rather than served from the middle of a page.
describe("research_query page budget", () => {
  const BUDGET = 40_000;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-budget-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeResearch(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf-8");
  }

  const size = (r: unknown) => JSON.stringify(r).length;

  /** Every page from 0, following nextOffset; fails on an over-budget page. */
  async function allPages(args: Record<string, unknown>) {
    const pages: any[] = [];
    let offset = 0;
    for (let i = 0; i < 100; i++) {
      const r = await researchQuery({ projectPath: dir, ...(args as any), ...(offset ? { offset } : {}) });
      if (!r.ok) throw new Error(r.errors.join(" "));
      expect(size(r)).toBeLessThanOrEqual(BUDGET);
      pages.push(r);
      if (!r.truncated) {
        expect(r).not.toHaveProperty("nextOffset");
        return pages;
      }
      expect(r.nextOffset).toBe(offset + r.items.length);
      offset = r.nextOffset!;
    }
    throw new Error("paging did not end");
  }

  const longLog = () =>
    Array.from({ length: 50 }, (_, i) => ({
      id: `log_${String(i + 1).padStart(3, "0")}`,
      plan_item_id: "pli_001",
      tool: "record_search",
      outcome: "positive",
      notes: `entry ${i} ` + "n".repeat(3300),
    }));

  it("cuts 50 log entries with 3.3k notes into pages within budget that together hold every entry once", async () => {
    const log = longLog();
    await writeResearch({ log });

    const pages = await allPages({ section: "log" });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.items.map((e: any) => e.id))).toEqual(log.map((e) => e.id));
    for (const p of pages) expect(p.count).toBe(50);
  });

  it("cuts a question's 6 active plans of 10 items with long rationales the same way", async () => {
    const plans = Array.from({ length: 6 }, (_, p) => ({
      id: `pl_00${p + 1}`,
      question_id: "q_001",
      status: "active",
      items: Array.from({ length: 10 }, (_, i) => ({
        id: `pli_${p}${i}`,
        status: "planned",
        rationale: `plan ${p} item ${i} ` + "r".repeat(1200),
      })),
    }));
    await writeResearch({ plans });

    const pages = await allPages({ section: "plans", questionId: "q_001" });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.items.map((e: any) => e.id))).toEqual(plans.map((p) => p.id));
  });

  it("refuses offset 50 after a first page ending at 12, naming 12", async () => {
    // Twelve 3.1k entries fit in 40k and the thirteenth does not, so page one
    // is [0,12); the rest are small, so page two is [12,62) and offset 50 lies
    // inside it.
    const log = Array.from({ length: 80 }, (_, i) => ({
      id: `log_${i}`,
      plan_item_id: "pli_001",
      notes: i < 13 ? "x".repeat(3150) : "short",
    }));
    await writeResearch({ log });
    const first = await researchQuery({ projectPath: dir, section: "log" });
    if (!first.ok) throw new Error("failed");
    expect(first.items).toHaveLength(12);
    expect(first.nextOffset).toBe(12);

    const stepped = await researchQuery({ projectPath: dir, section: "log", offset: 50 });

    expect(stepped.ok).toBe(false);
    if (stepped.ok) return;
    expect(stepped.errors[0]).toMatch(/offset 50 is not where a page of this answer starts/);
    expect(stepped.errors[0]).toMatch(/starts at offset 12: call again with offset: 12/);
    // offset 5, inside the first page, names its start, 0.
    const inside = await researchQuery({ projectPath: dir, section: "log", offset: 5 });
    expect(inside.ok).toBe(false);
    if (!inside.ok) expect(inside.errors[0]).toMatch(/offset: 0\./);
  });

  it("names the start of the page an offset lands in, 12 when it lands in the second", async () => {
    const log = Array.from({ length: 60 }, (_, i) => ({ id: `log_${i}`, notes: "x".repeat(3150) }));
    await writeResearch({ log });
    const stepped = await researchQuery({ projectPath: dir, section: "log", offset: 20 });
    expect(stepped.ok).toBe(false);
    if (!stepped.ok) expect(stepped.errors[0]).toMatch(/starts at offset 12: call again with offset: 12/);
  });

  it("refuses an offset past the end once a page was short, naming the last page start", async () => {
    // 40 entries: pages [0,12) [12,24) [24,36) [36,40). A step-by-50 caller sends 50.
    const log = Array.from({ length: 40 }, (_, i) => ({ id: `log_${i}`, notes: "x".repeat(3150) }));
    await writeResearch({ log });

    const past = await researchQuery({ projectPath: dir, section: "log", offset: 50 });

    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors[0]).toMatch(/offset: 36\./);
  });

  it("returns an empty page past the end when every page but the last is full", async () => {
    const log = Array.from({ length: 60 }, (_, i) => ({ id: `log_${i}` }));
    await writeResearch({ log });
    const past = await researchQuery({ projectPath: dir, section: "log", offset: 100 });
    expect(past).toEqual({ ok: true, section: "log", count: 60, items: [], truncated: false });
  });

  it("keeps the 0/50/100 boundaries when every page fits", async () => {
    const log = Array.from({ length: 120 }, (_, i) => ({ id: `log_${i}` }));
    await writeResearch({ log });
    const pages = await allPages({ section: "log" });
    expect(pages.map((p) => p.items.length)).toEqual([50, 50, 20]);
    expect(pages.map((p) => p.nextOffset)).toEqual([50, 100, undefined]);
  });

  it("counts countById in the page, not the items alone", async () => {
    // 50 links whose items alone come to just under the budget; the 50-id
    // countById pushes the whole answer over it.
    const ids = Array.from({ length: 50 }, (_, i) => `I${1000 + i}`);
    const person_evidence = ids.map((id, i) => ({
      id: `pe_${i}`,
      assertion_id: `a_${i}`,
      person_id: id,
      confidence: "probable",
      rationale: "r".repeat(700),
    }));
    await writeResearch({ person_evidence });
    expect(size(person_evidence)).toBeLessThan(BUDGET);

    const r = await researchQuery({ projectPath: dir, section: "person_evidence", personId: ids });

    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(size(r)).toBeLessThanOrEqual(BUDGET);
    expect(r.items.length).toBeLessThan(50);
    expect(r.truncated).toBe(true);
    expect(Object.keys(r.countById ?? {})).toHaveLength(50);
  });

  it("counts reviewReasons in the page, not the items alone", async () => {
    // Every link carries three reasons; the items alone fit, the reasons tip it.
    const person_evidence = Array.from({ length: 50 }, (_, i) => ({
      id: `pe_${i}`,
      assertion_id: `a_${i}`,
      person_id: "I1",
      confidence: "speculative",
      core_identifier_conflict: "Birth year: record 1853, tree ~1840",
      superseded_by: `pe_${i + 100}`,
      rationale: "r".repeat(590),
    }));
    await writeResearch({ person_evidence });
    expect(size(person_evidence)).toBeLessThan(BUDGET);

    const r = await researchQuery({ projectPath: dir, section: "person_evidence", orderBy: "review" });

    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(size(r)).toBeLessThanOrEqual(BUDGET);
    expect(r.items.length).toBeLessThan(50);
    expect(Object.keys(r.reviewReasons ?? {})).toHaveLength(r.items.length);
    expect(size(person_evidence) + size(r.reviewReasons)).toBeGreaterThan(BUDGET);
  });

  it("counts unregisteredDisagreements in every conflicts page", async () => {
    const assertions = Array.from({ length: 30 }, (_, i) => [
      { id: `a_b${i}`, fact_type: "birth", date: "1850", place: "Ohio" },
      { id: `a_c${i}`, fact_type: "birth", date: "1861", place: "Texas" },
    ]).flat();
    const person_evidence = assertions.map((a, i) => ({
      id: `pe_${i}`,
      assertion_id: a.id,
      person_id: `I${Math.floor(i / 2)}`,
      confidence: "probable",
    }));
    // The 50 conflicts alone fit; only the disagreements push the answer over.
    const conflicts = Array.from({ length: 50 }, (_, i) => ({
      id: `c_${i}`,
      status: "unresolved",
      competing_assertion_ids: [],
      description: "d".repeat(670),
    }));
    await writeResearch({ assertions, person_evidence, conflicts });
    expect(size(conflicts)).toBeLessThan(BUDGET);

    const pages = await allPages({ section: "conflicts" });

    expect(size(conflicts) + size(pages[0].unregisteredDisagreements)).toBeGreaterThan(BUDGET);
    expect(pages[0].items.length).toBeLessThan(50);
    for (const p of pages) expect(p.unregisteredDisagreements).toEqual(pages[0].unregisteredDisagreements);
    expect(pages.flatMap((p) => p.items.map((c: any) => c.id))).toEqual(conflicts.map((c) => c.id));
  });

  it("returns one item alone when it is over budget by itself", async () => {
    const log = [{ id: "log_0", notes: "x".repeat(45_000) }, { id: "log_1" }];
    await writeResearch({ log });
    const r = await researchQuery({ projectPath: dir, section: "log" });
    if (!r.ok) throw new Error("failed");
    expect(r.items.map((e: any) => e.id)).toEqual(["log_0"]);
    expect(r.nextOffset).toBe(1);
  });

  it("pages external_collections by the same rule", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      key: `k${String(i).padStart(2, "0")}`,
      place: "Ohio, United States",
      record_types: ["Births"],
      title: "t".repeat(3000),
    }));
    await writeFile(
      join(dir, "external-collections.json"),
      JSON.stringify({ places: { "Ohio, United States": { rows } } }),
      "utf-8",
    );
    await writeResearch({});

    const pages = await allPages({ section: "external_collections" });

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.items.map((r: any) => r.key))).toEqual(rows.map((r) => r.key));
  });

  it("counts settledConflicts in the page, not the items alone", async () => {
    // 50 links whose items alone fit under budget; one settledConflicts row per
    // link (each from a unique record, so each note is unique) pushes it over.
    const person_evidence = Array.from({ length: 50 }, (_, i) => ({
      id: `pe_${i}`,
      assertion_id: `a_b${i}`,
      person_id: "I1",
      confidence: "probable",
      rationale: "r".repeat(550),
    }));
    const assertions = Array.from({ length: 50 }, (_, i) => ({
      id: `a_b${i}`,
      source_id: "src_001",
      record_id: `rec_${i}`,
      record_role: "subject",
      fact_type: "birth",
      place: "Pennsylvania",
    }));
    // One resolved conflict sets aside every birth assertion except the preferred.
    const conflicts = [
      {
        id: "c_001",
        conflict_type: "fact",
        disputed_attribute: "birthplace",
        competing_assertion_ids: assertions.map((a) => a.id),
        status: "resolved",
        preferred_assertion_id: "a_b0",
      },
    ];
    await writeResearch({ person_evidence, assertions, conflicts });
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify({ persons: [{ id: "I1", facts: [{ type: "Birth", place: "Ireland" }] }] }),
      "utf-8",
    );
    expect(size(person_evidence)).toBeLessThan(BUDGET);

    const r = await researchQuery({ projectPath: dir, section: "person_evidence" });

    if (!r.ok) throw new Error(r.errors.join(" "));
    expect(size(r)).toBeLessThanOrEqual(BUDGET);
    expect(r.items.length).toBeLessThan(50);
    expect(r.settledConflicts).toBeDefined();
    // Items alone would fit; settledConflicts notes push the full page over.
    expect(size(person_evidence) + size(r.settledConflicts)).toBeGreaterThan(BUDGET);
  });
});

// ── settledConflicts (#4592) ──────────────────────────────────────────────────
describe("research_query — person_evidence names settled birth disputes", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-settled-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const CERT = "ark:/61903/1:1:MDEF";
  const CENSUS = "ark:/61903/1:1:MXHY";
  const cert = (id: string, over: Record<string, unknown> = {}) => ({
    id, source_id: "src_001", record_id: CERT, record_role: "deceased", record_persona_id: null,
    fact_type: "name", value: "Patrick Flynn", ...over,
  });

  function research(status: string, preferred: string | null) {
    return {
      assertions: [
        cert("a_011"),
        cert("a_012", { fact_type: "birth", value: "Born in Pennsylvania", place: "Pennsylvania" }),
        cert("a_013", { fact_type: "death", value: "Died 1908" }),
        {
          id: "a_002", source_id: "src_002", record_id: CENSUS, record_role: "child_1",
          record_persona_id: null, fact_type: "birth", value: "Born in Ireland", place: "Ireland",
        },
      ],
      person_evidence: [
        { id: "pe_001", assertion_id: "a_002", person_id: "I1", confidence: "confident", superseded_by: null },
        { id: "pe_004", assertion_id: "a_011", person_id: "I1", confidence: "confident", superseded_by: null },
        { id: "pe_005", assertion_id: "a_013", person_id: "I1", confidence: "confident", superseded_by: null },
        { id: "pe_006", assertion_id: "a_012", person_id: "I1", confidence: "probable", superseded_by: "pe_004" },
      ],
      conflicts: [
        {
          id: "c_001", conflict_type: "fact", disputed_attribute: "birthplace",
          competing_assertion_ids: ["a_002", "a_012"], status, preferred_assertion_id: preferred,
        },
      ],
    };
  }

  async function project(r: any, tree: any | null) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r), "utf-8");
    if (tree) await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree), "utf-8");
  }

  const TREE = {
    persons: [{ id: "I1", names: [{ given: "Patrick", surname: "Flynn" }], facts: [{ type: "Birth", place: "Ireland" }] }],
  };

  async function links(args: Record<string, unknown> = {}) {
    const result = await researchQuery({ projectPath: dir, section: "person_evidence", ...args });
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result;
  }

  it("groups the live links of one record person under the sentences they share", async () => {
    await project(research("resolved", "a_002"), TREE);
    const result = await links({ personId: "I1" });
    expect(result.settledConflicts).toHaveLength(1);
    const [row] = result.settledConflicts!;
    expect(row.linkIds).toEqual(["pe_004", "pe_005"]);
    expect(row.notes).toHaveLength(1);
    expect(row.notes[0]).toContain("'c_001'");
    expect(row.notes[0]).toContain('"Pennsylvania"');
  });

  it("covers only the links the call returned", async () => {
    await project(research("resolved", "a_002"), TREE);
    const result = await links({ assertionId: "a_013" });
    expect(result.settledConflicts).toEqual([
      { linkIds: ["pe_005"], notes: [expect.stringContaining("'c_001'")] },
    ]);
  });

  it("is absent while the conflict is unresolved", async () => {
    await project(research("unresolved", null), TREE);
    expect(await links({ personId: "I1" })).not.toHaveProperty("settledConflicts");
  });

  it("is absent for the record the conflict preferred", async () => {
    await project(research("resolved", "a_002"), TREE);
    expect(await links({ assertionId: "a_002" })).not.toHaveProperty("settledConflicts");
  });

  it("is absent when the tree cannot be read, and the links still come back", async () => {
    await project(research("resolved", "a_002"), null);
    const result = await links({ personId: "I1" });
    expect(result.count).toBe(4);
    expect(result).not.toHaveProperty("settledConflicts");
  });

  it("is absent on every other section", async () => {
    await project(research("resolved", "a_002"), TREE);
    const result = await researchQuery({ projectPath: dir, section: "assertions", recordId: CERT });
    expect(result).not.toHaveProperty("settledConflicts");
  });
});

describe("research_query — assertions grouped by persona (#4412)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-grouped-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeResearch(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  }

  const HOISTED = ["record_id", "record_persona_id", "record_role", "source_id", "log_entry_id"];
  const head = { record_id: "REC1", record_persona_id: "p_1", record_role: "principal", source_id: "src_1", log_entry_id: "log_1" };
  // Stored order is the answer's order. a_1..a_3 share a persona whose informant
  // varies; a_4/a_5 have no record_persona_id at all and a_6 has it null (two
  // different groups); a_7 has no log_entry_id; a_8 is a_1's persona again but
  // not adjacent, so it opens a second group rather than being merged back.
  const fixture = [
    { id: "a_1", ...head, fact_type: "birth", informant: "Mary", informant_proximity: "self", extracted_for_question_ids: ["q_1"] },
    { id: "a_2", ...head, fact_type: "name", informant: "John", informant_proximity: "neighbor", extracted_for_question_ids: ["q_1"] },
    { id: "a_3", ...head, fact_type: "residence", informant: "Mary", extracted_for_question_ids: ["q_1", "q_2"] },
    { id: "a_4", record_id: "REC1", record_role: "child", source_id: "src_1", log_entry_id: "log_1", fact_type: "birth", extracted_for_question_ids: ["q_1"] },
    { id: "a_5", record_id: "REC1", record_role: "child", source_id: "src_1", log_entry_id: "log_1", fact_type: "name", extracted_for_question_ids: ["q_1"] },
    { id: "a_6", record_id: "REC1", record_persona_id: null, record_role: "child", source_id: "src_1", log_entry_id: "log_1", fact_type: "name", extracted_for_question_ids: ["q_1"] },
    { id: "a_7", record_id: "REC2", record_persona_id: "p_2", record_role: "principal", source_id: "src_2", fact_type: "death", extracted_for_question_ids: ["q_1"] },
    { id: "a_8", ...head, fact_type: "death", informant: "Mary", extracted_for_question_ids: ["q_1"] },
    { id: "a_9", record_id: "REC3", record_persona_id: "p_3", record_role: "principal", source_id: "src_3", log_entry_id: "log_2", fact_type: "birth", extracted_for_question_ids: ["q_2"] },
  ];

  async function read(args: Record<string, unknown>) {
    const r = await researchQuery({ projectPath: dir, section: "assertions", ...args } as any);
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r;
  }

  it("flattens back to exactly the stored assertions, in order", async () => {
    await writeResearch({ assertions: fixture });
    const r = await read({});
    expect(r.items.map((g: any) => g.facts.map((f: any) => f.id))).toEqual([
      ["a_1", "a_2", "a_3"], ["a_4", "a_5"], ["a_6"], ["a_7"], ["a_8"], ["a_9"],
    ]);
    expect(flat(r)).toEqual(fixture);
    expect(r.count).toBe(fixture.length);
  });

  it("hoists exactly the five persona keys, and keeps an absent key absent", async () => {
    await writeResearch({ assertions: fixture });
    const groups = (await read({})).items as any[];
    expect(Object.keys(groups[0]).sort()).toEqual([...HOISTED, "facts"].sort());
    // informant varies inside the persona, so it stays on each fact.
    expect(groups[0].facts.map((f: any) => f.informant)).toEqual(["Mary", "John", "Mary"]);
    for (const f of groups[0].facts) for (const k of HOISTED) expect(Object.hasOwn(f, k)).toBe(false);
    // Absent and null are different personas, and neither is invented.
    expect(Object.hasOwn(groups[1], "record_persona_id")).toBe(false);
    expect(groups[2].record_persona_id).toBeNull();
    expect(Object.hasOwn(groups[3], "log_entry_id")).toBe(false);
    const back = flat({ items: groups });
    expect(Object.hasOwn(back[3], "record_persona_id")).toBe(false);
    expect(Object.hasOwn(back[6], "log_entry_id")).toBe(false);
  });

  it("drops the questionId echo only when it is exactly [questionId], and flatten restores it", async () => {
    await writeResearch({ assertions: fixture });
    const r = await read({ questionId: "q_1" });
    const facts = (r.items as any[]).flatMap((g) => g.facts);
    const byId = Object.fromEntries(facts.map((f: any) => [f.id, f]));
    expect(Object.hasOwn(byId.a_1, "extracted_for_question_ids")).toBe(false);
    expect(byId.a_3.extracted_for_question_ids).toEqual(["q_1", "q_2"]);
    expect(flat(r, "q_1")).toEqual(fixture.filter((a) => a.extracted_for_question_ids.includes("q_1")));
    // Without a questionId filter nothing is dropped.
    const byRecord = (await read({ recordId: "REC1" })).items as any[];
    expect(byRecord[0].facts[0].extracted_for_question_ids).toEqual(["q_1"]);
  });

  it("counts assertions, not groups: count, countById and a page's facts agree with the flat set", async () => {
    await writeResearch({ assertions: fixture });
    const r = await read({ recordId: ["REC1", "REC2"] });
    expect(r.items.length).toBe(5);
    expect(r.count).toBe(8);
    expect(flat(r).length).toBe(8);
    expect(r.countById).toEqual({ REC1: 7, REC2: 1 });
  });

  it("other sections are untouched, key order included", async () => {
    const sources = [{ id: "src_1", title: "T", record_id: "REC1", source_id: "x" }];
    await writeResearch({ assertions: fixture, sources });
    const r = await researchQuery({ projectPath: dir, section: "sources" });
    if (!r.ok) throw new Error("expected ok");
    expect(JSON.stringify(r.items)).toBe(JSON.stringify(sources));
  });

  describe("the 40k budget is measured on the grouped answer", () => {
    // 150 assertions in personas of 7, ~1.4k chars each flat (~29 per 40k
    // page) and ~1k grouped (~40 per page): the budget, not MAX_ITEMS, ends
    // every page in both shapes, and grouping fits more per page.
    const big = Array.from({ length: 150 }, (_, i) => ({
      id: `a_${String(i).padStart(3, "0")}`,
      record_id: `ark:/61903/1:1:${"R".repeat(200)}${Math.floor(i / 7)}`,
      record_persona_id: `ark:/61903/1:1:${"P".repeat(200)}${Math.floor(i / 7)}`,
      record_role: "principal",
      source_id: `src_${Math.floor(i / 7)}`,
      log_entry_id: `log_${Math.floor(i / 7)}`,
      fact_type: "residence",
      value: "v".repeat(900),
    }));

    async function pages() {
      const out: any[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const r = await read(offset ? { offset } : {});
        out.push(r);
        offset = r.nextOffset;
        if (out.length > 200) throw new Error("paging did not end");
      }
      return out;
    }

    it("every page fits, is maximal, and paging visits each assertion once", async () => {
      await writeResearch({ assertions: big });
      const all = await pages();
      expect(all.length).toBeGreaterThan(1);
      const seen: string[] = [];
      let budgetEnded = 0;
      for (const [n, p] of all.entries()) {
        // The budget covers the whole answer, not only its items (#4411).
        expect(JSON.stringify(p).length).toBeLessThanOrEqual(40_000);
        const facts = flat(p);
        seen.push(...facts.map((a) => a.id));
        expect(p.count).toBe(150);
        if (n < all.length - 1) {
          expect(p.nextOffset).toBe(seen.length);
          // Maximal: the same answer with the next assertion joined to it does not fit.
          const next = big[seen.length];
          const fact = Object.fromEntries(Object.entries(next).filter(([k]) => !HOISTED.includes(k)));
          const groups = structuredClone(p.items) as any[];
          const tail = groups.at(-1);
          if (HOISTED.every((k) => tail[k] === (next as any)[k])) tail.facts.push(fact);
          else groups.push({ ...Object.fromEntries(HOISTED.map((k) => [k, (next as any)[k]])), facts: [fact] });
          const grown = { ...p, items: groups, nextOffset: seen.length + 1 };
          if (facts.length < 50) {
            expect(JSON.stringify(grown).length).toBeGreaterThan(40_000);
            budgetEnded += 1;
          }
        }
      }
      expect(seen).toEqual(big.map((a) => a.id));
      expect(budgetEnded).toBe(all.length - 1);
    });

    it("fits more assertions than a flat-measured budget would", async () => {
      await writeResearch({ assertions: big });
      const first = await read({});
      let flatSize = 0;
      let flatFit = 0;
      for (const a of big) {
        const len = JSON.stringify(a).length;
        if (flatFit > 0 && flatSize + len > 40_000) break;
        flatSize += len;
        flatFit += 1;
      }
      expect(flatFit).toBeLessThan(50);
      expect(flat(first).length).toBeGreaterThan(flatFit);
    });

    it("a persona split across pages repeats its head on the next page", async () => {
      await writeResearch({ assertions: big });
      const all = await pages();
      const split = all.findIndex((p, n) => {
        const nextPage = all[n + 1];
        if (!nextPage) return false;
        const lastHere = (p.items as any[]).at(-1);
        return lastHere.record_id === (nextPage.items as any[])[0].record_id;
      });
      expect(split).toBeGreaterThanOrEqual(0);
      const firstThere = (all[split + 1].items as any[])[0];
      for (const k of HOISTED) expect(Object.hasOwn(firstThere, k)).toBe(true);
    });

    it("refuses an offset that is not a grouped page boundary", async () => {
      await writeResearch({ assertions: big });
      const first = await read({});
      const r = await researchQuery({ projectPath: dir, section: "assertions", offset: (first.nextOffset ?? 2) - 1 });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/starts at offset 0: call again with offset: 0/);
    });
  });
});

describe("flattenAssertionGroups", () => {
  it("passes a flat answer through unchanged", () => {
    const items = [{ id: "a_1", record_id: "R" }, { id: "a_2" }];
    expect(flattenAssertionGroups(items)).toEqual(items);
  });

  it("passes non-object entries through", () => {
    expect(flattenAssertionGroups([null, "x", { facts: "not a list" }])).toEqual([null, "x", { facts: "not a list" }]);
  });
});

describe("research_query — person_evidence names a two-party assertion's unlinked second person", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-query-unlinked-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const REL = (id: string, over: Record<string, unknown> = {}) => ({
    id, source_id: "src_004", record_id: "ark:/61903/1:1:MDEF", record_role: "deceased",
    fact_type: "relationship", value: "Father: Thomas Flynn",
    structured_value: { relationship_type: "father", related_person_role: "deceased" }, ...over,
  });
  const pe = (id: string, assertion: string, person: string, over: Record<string, unknown> = {}) => ({
    id, assertion_id: assertion, person_id: person, confidence: "confident", superseded_by: null, ...over,
  });
  const TREE = {
    persons: [
      { id: "I1", gender: "Male", names: [{ given: "Patrick", surname: "Flynn" }] },
      { id: "I2", gender: "Male", names: [{ given: "Thomas", surname: "Flynn" }] },
      { id: "I5", gender: "Female", names: [{ given: "Mary", surname: "Doyle" }] },
      { id: "I6", gender: "Female", names: [{ given: "Ann", surname: "Kerr" }] },
    ],
    relationships: [
      { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
      { id: "R2", type: "ParentChild", parent: "I5", child: "I1" },
      { id: "R3", type: "Couple", person1: "I1", person2: "I6" },
    ],
  };

  async function project(assertions: any[], links: any[], tree: any | null = TREE) {
    await writeFile(join(dir, "research.json"), JSON.stringify({ assertions, person_evidence: links }), "utf-8");
    if (tree) await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree), "utf-8");
  }
  async function links(args: Record<string, unknown> = {}) {
    const result = await researchQuery({ projectPath: dir, section: "person_evidence", ...args });
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result;
  }

  it("names the tree's father when only the child is linked", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1")]);
    expect((await links({ assertionId: "a_013" })).unlinkedParties).toEqual([
      {
        assertionId: "a_013",
        linkedPersonId: "I1",
        unlinkedPersonId: "I2",
        note:
          "Assertion 'a_013' (\"Father: Thomas Flynn\") names a second person. The tree's father of 'I1' " +
          "is 'I2' (Thomas Flynn), and 'I2' has no person_evidence link to this assertion.",
      },
    ]);
  });

  it("is absent when both parties are linked", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1"), pe("pe_009", "a_013", "I2")]);
    expect(await links({ assertionId: "a_013" })).not.toHaveProperty("unlinkedParties");
  });

  it("counts a second link that a personId filter hides", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1"), pe("pe_009", "a_013", "I2")]);
    const result = await links({ personId: "I1" });
    expect(result.items.map((i: any) => i.id)).toEqual(["pe_005"]);
    expect(result).not.toHaveProperty("unlinkedParties");
  });

  it("counts a second link that sits past the first page", async () => {
    const filler = Array.from({ length: 60 }, (_, i) => pe(`pe_f${i}`, `a_f${i}`, "I1"));
    const fillerAssertions = filler.map((l) => REL(l.assertion_id, { fact_type: "birth", structured_value: null }));
    await project(
      [REL("a_013"), ...fillerAssertions],
      [pe("pe_005", "a_013", "I1"), ...filler, pe("pe_009", "a_013", "I2")],
    );
    const first = await links();
    expect(first.items.map((i: any) => i.id)).toContain("pe_005");
    expect(first.items.map((i: any) => i.id)).not.toContain("pe_009");
    expect(first).not.toHaveProperty("unlinkedParties");
  });

  it("ignores a superseded second link", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1"), pe("pe_009", "a_013", "I2", { superseded_by: "pe_010" })]);
    expect((await links({ assertionId: "a_013" })).unlinkedParties?.map((r) => r.unlinkedPersonId)).toEqual(["I2"]);
  });

  it("is absent when the assertion is linked to someone the tree does not name", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1"), pe("pe_009", "a_013", "I7")]);
    expect(await links({ assertionId: "a_013" })).not.toHaveProperty("unlinkedParties");
  });

  it("keeps a father assertion off the mother, and names the mother for a mother assertion", async () => {
    await project(
      [REL("a_013"), REL("a_014", { value: "Mother: Mary Doyle", structured_value: { relationship_type: "mother" } })],
      [pe("pe_005", "a_013", "I1"), pe("pe_006", "a_014", "I1")],
    );
    const rows = (await links({ personId: "I1" })).unlinkedParties!;
    expect(rows.map((r) => [r.assertionId, r.unlinkedPersonId])).toEqual([["a_013", "I2"], ["a_014", "I5"]]);
  });

  it("reads relationship_type as the subject's own role first: `child` names every parent", async () => {
    await project(
      [REL("a_010", { value: "Listed as son of head Thomas Flynn", structured_value: { relationship_type: "child_inferred", related_person_role: "head_of_household" } })],
      [pe("pe_004", "a_010", "I1")],
    );
    const rows = (await links({ assertionId: "a_010" })).unlinkedParties!;
    expect(rows.map((r) => r.unlinkedPersonId)).toEqual(["I2", "I5"]);
    expect(rows[0].note).toContain("The tree's parent of 'I1' is 'I2' (Thomas Flynn)");
  });

  it("keeps only the parent related_person_role names: a death certificate's father is not the mother", async () => {
    await project(
      [REL("a_010", { value: "Father: Thomas Flynn", structured_value: { relationship_type: "child", related_person_role: "father" } })],
      [pe("pe_004", "a_010", "I1")],
    );
    const rows = (await links({ assertionId: "a_010" })).unlinkedParties!;
    expect(rows.map((r) => r.unlinkedPersonId)).toEqual(["I2"]);
  });

  it("reads the relation from the fact_type when there is no relationship_type", async () => {
    await project(
      [
        REL("a_020", { fact_type: "father_birthplace", value: "Father's birthplace: Ireland", structured_value: null }),
        REL("a_021", { fact_type: "Marriage", value: "Married Ann Kerr", structured_value: null }),
      ],
      [pe("pe_020", "a_020", "I1"), pe("pe_021", "a_021", "I1")],
    );
    const rows = (await links({ personId: "I1" })).unlinkedParties!;
    expect(rows.map((r) => [r.assertionId, r.unlinkedPersonId])).toEqual([["a_020", "I2"], ["a_021", "I6"]]);
  });

  it("never fires on a one-party fact, even one carrying a relationship_type, or on a superseded assertion", async () => {
    await project(
      [REL("a_011", { fact_type: "death" }), REL("a_013", { superseded_by: "a_099" })],
      [pe("pe_004", "a_011", "I1"), pe("pe_005", "a_013", "I1")],
    );
    expect(await links({ personId: "I1" })).not.toHaveProperty("unlinkedParties");
  });

  it("is silent when the tree has no such relative, or cannot be read", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1")], { persons: TREE.persons, relationships: [] });
    expect(await links({ assertionId: "a_013" })).not.toHaveProperty("unlinkedParties");
    await rm(join(dir, "tree.gedcomx.json"));
    const result = await links({ assertionId: "a_013" });
    expect(result.count).toBe(1);
    expect(result).not.toHaveProperty("unlinkedParties");
  });

  it("is absent on every other section", async () => {
    await project([REL("a_013")], [pe("pe_005", "a_013", "I1")]);
    const result = await researchQuery({ projectPath: dir, section: "assertions", assertionId: "a_013" });
    expect(result).not.toHaveProperty("unlinkedParties");
  });

  it("names I2 for a_010 and a_013 on the committed mid-research-flynn scenario, and nothing for a_004", async () => {
    const scenario = join(
      dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..",
      "eval", "fixtures", "scenarios", "mid-research-flynn",
    );
    for (const f of ["research.json", "tree.gedcomx.json"]) {
      await writeFile(join(dir, f), readFileSync(join(scenario, f), "utf-8"), "utf-8");
    }
    const byPerson = (await links({ personId: "I1" })).unlinkedParties!;
    expect(byPerson.map((r) => [r.assertionId, r.unlinkedPersonId])).toEqual([["a_010", "I2"], ["a_013", "I2"]]);
    const one = (await links({ assertionId: "a_013" })).unlinkedParties!;
    expect(one).toHaveLength(1);
    expect(one[0].note).toContain("'I2' (Thomas Flynn)");
  });
});
