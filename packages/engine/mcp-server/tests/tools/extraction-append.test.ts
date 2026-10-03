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

  it("writes exactly {sources, assertions}", () => {
    expect([...EXTRACTION_SECTIONS].sort()).toEqual(["assertions", "sources"]);
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
    const r = await extractionAppend({ projectPath: dir, ...form } as any, LOCAL);
    expect(r.ok).toBe(false);
    const text = (r.errors ?? []).join(" ");
    expect(text).toMatch(/no longer takes/);
    expect(text).toMatch(/`recordIds`.*`documents`.*`absences`/);
    // A caller holding only this writer is not pointed at one it lacks.
    expect(text).not.toContain("research_append");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
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
