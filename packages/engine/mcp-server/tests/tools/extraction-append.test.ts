import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LOCAL } from "../../src/auth/principal.js";
import { single } from "../helpers/narrow.js";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "fs/promises";
import { readFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { join } from "path";
import { tmpdir } from "os";

// Same offline place-resolver stub the research_append suite uses. It doubles as
// the probe for "did the lane gate run before the network pre-pass?" — a rejected
// call must leave this mock untouched.
// Spreads the real module rather than replacing it: `countryConsistency` lives
// there too and research_append imports it, so a bare replacement leaves it
// `undefined` and any path that reaches it throws a TypeError instead of
// exercising the guard.
// A pass-through wrapper, so one test can force `research_append` to refuse ONE
// record's write and show the others survive. Every other call is untouched.
const failWriteFor = { recordId: null as string | null };
vi.mock("../../src/tools/research-append.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/research-append.js")>();
  return {
    ...actual,
    researchAppend: vi.fn(async (input: any, options?: any) => {
      const target = failWriteFor.recordId;
      if (target && (input?.ops ?? []).some((o: any) => o?.entry?.record_id === target)) {
        return { ok: false, errors: [`forced refusal for ${target}`] };
      }
      return actual.researchAppend(input, options);
    }),
  };
});

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
import { recordMatchScore } from "../../src/utils/match-scores.js";
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
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
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.filter((e) => /already extracted on src_001 under log_001/.test(e))).toHaveLength(12);
    expect(r.errors.join(" ")).toMatch(/a_001 already records name .*`update` op/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ─── research_append is untouched ─────────────────────────────────────────

  it("research_append still accepts person_evidence (the lane is per-tool, not global)", async () => {
    await writeProject();
    // #1731 step 3 refuses a link with no recorded same_person score. This test
    // is about the per-tool lane, not the score gate, so satisfy it.
    await recordMatchScore(dir, {
      record_id: "rec1",
      record_persona_id: null,
      record_role: "principal",
      tree_person_id: "I1",
      score: 0.9,
      matched: true,
      assertion_id: "a_001",
      record_source: "record_read",
      computed: "2026-09-24T00:00:00Z",
    });
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
    }, LOCAL);

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

  const appendSource = (fn: typeof extractionAppend | typeof researchAppend) => {
    const input = { projectPath: dir, section: "sources", op: "append", entry: noId(validSource("src_002")) } as any;
    return fn === extractionAppend ? extractionAppend(input, LOCAL) : researchAppend(input);
  };

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

// ─── EXTRACTOR MODE (issue #2937) ───────────────────────────────────────────
//
// The dispatch, not the pure function — `tests/utils/record-extract.test.ts`
// covers the rule itself. What is exercised here is mode entry, the
// both-arguments refusal, the sidecar resolution, and what the mode gives back.
//
// Driven by a REAL captured `record_read` sidecar (an 1870 US census household),
// staged into a temp project exactly as `record_read` + `research_log_append`
// would leave it, so the join this mode depends on is the real one.

describe("extraction_append — extractor mode", () => {
  let dir: string;

  const CENSUS_1870 = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "fixtures",
        "record-extract",
        "census-1870-no-relationship-column.json",
      ),
      "utf8",
    ),
  ).element;

  /** A project whose log entry l_001 points at a finalized sidecar holding the
   *  captured record — the state a live `record_read` + `research_log_append`
   *  leaves behind. */
  async function seedProject(element: unknown = CENSUS_1870) {
    const research = {
      project: {
        id: "rp_001",
        objective: "extractor mode",
        status: "active",
        created: "2026-01-01",
        updated: "2026-01-01",
      },
      questions: [],
      plans: [],
      log: [
        {
          id: "l_001",
          tool: "record_read",
          query: { recordId: "MZGS-1BH" },
          outcome: "positive",
          performed: "2026-01-01T00:00:00.000Z",
          results_available: 1,
          results_examined: 1,
          results_ref: "results/l_001.json",
          repository: "FamilySearch",
        },
      ],
      sources: [],
      assertions: [],
      person_evidence: [],
      conflicts: [],
      hypotheses: [],
      timelines: [],
      proof_summaries: [],
      evaluations: [],
    };
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      // SD-001 exists so the ops-form control below can cite it; extractor mode
      // creates its own S entry and does not use it.
      JSON.stringify(
        { persons: [], relationships: [], sources: [{ id: "SD-001", title: "Test source" }] },
        null,
        2,
      ),
    );
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "l_001.json"),
      JSON.stringify(
        {
          log_id: "l_001",
          tool: "record_read",
          retrieved: "2026-01-01T00:00:00.000Z",
          returned_count: 1,
          payload: { query: { recordId: "MZGS-1BH" }, results: [element] },
        },
        null,
        2,
      ),
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extractor-mode-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts a real record end to end and reports what it wrote", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      questionIds: ["q_001"],
    } as any, LOCAL);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);

    // The echo — the caller never sees the record, so this is what it reports.
    expect(r.extraction.recordType).toBe("census");
    expect(r.extraction.censusStatesRelationships).toBe(false);
    expect(r.extraction.assertionCount).toBeGreaterThan(20);
    expect(r.extraction.roles).toContain("head_of_household");
    expect(r.extraction.roles).toContain("wife");

    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(research.sources).toHaveLength(1);
    expect(research.assertions.length).toBe(r.extraction.assertionCount);
    // `derivative`, always: what was read is the INDEX, not the schedule.
    expect(research.sources[0].source_classification).toBe("derivative");
    expect(research.sources[0].log_entry_id).toBe("l_001");
    // Every assertion cites the created source and the log entry.
    for (const a of research.assertions) {
      expect(a.source_id).toBe(research.sources[0].id);
      expect(a.log_entry_id).toBe("l_001");
      expect(a.extracted_for_question_ids).toEqual(["q_001"]);
    }
  });

  it("dates the source by the RECORD's event, not by the first fact found", async () => {
    // `citation_detail.when_created` is the year the record was made. A
    // first-dated-fact scan is wrong on essentially every record, because
    // `Birth` sorts early and rides along on all of them: before this was keyed
    // on the record's own event type it dated a 1910 marriage to 1889, an 1870
    // census to 1845 and an 1879 death to 1854 — each the subject's birth year,
    // written into a required citation field as the year of creation.
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
    } as any, LOCAL);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    // The record is an 1870 census whose personas carry births from 1791 on.
    expect(research.sources[0].citation_detail.when_created).toBe("1870");
  });

  it("resolves a persona PER assertion from the record_read sidecar", async () => {
    // The auto-fill bug this replaces stamped the searched persona's id onto
    // assertions about someone else, 16 times in the e2e corpus. A record_read
    // sidecar could not resolve a persona at all before `record_read` joined
    // PERSONA_BEARING_PRODUCERS.
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      questionIds: [],
    } as any, LOCAL);
    expect(r.ok).toBe(true);
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    const personas = new Set(research.assertions.map((a: any) => a.record_persona_id));
    const known = new Set((CENSUS_1870.gedcomx.persons ?? []).map((p: any) => p.id));
    expect(personas.size).toBeGreaterThan(1);
    for (const p of personas) expect(known.has(p)).toBe(true);
  });

  it("writes the caller's absent persons as negative evidence", async () => {
    // The extractor never mints an absence — a claim about who is MISSING
    // cannot be read off a document.
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      questionIds: [],
      absentPersons: [{ name: "Peter Boyer", note: "Peter Boyer is not in this household" }],
    } as any, LOCAL);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    const absent = research.assertions.filter((a: any) => a.record_role === "absent");
    expect(absent).toHaveLength(1);
    expect(absent[0].record_basis).toBe("absent");
    expect(absent[0].informant_proximity).toBe("researcher");
    expect(absent[0].value).toContain("Peter Boyer");
    // And the extractor produced none of its own.
    expect(
      research.assertions.filter((a: any) => a.record_role === "absent" && !/Peter/.test(a.value)),
    ).toHaveLength(0);
  });

  // ── the both-arguments guard, broken and then shown to accept each shape ──

  it("refuses logEntryId AND ops together, naming both", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      ops: [{ section: "sources", op: "append", entry: noId(validSource("x")) }],
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/logEntryId/);
    expect(r.errors[0]).toMatch(/ops/);
  });

  it("refuses them together even when `ops` is empty", async () => {
    // `[]` is present-but-empty: a shape that reads as "no ops" and would slip
    // past a truthiness test.
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      ops: [],
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/logEntryId/);
  });

  it("writes NOTHING when it refuses them together", async () => {
    await seedProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
      ops: [{ section: "sources", op: "append", entry: noId(validSource("x")) }],
    } as any, LOCAL);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  // ── the other direction: each shape ALONE still works ──

  it("still accepts the ops form with no logEntryId", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      section: "sources",
      op: "append",
      entry: noId(validSource("x")),
    } as any, LOCAL);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  });

  it("still enforces the lane in extractor mode", async () => {
    // Mode entry must not become a way around the section gate.
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: "a_001", person_id: "I1", confidence: "confident" },
    } as any, LOCAL);
    expect(r.ok).toBe(false);
  });

  // ── the failure paths, each naming its own fix ──

  it("refuses a log entry that does not exist", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_999",
      recordId: "MZGS-1BH",
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/l_999/);
    expect(r.errors[0]).toMatch(/research_log_append/);
  });

  it("refuses a log entry with no sidecar, and says to re-read LIVE", async () => {
    // The trap this card exists around: `record_read` with `resultsRef` stages
    // nothing, so the entry has no `results_ref` and the message has to name
    // the live call rather than just the missing field.
    await seedProject();
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    research.log[0].results_ref = null;
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/resultsRef/);
    expect(r.errors[0]).toMatch(/omitted/i);
  });

  it("refuses a record the sidecar does not hold, listing what it does", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "NOT-A-RECORD",
    } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/NOT-A-RECORD/);
    expect(r.errors[0]).toMatch(/expected one of/);
  });

  it("warns when a multi-person record carries no index fields", async () => {
    // The shape of a `record_search` sidecar. Not refused — a record type may
    // legitimately carry none — but roles would be assigned from names and ages
    // with nothing to say so, which is the silent failure worth a line.
    const { indexFields: _dropped, ...withoutFields } = CENSUS_1870;
    await seedProject(withoutFields);
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
    } as any, LOCAL);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const warning = r.validation.warnings.find((w: string) => /NO\s+per-person index fields/.test(w));
    expect(warning, "expected the missing-index-fields warning").toBeTruthy();
    expect(warning).toMatch(/record_search/);
  });

  it("stays silent about index fields when they are present", async () => {
    await seedProject();
    const r: any = await extractionAppend({
      projectPath: dir,
      logEntryId: "l_001",
      recordId: "MZGS-1BH",
    } as any, LOCAL);
    expect(r.ok).toBe(true);
    expect(
      r.validation.warnings.some((w: string) => /per-person index fields/.test(w)),
    ).toBe(false);
  });
});

