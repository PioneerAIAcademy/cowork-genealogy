// The claim rules wired into research_append (issue #3032 Stage 1b): warn mode,
// the `Will be refused:` prefix naming the summary, once per batch against the
// final in-batch state, never on a narrative-only edit of a legacy summary, and
// a refusal that rolls the whole batch back when a rule is in refuse mode.
// Each rule's own cases are in tests/validation/claim-rules.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const modes = vi.hoisted(() => ({ refuse: new Set<string>() }));
vi.mock("../../src/validation/rule-modes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/validation/rule-modes.js")>();
  return { ...actual, ruleMode: (id: string) => (modes.refuse.has(id) ? "refuse" : actual.ruleMode(id)) };
});

import { researchAppend } from "../../src/tools/research-append.js";
import { writeProjectFile } from "../helpers/project-files.js";

const citationDetail = {
  who: "Clerk", what: "Baptism", when_created: "1850", when_accessed: "2026-01-01", where: "Parish", where_within: "p. 1",
};
const source = {
  id: "src_001", gedcomx_source_description_id: "SD-001", citation: "Parish register", citation_detail: citationDetail,
  source_classification: "original", repository: "Parish", access_date: "2026-01-01",
};
const assertion = (id: string, record_role: string, fact_type: string) => ({
  id, source_id: "src_001", record_id: "rec1", record_role, fact_type, value: "x", information_quality: "primary",
  informant: "priest", informant_proximity: "eyewitness", record_basis: "stated", extracted_for_question_ids: [],
});
const link = (assertion_id: string, person_id: string, n: number) => ({
  id: `pe_00${n}`, assertion_id, person_id, confidence: "confident", match_score: 0.9, rationale: "match",
  created: "2026-01-02", superseded_by: null,
});
const question = (id: string) => ({
  id, question: "Who was John's father?", rationale: "r", selection_basis: "objective_decomposition", priority: "high",
  status: "open", depends_on: [], unblocks: [], created: "2026-01-01", resolved: null, resolution_assertion_ids: [],
  search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
});
const parentClaim = (tier = "probable") => ({
  claim: "father", proof_tier: tier, supporting_assertion_ids: ["a_001", "a_002"],
  relationship: { type: "ParentChild", parent: "I2", child: "I1" },
});
const summaryEntry = (extra: Record<string, unknown> = {}) => ({
  question_id: "q_001", tier: "probable", vehicle: "summary", shortfall: "ceiling",
  supporting_assertion_ids: ["a_001", "a_002"], resolved_conflict_ids: [], exhaustive_search_summary: "s",
  narrative_markdown: "## Conclusion\nJohn's father was Thomas.", ...extra,
});

function project(proofSummaries: any[] = []) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [question("q_001")],
    plans: [], log: [], sources: [source],
    assertions: [assertion("a_001", "child", "birth"), assertion("a_002", "father", "name")],
    person_evidence: [link("a_001", "I1", 1), link("a_002", "I2", 2)],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: proofSummaries, evaluations: [],
  };
}
const tree = {
  persons: [
    { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] },
    { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Smith" }] },
  ],
  relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
  sources: [{ id: "SD-001", title: "Parish register" }],
};

