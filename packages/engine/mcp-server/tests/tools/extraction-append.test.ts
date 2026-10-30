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

import { extractionAppend, EXTRACTION_SECTIONS, PLAN_COMPLETION_SECTIONS } from "../../src/tools/extraction-append.js";
import { recordMatchScore } from "../../src/utils/match-scores.js";
import { researchAppend } from "../../src/tools/research-append.js";
import { resolveStandardPlace } from "../../src/utils/place-resolver.js";

const EXTRACTION_LANE = { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" } as any;

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

/** A project whose log holds one nil search, l_001, for an `absences` call. */
function withNilSearch() {
  return {
    ...baseResearch(),
    log: [
      {
        id: "l_001",
        tool: "record_search",
        query: { surname: "Boyer" },
        outcome: "negative",
        performed: "2026-01-01T00:00:00.000Z",
        results_available: 0,
        results_examined: 0,
        results_ref: null,
        repository: "FamilySearch",
      },
    ],
  };
}

describe("extraction_append: only the three call shapes", () => {
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

  it("chooses its lane per call: {sources, assertions} to extract and tie, {plan_items} to complete", () => {
    expect([...EXTRACTION_SECTIONS].sort()).toEqual(["assertions", "sources"]);
    expect([...PLAN_COMPLETION_SECTIONS]).toEqual(["plan_items"]);
  });

  // Every form a caller composed its own entries in, and the one-record mode.
  const RETIRED: [string, Record<string, unknown>][] = [
    ["a single op", { section: "sources", op: "append", entry: noId(validSource("x")) }],
    ["a single op on a section outside the lane", { section: "person_evidence", op: "append", entry: {} }],
    ["an assertion correction", { section: "assertions", op: "update", entryId: "a_001", fields: { value: "1851" } }],
    [
      "an ops batch",
      {
        ops: [
          {
            section: "assertions",
            op: "append",
            entry: { ...noId(validAssertion("x")), place: "Schuylkill County, Pennsylvania" },
          },
        ],
      },
    ],
    ["the one-record extractor mode", { logEntryId: "l_001", recordId: "MZGS-1BH" }],
    ["a retired form beside a current one", { recordIds: ["MZGS-1BH"], ops: [] }],
  ];

  it.each(RETIRED)("refuses %s, writing nothing and resolving no place", async (_label, form) => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await callTool("extraction_append", { projectPath: dir, ...form });
    expect(r.isError).toBe(true);
    const text = r.text;
    expect(text).toMatch(/no longer takes/);
    expect(text).toMatch(/`recordIds`.*`documents`.*`absences`/);
    // A caller holding only this writer is not pointed at one it lacks.
    expect(text).not.toContain("research_append");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });

  it("still refuses a retired form called directly, as the unit harness calls it", async () => {
    await writeProject();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await extractionAppend({ projectPath: dir, recordIds: ["MZGS-1BH"], ops: [] } as any, LOCAL);
    expect(r.ok).toBe(false);
    expect((r.errors ?? []).join(" ")).toMatch(/no longer takes `ops`/);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("refuses no call shape at all, and two current shapes together, naming them", async () => {
    await writeProject(withNilSearch());
    const none = await extractionAppend({ projectPath: dir } as any, LOCAL);
    expect(none.ok).toBe(false);
    expect((none.errors ?? []).join(" ")).toMatch(/received none of/);
    const two = await extractionAppend({
      projectPath: dir,
      recordIds: ["MZGS-1BH"],
      absences: [{ collection: "United States Census, 1870", name: "Peter Boyer", logEntryId: "l_001" }],
    } as any, LOCAL);
    expect(two.ok).toBe(false);
    expect((two.errors ?? []).join(" ")).toMatch(/`recordIds` and `absences` together/);
  });

  // ─── §3.4.1 updates-only batch (issue #3159) ──────────────────────────────
  // `extraction_append` no longer takes `ops`, but the composite persist it calls
  // does, so the fix is pinned where it lives: `researchAppend` under the lane
  // `extraction_append` passes it. ──────────────────────────────

  it("folds a sources append when the batch carries only assertion updates on an extracted record (#3159)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), fact_type: "name", value: "John Smith" },
      { ...validAssertion("a_002"), fact_type: "birth", value: "1850" },
      { ...validAssertion("a_003"), fact_type: "death", value: "1920" },
    ] as any;
    await writeProject(research);
    const { gedcomx_source_description_id: _g, ...sourceNoRef } = noId(validSource("x"));
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Census" },
      ops: [
        { section: "sources", op: "append", entry: sourceNoRef },
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "John H. Smith" } },
        { section: "assertions", op: "update", entryId: "a_002", fields: { value: "about 1850" } },
        { section: "assertions", op: "update", entryId: "a_003", fields: { value: "about 1920" } },
      ],
    } as any, EXTRACTION_LANE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceReuse).toEqual(
      expect.objectContaining({ action: "updated_existing", srcId: "src_001", sId: "SD-001" }),
    );
    expect(r).not.toHaveProperty("sourceDescriptionId");
    const after = await readResearch();
    expect(after.sources).toHaveLength(1);
    const treeAfter = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    expect(treeAfter.sources).toHaveLength(1);
  });

  it("a mixed batch (appends + updates) drives detection from appends only, not updates (#3159)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), fact_type: "name", value: "John Smith" },
    ] as any;
    await writeProject(research);
    const { gedcomx_source_description_id: _g, ...sourceNoRef } = noId(validSource("x"));
    const { source_id: _s, ...assertionNoSrc } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "Marriage Record" },
      ops: [
        { section: "sources", op: "append", entry: { ...sourceNoRef, repository: "OTHER_REPO" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...assertionNoSrc, record_id: "rec2", fact_type: "marriage", value: "1875" },
        },
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "John H. Smith" } },
      ],
    } as any, EXTRACTION_LANE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Appends drive detection: rec2 has no existing source → "created"
    expect(r.sourceReuse).toEqual(
      expect.objectContaining({ action: "created", srcId: "src_002" }),
    );
    const after = await readResearch();
    expect(after.sources).toHaveLength(2);
    // The newly appended assertion cites the new source
    const newAssertion = after.assertions.find((a: any) => a.record_id === "rec2");
    expect(newAssertion).toBeDefined();
    expect(newAssertion.source_id).toBe("src_002");
  });

  it("an update op that sets source_id bypasses updates-only detection (#3159)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), fact_type: "name", value: "John Smith" },
    ] as any;
    await writeProject(research);
    const { gedcomx_source_description_id: _g, ...sourceNoRef } = noId(validSource("x"));
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "1850 U.S. Census" },
      ops: [
        { section: "sources", op: "append", entry: sourceNoRef },
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "John H. Smith", source_id: "src_002" } },
      ],
    } as any, EXTRACTION_LANE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Detection did not engage (the only update sets source_id), so no sourceReuse echo
    expect(r.sourceReuse).toBeUndefined();
    const after = await readResearch();
    expect(after.sources).toHaveLength(2);
    expect(after.sources[1].id).toBe("src_002");
  });

  it("a blank-record_id append does not fall through to updates-only detection (#3159)", async () => {
    const research = baseResearch();
    research.assertions = [
      { ...validAssertion("a_001"), fact_type: "name", value: "John Smith" },
    ] as any;
    await writeProject(research);
    const { gedcomx_source_description_id: _g, ...sourceNoRef } = noId(validSource("x"));
    const { source_id: _s, ...assertionNoSrc } = noId(validAssertion("x"));
    const r = await researchAppend({
      projectPath: dir,
      sourceDescription: { title: "Flynn family Bible" },
      ops: [
        { section: "sources", op: "append", entry: { ...sourceNoRef, citation: "Flynn family Bible" } },
        {
          section: "assertions",
          op: "append",
          entry: { ...assertionNoSrc, record_id: "", fact_type: "marriage", value: "1875" },
        },
        { section: "assertions", op: "update", entryId: "a_001", fields: { value: "John H. Smith" } },
      ],
    } as any, EXTRACTION_LANE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The batch has an assertion append (even though its record_id is blank),
    // so updates-only detection must NOT engage. A new source is created.
    const after = await readResearch();
    expect(after.sources).toHaveLength(2);
    expect(after.sources[1].id).toBe("src_002");
    // The marriage assertion cites the new source, not the census one
    const marriage = after.assertions.find((a: any) => a.fact_type === "marriage");
    expect(marriage).toBeDefined();
    expect(marriage.source_id).toBe("src_002");
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
    await writeFile(join(dir, "research.json"), JSON.stringify(withNilSearch(), null, 2));
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
    fn === extractionAppend
      ? extractionAppend(
          { projectPath: dir, absences: [{ collection: "United States Census, 1870", name: "Peter Boyer", logEntryId: "l_001" }] },
          LOCAL,
        )
      : researchAppend({ projectPath: dir, section: "sources", op: "append", entry: noId(validSource("src_002")) } as any);

  it("are inert when unset, zero, or garbage", async () => {
    delete process.env[BEFORE];
    process.env[AFTER] = "0";
    let t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    // No hold is set, so the bound only guards against a hang; wide for load lag.
    expect(Date.now() - t0).toBeLessThan(8_000);

    process.env[BEFORE] = "not-a-number";
    process.env[AFTER] = "";
    t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(8_000);
  });

  it("hold only extraction_append, never research_append", async () => {
    process.env[BEFORE] = "10000";
    process.env[AFTER] = "10000";
    const t0 = Date.now();
    expect((await appendSource(researchAppend)).ok).toBe(true);
    // The bound is what tells "no hold" apart from a held call, so it must stay
    // under the hold value; 8 s rides out load lag while a held call takes 20 s.
    expect(Date.now() - t0).toBeLessThan(8_000);
  });

  it("a set value actually holds an extraction_append, on both sides of the commit", async () => {
    process.env[BEFORE] = "300";
    process.env[AFTER] = "300";
    const t0 = Date.now();
    expect((await appendSource(extractionAppend)).ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(600);
  });
});

// ─── recordIds, driven by a REAL captured `record_read` (issue #2937) ────────
//
// The dispatch, not the pure function — `tests/utils/record-extract.test.ts`
// covers the rules. An 1870 US census household, staged by the injected reader
// exactly as a live `record_read` stages it.

describe("extraction_append: recordIds on a captured census", () => {
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

  const reader = {
    readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
      const staged = await stageSearchResults({
        projectPath: projectPath!,
        tool: "record_read",
        response: { query: { recordId }, results: [CENSUS_1870] },
      });
      return { ...CENSUS_1870.gedcomx, staged };
    },
  } as any;

  const extract = (extra: Record<string, unknown> = {}) =>
    runExtractionAppend({ projectPath: dir, recordIds: ["MZGS-1BH"], ...extra } as any, reader, LOCAL);
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-census-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ ...baseResearch(), sources: [], assertions: [] }, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts a real record end to end and summarizes what it wrote", async () => {
    const r = await extract({ questionIds: ["q_001"] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [o] = r.records;
    expect(o.status).toBe("extracted");
    // The summary is what the caller relays, since it never sees the record.
    expect(o.summary).toMatch(/head_of_household/);
    expect(o.summary).toMatch(/wife/);

    const after = await research();
    expect(after.sources).toHaveLength(1);
    expect(after.assertions.length).toBeGreaterThan(20);
    // `derivative`, always: what was read is the INDEX, not the schedule.
    expect(after.sources[0].source_classification).toBe("derivative");
    expect(after.sources[0].id).toBe(o.srcId);
    for (const a of after.assertions) {
      expect(a.source_id).toBe(after.sources[0].id);
      expect(a.log_entry_id).toBe(o.logId);
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
    const r = await extract();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // The record is an 1870 census whose personas carry births from 1791 on.
    expect((await research()).sources[0].citation_detail.when_created).toBe("1870");
  });

  it("resolves a persona PER assertion from the record_read sidecar", async () => {
    // The auto-fill bug this replaces stamped the searched persona's id onto
    // assertions about someone else, 16 times in the e2e corpus.
    const r = await extract();
    expect(r.ok).toBe(true);
    const personas = new Set((await research()).assertions.map((a: any) => a.record_persona_id));
    const known = new Set((CENSUS_1870.gedcomx.persons ?? []).map((p: any) => p.id));
    expect(personas.size).toBeGreaterThan(1);
    for (const p of personas) expect(known.has(p)).toBe(true);
  });

  it("writes the caller's absent persons as negative evidence, on their record only", async () => {
    // The extractor never mints an absence — a claim about who is MISSING
    // cannot be read off a document.
    const r = await extract({
      absentPersons: [
        { recordId: "MZGS-1BH", name: "Peter Boyer", note: "Peter Boyer is not in this household" },
        { recordId: "OTHER-ID", name: "Anna Boyer" },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const absent = (await research()).assertions.filter((a: any) => a.record_role === "absent");
    expect(absent).toHaveLength(1);
    expect(absent[0].record_basis).toBe("absent");
    expect(absent[0].informant_proximity).toBe("researcher");
    expect(absent[0].value).toContain("Peter Boyer");
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

  // ─── an accepted hint's log entry is the record's own (issue #3157) ───────────

  const hintEntry = (id: string, recordId: string, outcome = "positive") => ({
    id,
    plan_item_id: null,
    performed: "2026-01-01T00:00:00Z",
    tool: "person_record_matches",
    query: { id: "LZNY-BRF", recordId },
    outcome,
    results_examined: 1,
    external_site: null,
    results_ref: null,
  });
  const seedLog = async (log: any[]) => {
    const r = await research();
    await writeFile(join(dir, "research.json"), JSON.stringify({ ...r, log }), "utf8");
  };

  it("cites an accepted hint's log entry and writes no second record_read entry", async () => {
    const census = element("census-1850-no-relationship-column");
    await seedLog([hintEntry("log_001", census.recordId)]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, readerFor([census]) as any, LOCAL);
    expect(r.ok).toBe(true);
    expect(r.records[0].status).toBe("extracted");
    expect(r.records[0].logId).toBe("log_001");
    const after = await research();
    expect(after.log.map((e: any) => e.id)).toEqual(["log_001"]);
    expect(after.assertions.length).toBeGreaterThan(0);
    expect(after.assertions.every((a: any) => a.log_entry_id === "log_001")).toBe(true);
    expect(after.sources[0].log_entry_id).toBe("log_001");
  });

  it("gives a hint record's assertions the persona ids of the record read in the same call", async () => {
    const census = element("census-1850-no-relationship-column");
    await seedLog([hintEntry("log_001", census.recordId)]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, readerFor([census]) as any, LOCAL);
    expect(r.records[0].status).toBe("extracted");
    const personaIds = new Set(census.gedcomx.persons.map((p: any) => p.id));
    const parties = (await research()).assertions.filter((a: any) => a.record_role !== "absent");
    expect(parties.length).toBeGreaterThan(0);
    for (const a of parties) expect(personaIds.has(a.record_persona_id)).toBe(true);
  });

  it.each([
    ["a rejected hint", (rid: string) => hintEntry("log_001", rid, "negative")],
    ["a hint for another record", () => hintEntry("log_001", "ark:/61903/1:1:ZZZZ-ZZZ")],
  ])("still logs its own read beside %s", async (_name, make) => {
    const census = element("census-1850-no-relationship-column");
    await seedLog([make(census.recordId)]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, readerFor([census]) as any, LOCAL);
    expect(r.records[0].status).toBe("extracted");
    const after = await research();
    expect(after.log.map((e: any) => e.tool)).toEqual(["person_record_matches", "record_read"]);
    expect(after.assertions.every((a: any) => a.log_entry_id === "log_002")).toBe(true);
  });

  it("does not reuse a hint a later verdict rejected", async () => {
    const census = element("census-1850-no-relationship-column");
    await seedLog([hintEntry("log_001", census.recordId), hintEntry("log_002", census.recordId, "negative")]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [census.recordId] }, readerFor([census]) as any, LOCAL);
    expect(r.records[0].logId).toBe("log_003");
    const after = await research();
    expect(after.log.map((e: any) => e.tool)).toEqual(["person_record_matches", "person_record_matches", "record_read"]);
  });

  it("still writes the hint record when the log batch for the others is refused", async () => {
    const census = element("census-1850-no-relationship-column");
    const death = element("death");
    await seedLog([hintEntry("log_001", death.recordId)]);
    const reader = readerFor([census, death]);
    const badRef = {
      readRecord: async (i: any, p: any) =>
        arkToBareId(i.recordId) === arkToBareId(census.recordId)
          ? { ...census.gedcomx, staged: { resultsRef: "results/.staging/missing.json" } }
          : reader.readRecord(i),
    };
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [census.recordId, death.recordId] },
      badRef as any,
      LOCAL,
    );
    expect(r.records.map((o) => o.status)).toEqual(["refused", "extracted"]);
    expect(r.records[1].srcId).toMatch(/^src_/);
    const after = await research();
    expect(after.log.map((e: any) => e.id)).toEqual(["log_001"]);
    expect(after.sources).toHaveLength(1);
    expect(after.assertions.every((a: any) => a.log_entry_id === "log_001")).toBe(true);
  });

  it("logs one entry for the record with no hint and reuses the hint for the one with", async () => {
    const census = element("census-1850-no-relationship-column");
    const death = element("death");
    await seedLog([hintEntry("log_001", death.recordId)]);
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [census.recordId, death.recordId] },
      readerFor([census, death]) as any,
      LOCAL,
    );
    expect(r.records.map((o) => o.status)).toEqual(["extracted", "extracted"]);
    const after = await research();
    expect(after.log.map((e: any) => e.tool)).toEqual(["person_record_matches", "record_read"]);
    expect(r.records.map((o) => o.logId)).toEqual(["log_002", "log_001"]);
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

  // ─── one household, one source (issue #3543) ─────────────────────────────────

  /** Two members of one census household: the same record, read through each
   *  member's own persona ARK, as record_search returns them. */
  const household = () => {
    const a = element("census-1850-no-relationship-column");
    const memberArk = a.gedcomx.persons.map((p: any) => p.ark).find((k: string) => arkToBareId(k) !== arkToBareId(a.recordId));
    return { a, b: { ...a, recordId: arkToBareId(memberArk) } };
  };

  it("skips a household member of a record already extracted, before logging", async () => {
    const { a, b } = household();
    await runExtractionAppend({ projectPath: dir, recordIds: [a.recordId] }, readerFor([a]) as any, LOCAL);
    const before = await research();
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [b.recordId] }, readerFor([b]) as any, LOCAL);
    expect(r.ok).toBe(true);
    expect(r.records[0].status).toBe("already_extracted");
    expect(r.records[0].srcId).toBe(before.sources[0].id);
    expect(r.records[0].summary).toMatch(/already extracted as src_\d+/);
    expect(await research()).toEqual(before);
  });

  it("skips a member of a household extracted under a hint, which left no sidecar to widen by", async () => {
    const { a, b } = household();
    await seedLog([hintEntry("log_001", a.recordId)]);
    await runExtractionAppend({ projectPath: dir, recordIds: [a.recordId] }, readerFor([a]) as any, LOCAL);
    const before = await research();
    expect(before.log.map((e: any) => e.tool)).toEqual(["person_record_matches"]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [b.recordId] }, readerFor([b]) as any, LOCAL);
    expect(r.records[0].status).toBe("already_extracted");
    expect(r.records[0].summary).toMatch(/already extracted as src_\d+ \(same household\)/);
    expect(await research()).toEqual(before);
  });

  it("writes one source when two household members arrive in one call", async () => {
    const { a, b } = household();
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [a.recordId, b.recordId] }, readerFor([a, b]) as any, LOCAL);
    expect(r.records.map((o) => o.status)).toEqual(["extracted", "already_extracted"]);
    expect(r.records[1].srcId).toBe(r.records[0].srcId);
    const after = await research();
    expect(after.sources).toHaveLength(1);
    expect(after.log).toHaveLength(1);
  });

  it("refuses the household duplicate when the first member's write is refused", async () => {
    const { a, b } = household();
    failWriteFor.recordId = a.recordId;
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [a.recordId, b.recordId] },
      readerFor([a, b]) as any,
      LOCAL,
    ).finally(() => {
      failWriteFor.recordId = null;
    });
    expect(r.ok).toBe(false);
    expect(r.records.map((o) => o.status)).toEqual(["refused", "refused"]);
    expect(r.records[1].summary).toMatch(/same household as .*not extracted/);
    expect((await research()).sources).toHaveLength(0);
  });

  it("lets a household member with an accepted hint lead its household, wherever it is in the call", async () => {
    const { a, b } = household();
    await seedLog([hintEntry("log_009", b.recordId)]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [a.recordId, b.recordId] }, readerFor([a, b]) as any, LOCAL);
    expect(r.records.map((o) => o.status)).toEqual(["already_extracted", "extracted"]);
    expect(r.records[0].srcId).toBe(r.records[1].srcId);
    const after = await research();
    expect(after.sources).toHaveLength(1);
    expect(after.log.map((e: any) => e.id)).toEqual(["log_009"]);
  });

  it("still extracts a household member with an accepted hint, so the hint's entry is cited", async () => {
    const { a, b } = household();
    await runExtractionAppend({ projectPath: dir, recordIds: [a.recordId] }, readerFor([a]) as any, LOCAL);
    const res = await research();
    await seedLog([...res.log, hintEntry("log_009", b.recordId)]);
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [b.recordId] }, readerFor([b]) as any, LOCAL);
    expect(r.records[0].status).toBe("extracted");
    expect(r.records[0].logId).toBe("log_009");
    const after = await research();
    const cited = new Set(after.assertions.map((x: any) => x.log_entry_id));
    expect(after.log.filter((e: any) => e.outcome === "positive" && !cited.has(e.id))).toEqual([]);
  });

  it("extracts each of several records that carry no persona ARKs, though their person ids collide", async () => {
    const strip = (el: any, rid: string) => ({
      ...el,
      recordId: rid,
      gedcomx: { ...el.gedcomx, persons: el.gedcomx.persons.map(({ ark: _a, ...p }: any, i: number) => ({ ...p, id: `p_${i + 1}` })) },
    });
    const one = strip(element("census-1850-no-relationship-column"), "AAAA-001");
    const two = strip(element("death"), "AAAA-002");
    const three = strip(element("baptism"), "AAAA-003");
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: ["AAAA-001", "AAAA-002", "AAAA-003"] },
      readerFor([one, two, three]) as any,
      LOCAL,
    );
    expect(r.records.map((o) => o.status)).toEqual(["extracted", "extracted", "extracted"]);
    expect((await research()).sources).toHaveLength(3);
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

    it("keeps an index search and a later image browse as two sources, each saying what it was", async () => {
      await logNil();
      const res = await research();
      res.log.push({ ...res.log[0], id: "log_002", tool: "image_search" });
      await writeFile(join(dir, "research.json"), JSON.stringify(res), "utf8");
      const c = "United States Census, 1870";
      await runExtractionAppend(
        { projectPath: dir, absences: [{ collection: c, name: "Patrick Flynn", logEntryId: "log_001" }] },
        readerFor([]) as any,
        LOCAL,
      );
      await runExtractionAppend(
        { projectPath: dir, absences: [{ collection: c, name: "Patrick Flynn", logEntryId: "log_002", sourceClassification: "original" }] },
        readerFor([]) as any,
        LOCAL,
      );
      const classes = (await research()).sources.map((s: any) => s.source_classification).sort();
      expect(classes).toEqual(["derivative", "original"]);
    });

    it("refuses one search given as two kinds of search", async () => {
      await logNil();
      const r = await runExtractionAppend(
        {
          projectPath: dir,
          absences: [
            { collection: "C", name: "A", logEntryId: "log_001" },
            { collection: "C", name: "B", logEntryId: "log_001", sourceClassification: "original" },
          ],
        },
        readerFor([]) as any,
        LOCAL,
      );
      expect(r.ok).toBe(false);
      expect(r.errors?.[0]).toMatch(/One search is one kind of search/);
    });

    it("refuses an unknown sourceClassification", async () => {
      await logNil();
      const r = await runExtractionAppend(
        { projectPath: dir, absences: [{ collection: "C", name: "N", logEntryId: "log_001", sourceClassification: "primary" as any }] },
        readerFor([]) as any,
        LOCAL,
      );
      expect(r.ok).toBe(false);
      expect((await research()).sources).toEqual([]);
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

// ─── plan-item completion, the question tie and read reuse (issue #3516 PR B) ──

describe("extraction_append: closes the plan item and claims re-found records", () => {
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
  const element = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).element;
  let dir: string;

  const question = (id: string) => ({
    id,
    question: "Who were the parents of John Smith?",
    rationale: "Timeline gap before 1850",
    selection_basis: "objective_decomposition",
    priority: "high",
    status: "open",
    depends_on: [],
    unblocks: [],
    created: "2026-01-01",
    resolved: null,
    resolution_assertion_ids: [],
    search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
  });
  const item = (id: string, status: string, sequence = 1) => ({
    id,
    sequence,
    record_type: "census",
    jurisdiction: "Schuylkill, Pennsylvania, United States",
    date_range: "1850-1860",
    repository: "NARA",
    rationale: "Census should list the household",
    fallback_for: null,
    status,
  });
  const plan = (id: string, status: string, items: any[], questionId = "q_001") => ({
    id,
    question_id: questionId,
    status,
    created: "2026-01-01",
    items,
  });
  const entry = (id: string, tool: string, planItemId: string | null, outcome: string, extra: Record<string, unknown> = {}) => ({
    id,
    plan_item_id: planItemId,
    performed: "2026-01-01T00:00:00Z",
    tool,
    // Every item() is record_type "census", so the search that found the record
    // names census — satisfying planItemCompletionRecordTypeInvariants when the
    // extracted record completes the item.
    query: { surname: "Miller", recordType: "census" },
    outcome,
    results_examined: 1,
    external_site: null,
    results_ref: null,
    ...extra,
  });
  /** A finalized sidecar holding these rows, as a logged search leaves it. */
  const sidecar = async (logId: string, tool: string, results: any[]) => {
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", `${logId}.json`),
      JSON.stringify({ tool, retrieved: "2026-01-01T00:00:00Z", returned_count: results.length, payload: { results } }),
      "utf8",
    );
    return `results/${logId}.json`;
  };
  const search = async (logId: string, planItemId: string, outcome: string, recordIds: string[]) =>
    entry(logId, "record_search", planItemId, outcome, {
      results_ref: await sidecar(logId, "record_search", recordIds.map((recordId) => ({ recordId }))),
    });
  const seed = async (over: Record<string, unknown>) => {
    const research = { ...baseResearch(), sources: [], assertions: [], questions: [question("q_001")], ...over };
    await writeFile(join(dir, "research.json"), JSON.stringify(research), "utf8");
  };
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const statusOf = (r: any, pid: string) =>
    r.plans.flatMap((p: any) => p.items).find((i: any) => i.id === pid)?.status;
  const readerFor = (els: any[], reads: string[] = []) => ({
    readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
      reads.push(recordId);
      const el = els.find((e) => arkToBareId(e.recordId) === arkToBareId(recordId));
      if (!el) throw new Error(`404 for ${recordId}`);
      const staged = await stageSearchResults({
        projectPath: projectPath!,
        tool: "record_read",
        response: { query: { recordId }, results: [el] },
      });
      return { ...el.gedcomx, staged };
    },
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-plan-test-"));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("completes an in_progress item when a record its record_search found is extracted", async () => {
    const death = element("death");
    await seed({
      plans: [plan("pl_001", "active", [item("pli_001", "in_progress")])],
      log: [await search("log_001", "pli_001", "positive", [death.recordId])],
    });
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_001"] }, readerFor([death]) as any, LOCAL);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.planItems).toEqual({ completed: ["pli_001"] });
    expect(statusOf(await research(), "pli_001")).toBe("completed");
  });

  it("completes an item with two positive searches when only one record is extracted", async () => {
    const death = element("death");
    await seed({
      plans: [plan("pl_001", "active", [item("pli_001", "in_progress")])],
      log: [
        await search("log_001", "pli_001", "positive", [death.recordId]),
        await search("log_002", "pli_001", "partial", ["ZZZZ-ZZZ"]),
      ],
    });
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId] }, readerFor([death]) as any, LOCAL);
    expect(r.planItems?.completed).toEqual(["pli_001"]);
  });

  it("completes every item whose search found the record, and one refused item does not sink the other", async () => {
    const death = element("death");
    await seed({
      plans: [plan("pl_001", "active", [item("pli_001", "in_progress"), item("pli_002", "in_progress", 2), item("pli_003", "in_progress", 3)])],
      log: [
        await search("log_001", "pli_001", "positive", [death.recordId]),
        await search("log_002", "pli_002", "positive", [death.recordId]),
        await search("log_003", "pli_003", "positive", [death.recordId]),
        // pli_003's latest search is an external hand-off still awaiting its
        // capture, so completing it is refused (capture-pending).
        entry("log_004", "external_site", "pli_003", "negative", {
          results_examined: 0,
          external_site: { site: "ancestry", url_generated: "https://www.ancestry.com/search?x=1", capture_received: false },
        }),
      ],
    });
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId] }, readerFor([death]) as any, LOCAL);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.planItems?.completed).toEqual(["pli_001", "pli_002"]);
    expect(r.planItems?.errors?.[0]).toMatch(/^pli_003 was not completed/);
    const after = await research();
    expect(after.sources).toHaveLength(1);
    expect(statusOf(after, "pli_003")).toBe("in_progress");
  });

  it("leaves nil-only, planned and superseded-plan items alone", async () => {
    const death = element("death");
    await seed({
      questions: [question("q_001"), question("q_002")],
      plans: [
        plan("pl_001", "superseded", [item("pli_001", "in_progress")]),
        plan("pl_002", "active", [item("pli_002", "in_progress"), item("pli_003", "planned", 2)], "q_002"),
      ],
      log: [
        await search("log_001", "pli_001", "positive", [death.recordId]),
        // A nil search WITH a sidecar listing the record: only the "positive or
        // partial" filter keeps this item open (Gennecis, review of #3613).
        await search("log_002", "pli_002", "negative", [death.recordId]),
        await search("log_003", "pli_003", "positive", [death.recordId]),
      ],
    });
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId] }, readerFor([death]) as any, LOCAL);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.planItems).toBeUndefined();
    const after = await research();
    expect(["pli_001", "pli_002", "pli_003"].map((p) => statusOf(after, p))).toEqual(["in_progress", "in_progress", "planned"]);
  });

  it("re-sending an extracted record with questionIds ties it and completes its item", async () => {
    const death = element("death");
    await seed({ questions: [question("q_001"), question("q_002")] });
    await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_001"] }, readerFor([death]) as any, LOCAL);
    const before = await research();
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        ...before,
        plans: [plan("pl_001", "active", [item("pli_001", "in_progress")], "q_002")],
        log: [...before.log, await search("log_002", "pli_001", "positive", [death.recordId])],
      }),
      "utf8",
    );
    const reads: string[] = [];
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_002"] }, readerFor([death], reads) as any, LOCAL);
    expect(reads).toEqual([]);
    expect(r.records[0].status).toBe("already_extracted");
    expect(r.records[0].summary).toMatch(/tied to q_002/);
    expect(r.planItems?.completed).toEqual(["pli_001"]);
    const after = await research();
    expect(after.assertions.length).toBe(before.assertions.length);
    expect(after.assertions.every((a: any) => a.extracted_for_question_ids.join(",") === "q_001,q_002")).toBe(true);
  });

  it("the whole-batch tie asks for the first failure only: it reads nothing but ok and is retried op by op", async () => {
    // A refusal's answer to this call is thrown away, so it is not asked to judge the rest of the
    // batch: that is a second pass over a copy of the document.
    const death = element("death");
    await seed({ questions: [question("q_001"), question("q_002")] });
    await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_001"] }, readerFor([death]) as any, LOCAL);
    vi.mocked(researchAppend).mockClear();
    await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_002"] }, readerFor([death]) as any, LOCAL);
    const ties = vi.mocked(researchAppend).mock.calls.filter(([input]: any[]) =>
      (input.ops ?? []).some((o: any) => o.section === "assertions" && o.op === "update"),
    );
    expect(ties.length).toBe(1);
    expect(ties[0][1]).toMatchObject({ toolName: "extraction_append", firstFailureOnly: true });
  });

  it("a re-send without questionIds writes nothing to assertions", async () => {
    const death = element("death");
    await seed({});
    await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId], questionIds: ["q_001"] }, readerFor([death]) as any, LOCAL);
    const before = await research();
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId] }, readerFor([death]) as any, LOCAL);
    expect(r.records[0].summary).toMatch(/nothing written/);
    expect((await research()).assertions).toEqual(before.assertions);
  });

  it("ties the other assertions when one written before a later rule refuses the update", async () => {
    const marriage = element("marriage");
    await seed({ questions: [question("q_001"), question("q_002")] });
    await runExtractionAppend({ projectPath: dir, recordIds: [marriage.recordId], questionIds: ["q_001"] }, readerFor([marriage]) as any, LOCAL);
    const before = await research();
    // A shape the update arm still refuses on every update: negative evidence
    // whose role is not the literal "absent".
    const legacy = before.assertions[0];
    legacy.record_basis = "absent";
    await writeFile(join(dir, "research.json"), JSON.stringify(before), "utf8");
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [marriage.recordId], questionIds: ["q_002"] }, readerFor([marriage]) as any, LOCAL);
    expect(r.records[0].summary).toMatch(/tied to q_002/);
    expect(r.records[0].warnings?.some((w) => w.startsWith(`${legacy.id} was not tied`))).toBe(true);
    const after = await research();
    const tied = after.assertions.filter((a: any) => a.extracted_for_question_ids.includes("q_002")).map((a: any) => a.id);
    expect(tied).not.toContain(legacy.id);
    expect(tied.length).toBe(after.assertions.length - 1);
  });

  it("ties a legacy unknown/primary assertion, which the informant floor no longer re-checks on a tie", async () => {
    const marriage = element("marriage");
    await seed({ questions: [question("q_001"), question("q_002")] });
    await runExtractionAppend({ projectPath: dir, recordIds: [marriage.recordId], questionIds: ["q_001"] }, readerFor([marriage]) as any, LOCAL);
    const before = await research();
    for (const a of before.assertions) {
      a.informant_proximity = "unknown";
      a.information_quality = "primary";
    }
    await writeFile(join(dir, "research.json"), JSON.stringify(before), "utf8");
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [marriage.recordId], questionIds: ["q_002"] }, readerFor([marriage]) as any, LOCAL);
    expect(r.records[0].summary).toMatch(/tied to q_002/);
    expect(r.records[0].warnings ?? []).toEqual([]);
    const after = await research();
    expect(after.assertions.every((a: any) => a.extracted_for_question_ids.join(",") === "q_001,q_002")).toBe(true);
  });

  it("reuses an earlier record_read entry without a live read", async () => {
    const death = element("death");
    await seed({
      log: [entry("log_001", "record_read", null, "positive", {
        query: { recordId: `ark:/61903/1:1:${death.recordId}` },
        results_ref: await sidecar("log_001", "record_read", [death]),
      })],
    });
    const reads: string[] = [];
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [death.recordId] }, readerFor([death], reads) as any, LOCAL);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
    expect(reads).toEqual([]);
    expect(r.records[0].logId).toBe("log_001");
    const after = await research();
    expect(after.log.map((e: any) => e.id)).toEqual(["log_001"]);
    expect(after.assertions.every((a: any) => a.log_entry_id === "log_001")).toBe(true);
    expect(after.assertions.some((a: any) => typeof a.record_persona_id === "string")).toBe(true);
  });

  it.each([
    ["in one call", true],
    ["in two calls", false],
  ])("cites every household member's own earlier read %s, so none is left for the router to resend (#3543)", async (_name, together) => {
    const a = element("census-1850-no-relationship-column");
    const memberArk = a.gedcomx.persons.map((p: any) => p.ark).find((k: string) => arkToBareId(k) !== arkToBareId(a.recordId));
    const b = { ...a, recordId: arkToBareId(memberArk) };
    await seed({
      log: [
        entry("log_001", "record_read", null, "positive", {
          query: { recordId: `ark:/61903/1:1:${a.recordId}` },
          results_ref: await sidecar("log_001", "record_read", [a]),
        }),
        entry("log_002", "record_read", null, "positive", {
          query: { recordId: `ark:/61903/1:1:${b.recordId}` },
          results_ref: await sidecar("log_002", "record_read", [b]),
        }),
      ],
    });
    const calls = together ? [[a.recordId, b.recordId]] : [[a.recordId], [b.recordId]];
    for (const ids of calls) await runExtractionAppend({ projectPath: dir, recordIds: ids }, readerFor([a, b], []) as any, LOCAL);
    const after = await research();
    const cited = new Set(after.assertions.map((x: any) => x.log_entry_id));
    expect(after.log.filter((e: any) => e.outcome === "positive" && !cited.has(e.id)).map((e: any) => e.id)).toEqual([]);
  });

  it.each([
    ["a census read with no indexFields", (el: any) => ({ ...el, indexFields: undefined }), "census-1850-no-relationship-column"],
    ["a sidecar that no longer holds the record", () => ({ recordId: "ZZZZ-ZZZ", gedcomx: {} }), "death"],
    ["a sidecar that cannot be read", null, "death"],
  ])("reads live rather than reuse %s", async (_name, rowOf, fixture) => {
    const el = element(fixture);
    let results_ref = "results/log_001.json";
    if (rowOf) {
      results_ref = await sidecar("log_001", "record_read", [(rowOf as (e: any) => any)(el)]);
    } else {
      await mkdir(join(dir, "results"), { recursive: true });
      await writeFile(join(dir, "results", "log_001.json"), "{ not json", "utf8");
    }
    await seed({
      log: [entry("log_001", "record_read", null, "positive", { query: { recordId: el.recordId }, results_ref })],
    });
    const reads: string[] = [];
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [el.recordId] }, readerFor([el], reads) as any, LOCAL);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
    expect(reads).toEqual([el.recordId]);
    expect(r.records[0].logId).toBe("log_002");
  });
});