// ─── recordIds and absences (issues #2937 / #2939, PLAN acceptance checks 1–2) ──

import { runExtractionAppend } from "../../src/tools/extraction-append.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { arkToBareId } from "../../src/utils/ark.js";

describe("extraction_append: recordIds and absences", () => {
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
  const element = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).element;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-batch-test-"));
    const research = { ...baseResearch(), sources: [], assertions: [] };
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A reader that stages a captured element exactly as a live `record_read`
   *  would, so `research_log_append`'s stagedResultsRef preflight has a file. */
  const readerFor = (els: any[], opts: { unstaged?: string[] } = {}) => ({
    readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
      const el = els.find((e) => arkToBareId(e.recordId) === arkToBareId(recordId));
      if (!el) throw new Error(`404 for ${recordId}`);
      if (opts.unstaged?.includes(el.recordId)) return { ...el.gedcomx, staged: null, stagingError: "disk full" };
      const staged = await stageSearchResults({
        projectPath: projectPath!,
        tool: "record_read",
        response: { query: { recordId }, results: [el] },
      });
      return { ...el.gedcomx, staged };
    },
  });
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));

  it("writes one log entry, source and summary per record", async () => {
    const census = element("census-1850-no-relationship-column");
    const death = element("death");
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [census.recordId, death.recordId] },
      readerFor([census, death]) as any,
      LOCAL,
    );
    expect(r.ok).toBe(true);
    expect(r.records.map((o) => o.status)).toEqual(["extracted", "extracted"]);
    const after = await research();
    expect(after.log).toHaveLength(2);
    expect(after.log.every((e: any) => e.tool === "record_read" && e.results_ref)).toBe(true);
    expect(after.sources).toHaveLength(2);
    expect(r.records[0].summary).toMatch(/United States, Census, 1850/);
    expect(r.records[0].summary).toMatch(/Martin Miller \(head_of_household\)/);
    expect(r.records[1].summary).toMatch(/William Miller \(deceased\)/);
  });

  it("skips a resend BEFORE any read or log write, and names the existing source", async () => {
    const census = element("census-1850-no-relationship-column");
    await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, readerFor([census]) as any, LOCAL);
    const before = await research();
    const reads: string[] = [];
    const counting = {
      readRecord: async (i: any, p: any) => {
        reads.push(i.recordId);
        return readerFor([census]).readRecord(i);
      },
    };
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, counting as any, LOCAL);
    expect(r.records[0].status).toBe("already_extracted");
    expect(r.records[0].summary).toMatch(/already extracted as src_/);
    expect(reads).toEqual([]);
    expect(await research()).toEqual(before);
  });

  it("reports an unstaged read and still extracts the other records", async () => {
    const census = element("census-1850-no-relationship-column");
    const death = element("death");
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [census.recordId, death.recordId] },
      readerFor([census, death], { unstaged: [death.recordId] }) as any,
      LOCAL,
    );
    expect(r.records.map((o) => o.status)).toEqual(["extracted", "read_failed"]);
    expect(r.records[1].summary).toMatch(/disk full/);
    expect((await research()).log).toHaveLength(1);
  });

  it("leaves the earlier record written when a later one's write is refused", async () => {
    const census = element("census-1850-no-relationship-column");
    const death = element("death");
    failWriteFor.recordId = death.recordId;
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [census.recordId, death.recordId] },
      readerFor([census, death]) as any,
      LOCAL,
    ).finally(() => {
      failWriteFor.recordId = null;
    });
    expect(r.records[0].status).toBe("extracted");
    expect(r.records[1].status).toBe("refused");
    expect((await research()).sources).toHaveLength(1);
  });

  it("refuses two call shapes together, naming both", async () => {
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: ["X"], absences: [] } as any,
      readerFor([]) as any,
      LOCAL,
    );
    expect(r.ok).toBe(false);
    expect((r as any).errors[0]).toMatch(/`recordIds` and `absences`/);
  });

  describe("absences", () => {
    const logNil = async () => {
      const res = await research();
      res.log.push({
        id: "log_001",
        performed: "2026-09-30T00:00:00.000Z",
        tool: "record_search",
        query: { surname: "Flynn" },
        outcome: "negative",
        results_examined: 0,
        results_ref: null,
      });
      await writeFile(join(dir, "research.json"), JSON.stringify(res), "utf8");
    };

    it("writes the collection as a source and one fixed-classification negative per person", async () => {
      await logNil();
      const r = await runExtractionAppend(
        {
          projectPath: dir,
          absences: [
            { collection: "United States Census, 1870", place: "Schuylkill, Pennsylvania", name: "Patrick Flynn", logEntryId: "log_001" },
            { collection: "United States Census, 1870", place: "Schuylkill, Pennsylvania", name: "Bridget Flynn", logEntryId: "log_001" },
          ],
        },
        readerFor([]) as any,
        LOCAL,
      );
      expect(r.ok).toBe(true);
      const after = await research();
      expect(after.sources).toHaveLength(1);
      expect(after.log).toHaveLength(1);
      const neg = after.assertions;
      expect(neg).toHaveLength(2);
      for (const a of neg) {
        expect(a.record_role).toBe("absent");
        expect(a.record_basis).toBe("absent");
        expect(a.informant_proximity).toBe("researcher");
        expect(a.information_quality).toBe("indeterminate");
      }
      expect(neg.map((a: any) => a.value).join(" ")).toMatch(/Patrick Flynn.*Bridget Flynn/);
    });

    it("refuses an absence whose log entry does not exist", async () => {
      const r = await runExtractionAppend(
        { projectPath: dir, absences: [{ collection: "US Census, 1870", name: "Patrick Flynn", logEntryId: "log_404" }] },
        readerFor([]) as any,
        LOCAL,
      );
      expect(r.ok).toBe(false);
      expect(r.errors?.[0]).toMatch(/log_404 not found/);
      expect((await research()).assertions).toEqual([]);
    });
  });
});