describe("research_append runs the claim rules", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claim-rules-wiring-"));
    modes.refuse.clear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = async (research: any) => {
    await writeProjectFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeProjectFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  };
  const warnings = (r: any): string[] => r?.validation?.warnings ?? [];
  const append = (entry: any) => researchAppend({ projectPath: dir, section: "proof_summaries", op: "append", entry });

  it("a probable proof appended with no claims warns, naming the summary", async () => {
    await write(project());
    const r = await append(summaryEntry());
    expect(r.ok).toBe(true);
    expect(warnings(r)).toContainEqual(expect.stringMatching(/^Will be refused: proof_summaries ps_001: the summary is at 'probable' and carries no claims/));
  });

  it("an update raising a summary to probable with no claims warns", async () => {
    await write(project([{ id: "ps_001", ...summaryEntry({ tier: "possible" }), updated: "2026-01-02" }]));
    const r = await researchAppend({ projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001", fields: { tier: "probable" } });
    expect(r.ok).toBe(true);
    expect(warnings(r).join("\n")).toMatch(/Will be refused: proof_summaries ps_001: the summary is at 'probable' and carries no claims/);
  });

  it("a narrative-only edit of a legacy probable summary passes with no claim warning", async () => {
    await write(project([{ id: "ps_001", ...summaryEntry(), updated: "2026-01-02" }]));
    const r = await researchAppend({
      projectPath: dir, section: "proof_summaries", op: "update", entryId: "ps_001",
      fields: { narrative_markdown: "## Conclusion\nJohn's father was Thomas Smith." },
    });
    expect(r.ok).toBe(true);
    expect(warnings(r).join("\n")).not.toMatch(/Will be refused/);
  });

  it("a not_proved decline with no claims passes", async () => {
    await write(project());
    const r = await append(summaryEntry({ tier: "not_proved", shortfall: "gap", supporting_assertion_ids: [] }));
    expect(r.ok).toBe(true);
    expect(warnings(r).join("\n")).not.toMatch(/Will be refused/);
  });

  it("a grounded claim draws no warning", async () => {
    await write(project());
    const r = await append(summaryEntry({ claims: [parentClaim()] }));
    expect(r.ok).toBe(true);
    expect(warnings(r).join("\n")).not.toMatch(/Will be refused/);
  });

  it("a rule in refuse mode refuses, and the batch writes nothing", async () => {
    modes.refuse.add("claims-present");
    await write(project());
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await append(summaryEntry());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/carries no claims/);
    expect(JSON.stringify(r)).not.toMatch(/Will be refused/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("a later op in the same batch is seen: the rules read the final in-batch state", async () => {
    const research = project();
    research.questions.push(question("q_002"));
    await write(research);
    const pair = { person1: "I1", person2: "I2" };
    const marriage = { claim: "marriage", proof_tier: "probable", supporting_assertion_ids: ["a_001", "a_002"], fact: { subject: pair, fact_type: "Marriage", date: "1880" } };
    const coupleClaim = { claim: "couple", proof_tier: "probable", supporting_assertion_ids: ["a_001", "a_002"], relationship: { type: "Couple", ...pair } };
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "proof_summaries", op: "append", entry: summaryEntry({ claims: [marriage] }) },
        { section: "proof_summaries", op: "append", entry: summaryEntry({ question_id: "q_002", claims: [coupleClaim] }) },
      ],
    } as any);
    expect(r.ok, JSON.stringify(r).slice(0, 600)).toBe(true);
    expect(warnings(r).join("\n")).not.toMatch(/no affirmed Couple claim/);

    // The control: the Marriage alone, with no Couple claim anywhere, warns.
    await write(research);
    const alone = await append(summaryEntry({ claims: [marriage] }));
    expect(warnings(alone).join("\n")).toMatch(/Will be refused: proof_summaries ps_001: claim 'marriage' .* no affirmed Couple claim/);
  });

  it("resolving a question whose summary holds a claim held at possible by grounding warns, naming the summary", async () => {
    const research = project([{ id: "ps_001", ...summaryEntry({ tier: "possible", supporting_assertion_ids: ["a_001"], claims: [{ ...parentClaim("possible"), supporting_assertion_ids: ["a_001"] }] }), updated: "2026-01-02" }]);
    await write(research);
    const r = await researchAppend({
      projectPath: dir, section: "questions", op: "update", entryId: "q_001",
      fields: { status: "resolved", resolved: "2026-01-03" },
    });
    expect(warnings(r).join("\n")).toMatch(/Will be refused: proof_summaries ps_001: question q_001 is set resolved while claim 'father' stands at possible/);
  });
});