// ─── recordIds: the thin-subject gate (issue #2213 d29) ─────────────────────

describe("extraction_append: a thin subject's search hit is refused", () => {
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
  const element = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).element;
  let dir: string;

  const person = (id: string, birth: string, extra: Record<string, unknown> = {}) => ({
    id,
    gender: "Male",
    names: [{ id: `${id}-N1`, given: "William", surname: "Brown" }],
    facts: [{ id: `${id}-F1`, type: "Birth", date: birth, place: "Virginia" }],
    ...extra,
  });
  const writeTree = (persons: any[], relationships: any[] = [], sources: any[] = []) =>
    writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons, relationships, sources }), "utf8");
  /** A logged record_search and its finalized sidecar, which keeps the echoed
   *  query verbatim — `subjectId` included — as record_search stages it. */
  const search = async (logId: string, rows: string[], subjectId?: string, raw?: string, frozen?: boolean) => {
    await mkdir(join(dir, "results"), { recursive: true });
    const query = { surname: "Brown", ...(subjectId ? { subjectId } : {}) };
    const flag = frozen === undefined ? {} : { subjectTooThin: frozen };
    await writeFile(
      join(dir, "results", `${logId}.json`),
      raw ?? JSON.stringify({ tool: "record_search", retrieved: "2026-01-01T00:00:00Z", returned_count: rows.length, payload: { query, ...flag, results: rows.map((recordId) => ({ recordId })) } }),
      "utf8",
    );
    return {
      id: logId,
      plan_item_id: null,
      performed: "2026-01-01T00:00:00Z",
      tool: "record_search",
      query: { surname: "Brown" },
      outcome: "positive",
      results_examined: rows.length,
      external_site: null,
      results_ref: `results/${logId}.json`,
    };
  };
  const seed = (log: any[]) =>
    writeFile(join(dir, "research.json"), JSON.stringify({ ...baseResearch(), sources: [], assertions: [], log }), "utf8");
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const readerFor = (els: any[]) => ({
    readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
      const el = els.find((e) => arkToBareId(e.recordId) === arkToBareId(recordId));
      if (!el) throw new Error(`404 for ${recordId}`);
      const staged = await stageSearchResults({ projectPath: projectPath!, tool: "record_read", response: { query: { recordId }, results: [el] } });
      return { ...el.gedcomx, staged };
    },
  });
  const run = (recordIds: string[], els: any[]) =>
    runExtractionAppend({ projectPath: dir, recordIds }, readerFor(els) as any, LOCAL);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-thin-test-"));
    await writeTree([person("I1", "1872")]);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a record found only by a thin subject's search, and writes nothing", async () => {
    const death = element("death");
    await seed([await search("log_001", [death.recordId], "I1")]);
    const before = await readFile(join(dir, "research.json"), "utf8");
    const r = await run([death.recordId], [death]);
    expect(r.ok).toBe(false);
    expect(r.records[0].status).toBe("refused");
    expect(r.records[0].summary).toMatch(/William Brown \(I1\).*cannot be told from a namesake/);
    expect(await readFile(join(dir, "research.json"), "utf8")).toBe(before);
  });

  it("extracts it once the subject has a date narrower than a year", async () => {
    const death = element("death");
    await writeTree([person("I1", "12 Mar 1872")]);
    await seed([await search("log_001", [death.recordId], "I1")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("extracts it once the subject has a named parent", async () => {
    const death = element("death");
    await writeTree(
      [person("I1", "1872"), { id: "I2", gender: "Male", names: [{ id: "I2-N1", given: "Thomas", surname: "Brown" }], facts: [] }],
      [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    );
    await seed([await search("log_001", [death.recordId], "I1")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("does not let a search for another, anchored person lift the gate", async () => {
    const death = element("death");
    await writeTree([person("I1", "1872"), person("I3", "4 Jul 1850")]);
    await seed([await search("log_001", [death.recordId], "I1"), await search("log_002", [death.recordId], "I3")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("refused");
  });

  it("extracts a record only an anchored person's search found", async () => {
    const death = element("death");
    await writeTree([person("I1", "1872"), person("I3", "4 Jul 1850")]);
    await seed([await search("log_002", [death.recordId], "I3")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("refuses a record a thin subject's search found and has not logged yet, and does not read it", async () => {
    const death = element("death");
    await seed([]);
    await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { query: { surname: "Brown", subjectId: "I1" }, results: [{ recordId: death.recordId }] },
    });
    const reads: string[] = [];
    const reader = readerFor([death]);
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: [death.recordId] },
      { readRecord: async (i: any, pr: any) => (reads.push(i.recordId), reader.readRecord(i)) } as any,
      LOCAL,
    );
    expect(r.records[0].status, JSON.stringify(r)).toBe("refused");
    expect(reads).toEqual([]);
  });

  it("keeps refusing after the tree gains a date, when the search saved the subject as thin", async () => {
    const death = element("death");
    await seed([await search("log_001", [death.recordId], "I1", undefined, true)]);
    await writeTree([person("I1", "Mar 1872")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("refused");
    expect(r.records[0].summary).toMatch(/never from this one; once the project records it, search again/);
  });

  it("extracts once a later search for the same person saved them as not thin", async () => {
    const death = element("death");
    await writeTree([person("I1", "Mar 1872")]);
    await seed([
      await search("log_001", [death.recordId], "I1", undefined, true),
      await search("log_002", [death.recordId], "I1", undefined, false),
    ]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("does not let a not-thin search for another person lift a saved thin search", async () => {
    const death = element("death");
    await writeTree([person("I1", "1872"), person("I3", "4 Jul 1850")]);
    await seed([
      await search("log_001", [death.recordId], "I1", undefined, true),
      await search("log_002", [death.recordId], "I3", undefined, false),
    ]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("refused");
  });

  it("extracts a record no logged search found", async () => {
    const death = element("death");
    await seed([await search("log_001", ["ZZZZ-ZZZ"], "I1")]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("refuses only the thin record in a batch, and extracts the other", async () => {
    const death = element("death");
    const marriage = element("marriage");
    await seed([await search("log_001", [death.recordId], "I1")]);
    const r = await run([death.recordId, marriage.recordId], [death, marriage]);
    expect(r.ok).toBe(true);
    expect(r.records.map((o) => o.status)).toEqual(["refused", "extracted"]);
    expect((await research()).sources).toHaveLength(1);
  });

  it("fails open on a sidecar with no subjectId, an unreadable one, or an unknown subject", async () => {
    const death = element("death");
    await seed([
      await search("log_001", [death.recordId]),
      await search("log_002", [death.recordId], "I1", "{not json"),
      await search("log_003", [death.recordId], "I9"),
    ]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("does not let a search re-run without subjectId lift the gate", async () => {
    const death = element("death");
    await seed([await search("log_001", [death.recordId], "I1"), await search("log_002", [death.recordId])]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status).toBe("refused");
  });

  it("extracts a record the researcher accepted as a hint, even when a thin subject's search found it", async () => {
    const death = element("death");
    await seed([
      await search("log_001", [death.recordId], "I1"),
      {
        id: "log_002",
        plan_item_id: null,
        performed: "2026-01-01T00:00:00Z",
        tool: "person_record_matches",
        query: { id: "LZNY-BRF", recordId: death.recordId },
        outcome: "positive",
        results_examined: 1,
        external_site: null,
        results_ref: null,
      },
    ]);
    const r = await run([death.recordId], [death]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("extracts a household record the researcher accepted as a hint on another persona", async () => {
    const census = element("census-1880-with-relationship-column");
    const [head, other] = census.gedcomx.persons.map((p: any) => arkToBareId(p.ark));
    await seed([
      await search("log_001", [head], "I1"),
      {
        id: "log_002",
        plan_item_id: null,
        performed: "2026-01-01T00:00:00Z",
        tool: "person_record_matches",
        query: { id: "LZNY-BRF", recordId: `ark:/61903/1:1:${other}` },
        outcome: "positive",
        results_examined: 1,
        external_site: null,
        results_ref: null,
      },
    ]);
    const r = await run([census.recordId], [census]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
  });

  it("refuses a record requested by its record id when the search listed a co-resident persona", async () => {
    const census = element("census-1880-with-relationship-column");
    const persona = arkToBareId(census.gedcomx.persons[0].ark);
    expect(persona).not.toBe(arkToBareId(census.recordId));
    await seed([await search("log_001", [persona], "I1")]);
    const r = await run([census.recordId], [census]);
    expect(r.records[0].status, JSON.stringify(r)).toBe("refused");
  });
});

// ─── personId: the baseline step (issue #3516 PR C) ─────────────────────────

import { ATTACHMENT_LINK_RATIONALE, isAttachmentLink } from "../../src/utils/tree-person.js";
import { errorsOf } from "../helpers/narrow.js";
import { callTool } from "../helpers/call-tool.js";

describe("extraction_append: personId extracts and links a person's attachments", () => {
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
  const element = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).element;
  // The captured 1870 census: John Boyer is p_260900945, ark MZGS-1B7; Anna is
  // p_260900946, MZGS-1BW. The record itself is MZGS-1BH.
  const CENSUS = () => element("census-1870-no-relationship-column");
  let dir: string;
  const url = (bare: string) => `https://familysearch.org/ark:/61903/1:1:${bare}`;
  const person = (id: string, refs: { person?: string[]; names?: string[]; facts?: string[] }, ark?: string) => ({
    id,
    gender: "Male",
    ...(ark ? { ark } : {}),
    names: [{ id: `${id}-N1`, given: "John", surname: "Boyer", ...(refs.names ? { sources: refs.names.map((ref) => ({ ref })) } : {}) }],
    facts: refs.facts ? [{ id: `${id}-F1`, type: "Birth", date: "1845", sources: refs.facts.map((ref) => ({ ref })) }] : [],
    ...(refs.person ? { sources: refs.person.map((ref) => ({ ref })) } : {}),
  });
  const writeTree = async (persons: any[], sources: any[], relationships: any[] = []) =>
    writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons, relationships, sources }), "utf8");
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const tree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf8"));
  /** A live record_read: any persona's ARK returns the whole record, staged
   *  under the ARK that was asked for. */
  const reader = (els: any[], reads: string[] = []) => ({
    readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
      reads.push(recordId);
      const want = arkToBareId(recordId);
      const el = els.find(
        (e) => arkToBareId(e.recordId) === want || (e.gedcomx.persons ?? []).some((p: any) => p.ark && arkToBareId(p.ark) === want),
      );
      if (!el) throw new Error(`404 for ${recordId}`);
      const row = { ...el, recordId: `ark:/61903/1:1:${want}` };
      const staged = await stageSearchResults({ projectPath: projectPath!, tool: "record_read", response: { query: { recordId }, results: [row] } });
      return { ...el.gedcomx, staged };
    },
  });
  const run = (personId: string, rdr = reader([CENSUS()])) =>
    runExtractionAppend({ projectPath: dir, personId } as any, rdr as any, LOCAL);
  const S1 = { id: "S1", title: "United States Census, 1870", url: url("MZGS-1B7") };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-person-test-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ ...baseResearch(), sources: [], assertions: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts an attached record even when a thin subject's search found it", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "log_001.json"),
      JSON.stringify({ tool: "record_search", payload: { query: { subjectId: "I1" }, results: [{ recordId: "ark:/61903/1:1:MZGS-1B7" }] } }),
      "utf8",
    );
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({
        ...baseResearch(),
        sources: [],
        assertions: [],
        log: [{ id: "log_001", plan_item_id: null, performed: "2026-01-01T00:00:00Z", tool: "record_search", query: {}, outcome: "positive", results_examined: 1, external_site: null, results_ref: "results/log_001.json" }],
      }),
      "utf8",
    );
    const r = await run("I1");
    expect(r.extracted, JSON.stringify(r)).toBe(1);
  });

  it("extracts the attached record and links the attached persona's assertions as unverified", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    const r = await run("I1");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.extracted).toBe(1);
    const after = await research();
    const links = after.person_evidence;
    expect(links.length).toBeGreaterThan(0);
    expect(links.length).toBe(r.linked);
    expect(links.every((pe: any) => isAttachmentLink(pe) && pe.person_id === "I1")).toBe(true);
    expect(links[0].rationale).toBe(ATTACHMENT_LINK_RATIONALE);
    const linkedPersonas = new Set(
      links.map((pe: any) => after.assertions.find((a: any) => a.id === pe.assertion_id).record_persona_id),
    );
    expect([...linkedPersonas]).toEqual(["p_260900945"]);
    expect(r.summary).toMatch(/linked as unverified attachments/);
    expect(r.summary).toMatch(/separate request/);
  });

  it("the whole-batch link asks for the first failure only: it reads nothing but ok and is retried op by op", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    vi.mocked(researchAppend).mockClear();
    const r = await run("I1");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const links = vi.mocked(researchAppend).mock.calls.filter(([input]: any[]) =>
      (input.ops ?? []).some((o: any) => o.section === "person_evidence"),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const [, options] of links) expect(options).toMatchObject({ attachmentLink: true, firstFailureOnly: true });
  });

  it("reuses the import's S and mints no second tree source", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    await run("I1");
    expect((await research()).sources[0].gedcomx_source_description_id).toBe("S1");
    expect((await tree()).sources.map((s: any) => s.id)).toEqual(["S1"]);
  });

  it("resolves a FamilySearch id through the person's ark", async () => {
    await writeTree([person("I1", { person: ["S1"] }, "https://familysearch.org/ark:/61903/4:1:KWJ1-ABC")], [S1]);
    const r = await run("KWJ1-ABC");
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await research()).person_evidence.every((pe: any) => pe.person_id === "I1")).toBe(true);
  });

  it.each([
    ["name-level", { names: ["S1"] }],
    ["fact-level", { facts: ["S1"] }],
  ])("counts a %s ref", async (_n, refs) => {
    await writeTree([person("I1", refs)], [S1]);
    const r = await run("I1");
    expect(r.extracted).toBe(1);
  });

  it("takes no relationship-level ref and no relative's source", async () => {
    await writeTree(
      [person("I1", {}), person("I2", { person: ["S1"] })],
      [S1],
      [{ id: "R1", type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: "S1" }] }],
    );
    const reads: string[] = [];
    const r = await run("I1", reader([CENSUS()], reads));
    expect(r.ok).toBe(true);
    expect(reads).toEqual([]);
    expect(r.summary).toMatch(/no attached indexed record/);
  });

  it("counts a source that is not an indexed record as skipped", async () => {
    await writeTree([person("I1", { person: ["S1", "S2"] })], [S1, { id: "S2", title: "Family memory", url: "https://www.familysearch.org/photos/artifacts/123" }]);
    const r = await run("I1");
    expect(r.skipped).toBe(1);
    expect(r.summary).toMatch(/1 attached source is not indexed records|1 attached source is not/);
  });

  it("with no attachment returns ok and writes nothing", async () => {
    await writeTree([person("I1", {})], []);
    const before = await readFile(join(dir, "research.json"), "utf8");
    const r = await run("I1");
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
    expect(await readFile(join(dir, "research.json"), "utf8")).toBe(before);
  });

  it("refuses personId together with recordIds", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    const r = await runExtractionAppend({ projectPath: dir, personId: "I1", recordIds: ["MZGS-1B7"] } as any, reader([CENSUS()]) as any, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/together/);
  });

  it("links a record extracted earlier without re-reading it", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    await runExtractionAppend({ projectPath: dir, recordIds: ["ark:/61903/1:1:MZGS-1B7"] } as any, reader([CENSUS()]) as any, LOCAL);
    const reads: string[] = [];
    const r = await run("I1", reader([CENSUS()], reads));
    expect(reads).toEqual([]);
    expect(r.linked).toBeGreaterThan(0);
  });

  it("leaves a persona alone when any of its assertions is already linked to anyone", async () => {
    await writeTree([person("I1", { person: ["S1"] }), person("I7", {})], [S1]);
    await runExtractionAppend({ projectPath: dir, recordIds: ["ark:/61903/1:1:MZGS-1B7"] } as any, reader([CENSUS()]) as any, LOCAL);
    const r0 = await research();
    const johns = r0.assertions.filter((a: any) => a.record_persona_id === "p_260900945");
    r0.person_evidence = [{ id: "pe_001", assertion_id: johns[0].id, person_id: "I7", confidence: "probable", rationale: "someone decided", created: "2026-01-01", match_score: null }];
    await writeFile(join(dir, "research.json"), JSON.stringify(r0), "utf8");
    const r = await run("I1");
    expect(r.linked).toBe(0);
    expect(r.alreadyLinked).toBe(1);
    expect((await research()).person_evidence).toHaveLength(1);
  });

  it("never re-links a rejected pair, and still links the persona's other assertions", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    await runExtractionAppend({ projectPath: dir, recordIds: ["ark:/61903/1:1:MZGS-1B7"] } as any, reader([CENSUS()]) as any, LOCAL);
    const r0 = await research();
    const johns = r0.assertions.filter((a: any) => a.record_persona_id === "p_260900945");
    r0.rejected_links = [{ id: "rj_001", assertion_id: johns[0].id, person_id: "I1", created: "2026-01-01" }];
    await writeFile(join(dir, "research.json"), JSON.stringify(r0), "utf8");
    const r = await run("I1");
    expect(r.rejectedSkipped).toBe(1);
    expect(r.linked).toBe(johns.length - 1);
    expect((await research()).person_evidence.some((pe: any) => pe.assertion_id === johns[0].id)).toBe(false);
  });

  it("treats a record re-found through another persona's ARK as one record: tied, not re-extracted", async () => {
    await writeTree([person("I1", { person: ["S1"] })], [S1]);
    await run("I1");
    const before = await research();
    const reads: string[] = [];
    const r = await runExtractionAppend(
      { projectPath: dir, recordIds: ["ark:/61903/1:1:MZGS-1BW"], questionIds: [] } as any,
      reader([CENSUS()], reads) as any,
      LOCAL,
    );
    expect(r.records[0].status, JSON.stringify(r)).toBe("already_extracted");
    expect(reads).toEqual([]);
    expect((await research()).sources).toHaveLength(before.sources.length);
  });
});

describe("research_append: the attachment-link score exemption is code-only", () => {
  const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
  const CENSUS = () => JSON.parse(readFileSync(join(FIX, "census-1870-no-relationship-column.json"), "utf8")).element;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-person-gate-"));
    await writeFile(join(dir, "research.json"), JSON.stringify({ ...baseResearch(), sources: [], assertions: [] }), "utf8");
    // The write-once starting tree init-project leaves: I1 pre-existed this
    // research, so the score gate cannot treat it as minted from the record.
    const startTree = JSON.stringify({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Boyer" }], sources: [{ ref: "S1" }] }],
      relationships: [],
      sources: [{ id: "S1", title: "1870", url: "https://familysearch.org/ark:/61903/1:1:MZGS-1B7" }],
    });
    await writeFile(join(dir, "tree.gedcomx.json"), startTree, "utf8");
    await writeFile(join(dir, "starting-tree.gedcomx.json"), startTree, "utf8");
    const staged = { readRecord: async ({ recordId, projectPath }: any) => {
      const row = { ...CENSUS(), recordId: `ark:/61903/1:1:${arkToBareId(recordId)}` };
      return { ...row.gedcomx, staged: await stageSearchResults({ projectPath, tool: "record_read", response: { query: { recordId }, results: [row] } }) };
    } };
    await runExtractionAppend({ projectPath: dir, personId: "I1" } as any, staged as any, LOCAL);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const research = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const annaLink = async () => {
    const anna = (await research()).assertions.find((a: any) => a.record_persona_id === "p_260900946");
    return { section: "person_evidence", op: "append", entry: { assertion_id: anna.id, person_id: "I1", confidence: "speculative", match_score: null, rationale: ATTACHMENT_LINK_RATIONALE } };
  };

  it("refuses the same unscored speculative link from a caller without the internal flag", async () => {
    const r = await researchAppend({ projectPath: dir, ops: [await annaLink()] } as any);
    expect(r.ok).toBe(false);
    expect(errorsOf(r)?.join(" ")).toMatch(/same_person/);
  });

  it("still refuses it with no starting-tree baseline, where the reused S would make the subject look minted", async () => {
    await rm(join(dir, "starting-tree.gedcomx.json"));
    const r = await researchAppend({ projectPath: dir, ops: [await annaLink()] } as any);
    expect(r.ok).toBe(false);
    expect(errorsOf(r)?.join(" ")).toMatch(/same_person/);
  });

  it("accepts it only on the internal flag", async () => {
    const r = await researchAppend(
      { projectPath: dir, ops: [await annaLink()] } as any,
      { allowedSections: new Set(["person_evidence"]), toolName: "extraction_append", attachmentLink: true },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("refuses raising an attachment link in place, and accepts superseding it", async () => {
    const pe = (await research()).person_evidence[0];
    const raise = await researchAppend({ projectPath: dir, section: "person_evidence", op: "update", entryId: pe.id, fields: { confidence: "probable" } } as any);
    expect(raise.ok).toBe(false);
    expect(errorsOf(raise)?.join(" ")).toMatch(/only ever superseded/);
    const retire = await researchAppend({ projectPath: dir, section: "person_evidence", op: "update", entryId: pe.id, fields: { superseded_by: "pe_999" } } as any);
    expect(retire.ok, JSON.stringify(retire)).toBe(true);
  });

  it("refuses reviving a retired attachment link at a raised confidence", async () => {
    const pe = (await research()).person_evidence[0];
    const retire = await researchAppend({ projectPath: dir, section: "person_evidence", op: "update", entryId: pe.id, fields: { superseded_by: "pe_999" } } as any);
    expect(retire.ok, JSON.stringify(retire)).toBe(true);
    const revive = await researchAppend({ projectPath: dir, section: "person_evidence", op: "update", entryId: pe.id, fields: { superseded_by: null, confidence: "probable" } } as any);
    expect(revive.ok).toBe(false);
    expect(errorsOf(revive)?.join(" ")).toMatch(/only ever superseded/);
  });
});
