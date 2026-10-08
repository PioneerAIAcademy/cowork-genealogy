import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  researchQuery,
  RESEARCH_QUERY_SECTIONS,
  RESEARCH_QUERY_EXCLUDED,
  RESEARCH_QUERY_OPTIONAL_SECTIONS,
} from "../../src/tools/research-query.js";

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

  it("answers rather than erroring when the folder is not a project", async () => {
    // `dir` is a bare temp directory — neither project file. That is not a read
    // failure, it is a user who is not in a research project (issue #1695), and
    // research_query is one of the two READS the issue calls out. The loud
    // half-a-project case (a tree present, research.json gone) is pinned in
    // tests/tools/no-project.test.ts.
    const result = await researchQuery({ projectPath: dir, section: "assertions" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result as any).reason).toBe("no_project");
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
    // `known_holdings`, which is excluded and so has no absence behaviour at
    // all. Subtracting the exclusions is what makes this hold today and keeps
    // holding when issue #2069 lands: the subtraction becomes a no-op.
    const expected = arraySections
      .filter((s) => !required.has(s) && !(s in RESEARCH_QUERY_EXCLUDED))
      .sort();
    expect([...RESEARCH_QUERY_OPTIONAL_SECTIONS].sort()).toEqual(expected);
  });

  it("every excluded section is still a top-level array section of the schema", () => {
    // The tripwire for issue #2069. When it deletes `known_holdings` from the
    // schema, this reds until the RESEARCH_QUERY_EXCLUDED entry goes with it —
    // so the exclusion map cannot rot into a list of sections that no longer
    // exist.
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
