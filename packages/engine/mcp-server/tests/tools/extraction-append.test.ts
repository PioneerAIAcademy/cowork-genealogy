import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { single } from "../helpers/narrow.js";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Same offline place-resolver stub the research_append suite uses. It doubles as
// the probe for "did the lane gate run before the network pre-pass?" — a rejected
// call must leave this mock untouched.
// Spreads the real module rather than replacing it: `countryConsistency` lives
// there too and research_append imports it, so a bare replacement leaves it
// `undefined` and any path that reaches it throws a TypeError instead of
// exercising the guard.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return {
    ...actual,
    resolveStandardPlace: vi.fn(async (text: string) => {
      if (text === "Schuylkill County, Pennsylvania") return "Schuylkill, Pennsylvania, United States";
      return null;
    }),
  };
});

import { extractionAppend, EXTRACTION_SECTIONS } from "../../src/tools/extraction-append.js";
import { researchAppend } from "../../src/tools/research-append.js";
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";

const citationDetail = {
  who: "Census enumerator",
  what: "1850 U.S. Census",
  when_created: "1850",
  when_accessed: "2026-01-01",
  where: "Schuylkill County, Pennsylvania",
  where_within: "dwelling 201",
};
const validSource = (id: string) => ({
  id,
  gedcomx_source_description_id: "SD-001",
  citation: "1850 U.S. Census, Schuylkill County, PA",
  citation_detail: citationDetail,
  source_classification: "original",
  repository: "NARA",
  access_date: "2026-01-01",
});
const validAssertion = (id: string, sourceId = "src_001") => ({
  id,
  source_id: sourceId,
  record_id: "rec1",
  record_role: "principal",
  fact_type: "birth",
  value: "1850",
  information_quality: "primary",
  informant: "self",
  informant_proximity: "self",
  record_basis: "stated",
  extracted_for_question_ids: [],
});
const noId = (o: any) => {
  const { id: _omit, ...rest } = o;
  return rest;
};

function baseResearch() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log: [],
    sources: [validSource("src_001")],
    assertions: [validAssertion("a_001")],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}
const baseTree = {
  persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
  relationships: [],
  sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
};

/** Every section research_append writes that this lane must NOT. */
const DENIED_SECTIONS = [
  "person_evidence",
  "questions",
  "plans",
  "plan_items",
  "conflicts",
  "hypotheses",
  "timelines",
  "proof_summaries",
  "evaluations",
  "known_holdings",
  "project",
];