describe("research_append clears `primary` that follows a claim (Decision 34)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "primary-clear-"));
    modes.refuse.clear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const birthClaim = (tier = "probable") => ({
    claim: "birth", proof_tier: tier, supporting_assertion_ids: ["a_001"],
    fact: { subject: "I1", fact_type: "Birth", date: "1850" },
  });
  const marriageClaim = (tier = "probable") => ({
    claim: "marriage", proof_tier: tier, supporting_assertion_ids: ["a_001"],
    fact: { subject: { person1: "I1", person2: "I3" }, fact_type: "Marriage", date: "1875" },
  });
  const coupleClaim = { claim: "couple", proof_tier: "probable", supporting_assertion_ids: ["a_001"], relationship: { type: "Couple", person1: "I1", person2: "I3" } };
  const primaryTree = () => ({
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }],
        facts: [
          { id: "F1", type: "Birth", date: "1850", primary: true, sources: [{ ref: "SD-001" }] },
          { id: "F2", type: "Death", date: "1900", primary: true, sources: [{ ref: "SD-001" }] },
        ] },
      { id: "I3", gender: "Female", names: [{ id: "N3", given: "Mary", surname: "Jones" }] },
    ],
    relationships: [
      { id: "R2", type: "Couple", person1: "I1", person2: "I3", sources: [{ ref: "SD-001" }],
        facts: [{ id: "F9", type: "Marriage", date: "1875", primary: true, sources: [{ ref: "SD-001" }] }] },
    ],
    sources: [{ id: "SD-001", title: "Parish register" }],
  });
  const write = async (summaries: any[]) => {
    const research = project(summaries);
    research.questions.push({ ...question("q_002"), question: "When was John born?" });
    await writeProjectFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeProjectFile(join(dir, "tree.gedcomx.json"), JSON.stringify(primaryTree(), null, 2));
  };
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const fact = (t: any, id: string) =>
    [...t.persons.flatMap((p: any) => p.facts ?? []), ...t.relationships.flatMap((r: any) => r.facts ?? [])].find((f: any) => f.id === id);
  const setClaims = (entryId: string, claims: any[], tier?: string) =>
    researchAppend({ projectPath: dir, section: "proof_summaries", op: "update", entryId, fields: { claims, ...(tier ? { tier } : {}) } } as any);

  it("lowering the covering claim to possible clears primary in the same write, and names the fact", async () => {
    await write([{ id: "ps_001", ...summaryEntry({ claims: [birthClaim()] }) }]);
    const r: any = await setClaims("ps_001", [birthClaim("possible")], "possible");
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(fact(await readTree(), "F1")).not.toHaveProperty("primary");
    expect(r.validation.warnings.join("\n")).toMatch(/personId I1, factId F1: `primary` cleared/);
  });

  it("removing the covering claim from claims clears primary", async () => {
    await write([{ id: "ps_001", ...summaryEntry({ claims: [birthClaim(), coupleClaim] }) }]);
    const r: any = await setClaims("ps_001", [coupleClaim]);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(fact(await readTree(), "F1")).not.toHaveProperty("primary");
  });

  it("primary stays when another live probable claim covers the fact", async () => {
    await write([
      { id: "ps_001", ...summaryEntry({ claims: [birthClaim()] }) },
      { id: "ps_002", ...summaryEntry({ question_id: "q_002", claims: [birthClaim()] }) },
    ]);
    const r: any = await setClaims("ps_001", [birthClaim("possible")], "possible");
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(fact(await readTree(), "F1")?.primary).toBe(true);
    expect(r.validation.warnings.join("\n")).not.toMatch(/`primary` cleared/);
  });

  it("a legacy primary no claim covered is untouched", async () => {
    await write([{ id: "ps_001", ...summaryEntry({ claims: [birthClaim()] }) }]);
    const r: any = await setClaims("ps_001", [birthClaim("possible")], "possible");
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(fact(await readTree(), "F2")?.primary).toBe(true);
  });

  it("a Couple Marriage primary is cleared the same way", async () => {
    await write([{ id: "ps_001", ...summaryEntry({ claims: [coupleClaim, marriageClaim()] }) }]);
    const r: any = await setClaims("ps_001", [coupleClaim, marriageClaim("possible")], "possible");
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(fact(await readTree(), "F9")).not.toHaveProperty("primary");
    expect(r.validation.warnings.join("\n")).toMatch(/relationshipId R2, factId F9: `primary` cleared/);
  });
});