describe("extraction_append (issue #695 lane enforcement)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-append-test-"));
    vi.mocked(resolveStandardPlace).mockClear();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any = baseResearch(), tree: any = baseTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  // ─── The lane holds ────────────────────────────────────────────────────────

  it("the lane is exactly {sources, assertions}", () => {
    expect([...EXTRACTION_SECTIONS].sort()).toEqual(["assertions", "sources"]);
  });

  it.each(DENIED_SECTIONS)("rejects section '%s' in single-op form", async (section) => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      section,
      op: "append",
      entry: { anything: true },
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toContain(`section '${section}' is not writable by extraction_append`);
  });

  it("rejects a denied section inside a batch, naming the failing op index", async () => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        {
          section: "person_evidence",
          op: "append",
          entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident", rationale: "m", superseded_by: null },
        },
      ],
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/^ops\[1\]: section 'person_evidence' is not writable/);
  });

  it("writes NOTHING when one op in a batch is out of lane", async () => {
    await writeProject();
    await extractionAppend({
      projectPath: dir,
      ops: [
        { section: "assertions", op: "append", entry: noId(validAssertion("x")) },
        { section: "conflicts", op: "append", entry: { conflict_type: "date", description: "d" } },
      ],
    } as any);
    const research = await readResearch();
    expect(research.assertions).toHaveLength(1); // the pre-existing a_001 only
  });

  // ─── The rejection must not become a routing map (plan §D4) ───────────────

  it("rejection text names only this tool and its own sections", async () => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: {},
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join(" ");
    expect(text).toContain("it writes only: sources, assertions");
    // Must not hand the model the tool that WOULD accept this section...
    expect(text).not.toContain("research_append");
    // ...nor enumerate the other sections it could try.
    for (const denied of DENIED_SECTIONS.filter((s) => s !== "person_evidence")) {
      expect(text).not.toContain(denied);
    }
  });

  // ─── The gate runs before the network pre-pass (plan §D3) ─────────────────

  it("rejects before prepareOps resolves any place", async () => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      ops: [
        {
          section: "assertions",
          op: "append",
          entry: { ...noId(validAssertion("x")), place: "Schuylkill County, Pennsylvania" },
        },
        { section: "project", op: "update", fields: { status: "completed" } },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });

  // ─── The lane's own work still succeeds ───────────────────────────────────

  it("appends a source", async () => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: noId(validSource("x")),
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(single(r).entryId).toBe("src_002");
  });

  it("persists a whole record — source + assertions — in one all-or-nothing batch", async () => {
    await writeProject();
    const r = await extractionAppend({
      projectPath: dir,
      ops: [
        { section: "sources", op: "append", entry: noId(validSource("x")) },
        { section: "assertions", op: "append", entry: noId(validAssertion("x", "src_002")) },
        { section: "assertions", op: "append", entry: noId(validAssertion("y", "src_002")) },
      ],
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => `${x.section}:${x.entryId}`)).toEqual([
      "sources:src_002",
      "assertions:a_002",
      "assertions:a_003",
    ]);
    const research = await readResearch();
    // Intra-batch forward reference survives the narrowed lane.
    expect(research.assertions[1].source_id).toBe("src_002");
  });

  it("refuses a D17 re-extraction — the same record's facts re-appended under the same log entry (§3.4.3)", async () => {
    const facts = ["name", "birth", "death", "residence", "occupation", "religion"];
    const extracted = (role: string, fact: string, value: string) => ({
      ...noId(validAssertion("x", "src_001")),
      record_role: role,
      fact_type: fact,
      value,
      log_entry_id: "log_001",
    });
    const research = baseResearch();
    research.log = [
      {
        id: "log_001",
        plan_item_id: null,
        performed: "2026-01-01T00:00:00Z",
        tool: "record_read",
        query: {},
        outcome: "positive",
        results_examined: 1,
        external_site: null,
        results_ref: null,
      },
    ] as any;
    research.assertions = [
      ...facts.map((f) => extracted("principal", f, `${f} of John`)),
      ...facts.map((f) => extracted("spouse", f, `${f} of Mary`)),
    ].map((a, i) => ({ id: `a_${String(i + 1).padStart(3, "0")}`, ...a })) as any;
    await writeProject(research);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { gedcomx_source_description_id: _g, ...sourceNoRef } = noId(validSource("x"));
    const rerun = [
      ...facts.map((f) => extracted("principal", f, `John's ${f}, reworded`)),
      ...facts.map((f) => extracted("spouse", f, `Mary's ${f}, reworded`)),
    ].map(({ source_id: _s, ...a }) => ({ section: "assertions", op: "append", entry: a }));
    const r = await extractionAppend({
      projectPath: dir,
      ops: [{ section: "sources", op: "append", entry: sourceNoRef }, ...rerun],
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.filter((e) => /already extracted on src_001 under log_001/.test(e))).toHaveLength(12);
    expect(r.errors.join(" ")).toMatch(/a_001 already records name .*`update` op/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ─── research_append is untouched ─────────────────────────────────────────

  it("research_append still accepts person_evidence (the lane is per-tool, not global)", async () => {
    await writeProject();
    const r = await researchAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: {
        assertion_id: "a_001",
        person_id: "I1",
        confidence: "probable",
        rationale: "name + age match",
        superseded_by: null,
      },
    } as any);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(single(r).entryId).toBe("pe_001");
  });

  it("carries an assertion correction onto the linked tree fact (#2472)", async () => {
    // The rewrite lives in the shared research-append module, so it fires for
    // BOTH entry points. Of the assertion-`update` ops touching a mirrored
    // attribute in the committed e2e corpus, 60 arrive through
    // `extraction_append` and 85 through `research_append` (2026-09-14).
    const research = baseResearch();
    research.assertions = [
      {
        ...validAssertion("a_011"),
        fact_type: "immigration",
        place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
        standard_place: "Thames Centre Township, Middlesex, Ontario, Canada",
      } as unknown as ReturnType<typeof validAssertion>,
    ];
    const tree = {
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "John", surname: "Smith" }],
          facts: [
            {
              id: "F4",
              type: "Immigration",
              place: "Wellburn, Thames Centre, Middlesex, Ontario, Canada",
              standard_place: "Thames Centre Township, Middlesex, Ontario, Canada",
              assertion_id: "a_011",
              sources: [{ ref: "SD-001" }],
            },
          ],
        },
      ],
      relationships: [],
      sources: [{ id: "SD-001", title: "1850 U.S. Census" }],
    };
    await writeProject(research, tree);

    const r = await extractionAppend({
      projectPath: dir,
      section: "assertions",
      op: "update",
      entryId: "a_011",
      fields: {
        place: "Odessa, Francis No. 127, Saskatchewan, Canada",
        standard_place: "Odessa, Francis No. 127, Saskatchewan, Canada",
      },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toContain("tree.gedcomx.json");
    const f4 = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"))
      .persons[0].facts[0];
    expect(f4.place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
    expect(f4.standard_place).toBe("Odessa, Francis No. 127, Saskatchewan, Canada");
  });
});

// ─── The P1 debug holds ────────────────────────────────────────────────────
//
// GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS / _AFTER_COMMIT_MS are the only two
// environment variables the engine reads (CLAUDE.md: config-only, never
// process.env), and they ship in the .mcpb. They exist so the P1 resume probe
// (apps/server/dev/p1/) can kill a worker between an extraction_append's
// validate and its commit. This pins the claim that makes shipping them
// acceptable — inert unless set, and only on extraction_append — and that a
// set value actually waits, so the seam cannot rot silently either way.
describe("extraction_append debug holds", () => {
  const BEFORE = "GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS";
  const AFTER = "GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS";
  const saved: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(async () => {
    saved[BEFORE] = process.env[BEFORE];
    saved[AFTER] = process.env[AFTER];
    dir = await mkdtemp(join(tmpdir(), "extraction-append-hold-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(baseResearch(), null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(baseTree, null, 2));
  });
  afterEach(async () => {
    for (const k of [BEFORE, AFTER]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  const appendSource = (fn: typeof extractionAppend | typeof researchAppend) =>
    fn({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("src_002")) } as any);

  it("are inert when unset, zero, or garbage", async () => {
    delete process.env[BEFORE];
    process.env[AFTER] = "0";
    let t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);

    process.env[BEFORE] = "not-a-number";
    process.env[AFTER] = "";
    t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("hold only extraction_append, never research_append", async () => {
    process.env[BEFORE] = "1500";
    process.env[AFTER] = "1500";
    const t0 = Date.now();
    expect((await appendSource(researchAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a set value actually holds an extraction_append, on both sides of the commit", async () => {
    process.env[BEFORE] = "300";
    process.env[AFTER] = "300";
    const t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(600);
  });
});
