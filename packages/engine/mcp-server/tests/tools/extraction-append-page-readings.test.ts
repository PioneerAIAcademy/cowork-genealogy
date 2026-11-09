/**
 * What a read page says (#4286; research-append-tool-spec.md §11.9): with
 * `attachWaitingPages`, `pageReadings` carries what record-structurer found the
 * page adds to or reads differently from its record's index. Code writes each as
 * an assertion on the same source, classified by the real classifier; a reading
 * that disagrees names the index assertion it disputes and carries `[?]`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { runExtractionAppend, EXTRACTION_SECTIONS, type ExtractionBatchResult } from "../../src/tools/extraction-append.js";
import { researchAppend, researchAppendFromCaller, DISPUTES_NOT_CALLERS } from "../../src/tools/research-append.js";
import { getProjectStore } from "../../src/store/project-store.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { waitingPages } from "../../src/utils/waiting-pages.js";
import { classifyReading } from "../../src/utils/record-extract.js";
import { validateProject } from "../../src/validation/validator.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { disputeGroups } from "../../src/utils/page-disputes.js";
import { LOCAL } from "../../src/auth/principal.js";

const ARK = "ark:/61903/3:1:33SQ-GRZ6-P95";
const RECORD = "https://familysearch.org/ark:/61903/1:1:XHRQ-CGX";

/** The 1880 census row the Curtis household's index was read from. */
const INDEX_ROW = {
  recordId: "XHRQ-CGX",
  gedcomx: {
    persons: [
      { id: "p1", principal: true, names: [{ given: "Harriet", surname: "Curtis" }], facts: [{ type: "Census", date: "1880" }] },
    ],
    relationships: [],
    sources: [{ id: "S1", title: "United States Census, 1880", resource_type: "Collection" }],
  },
};

const source = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  gedcomx_source_description_id: "S1",
  citation: "1880 census",
  citation_detail: {
    who: "the enumerated household", what: `Census ${id}`, when_created: "1880", when_accessed: "2026-01-01",
    where: "FamilySearch", where_within: id,
  },
  source_classification: "derivative",
  repository: "FamilySearch",
  access_date: "2026-01-01",
  log_entry_id: "log_001",
  image_ark: ARK,
  ...extra,
});

/** Index assertions, with a classification no table row gives, so a copied
 *  sibling classification would show. */
const indexAssertion = (id: string, factType: string, value: string, sourceId = "src_001") => ({
  id, source_id: sourceId, record_id: RECORD, record_role: "principal", record_persona_id: "p1",
  fact_type: factType, value, information_quality: "primary", informant: "copied sibling",
  informant_proximity: "self", record_basis: "stated", log_entry_id: "log_001", extracted_for_question_ids: ["q_001"],
});

function research(opts: { resultsRef?: boolean; sources?: unknown[]; assertions?: unknown[] } = {}) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [],
    sources: opts.sources ?? [source("src_001")],
    assertions: opts.assertions ?? [indexAssertion("a_001", "name", "Harriet Curtis"), indexAssertion("a_002", "sex", "Male")],
    person_evidence: [],
    log: [{
      id: "log_001", performed: "2026-01-01T00:00:00Z", tool: "record_read", query: { recordId: "XHRQ-CGX" },
      outcome: "positive", results_examined: 1, ...(opts.resultsRef === false ? {} : { results_ref: "results/log_001.json" }),
    }],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

const noReader = { readRecord: async () => { throw new Error("no read expected"); } } as any;

describe("extraction_append pageReadings", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const seed = (doc: unknown) => writeFile(join(dir, "research.json"), JSON.stringify(doc), "utf8");
  const run = (extra: Record<string, unknown>, deps: any = noReader) =>
    runExtractionAppend({ projectPath: dir, attachWaitingPages: true, ...extra } as any, deps, LOCAL) as unknown as Promise<ExtractionBatchResult>;
  const stagePage = async (text = "Curtis, Hattie 14 F daughter") =>
    (await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: {
        query: { ark: ARK },
        results: [{ id: "page", source: { ark: ARK }, content_type: "image/jpeg", size_bytes: 1, model: "m", transcription: text, image_ref: "images/page.jpg" }],
      },
    }))!.resultsRef;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "page-readings-test-"));
    await seed(research());
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [{ id: "S1", title: "Census" }] }), "utf8");
    await getProjectStore().writeJson(dir, "results/log_001.json", { payload: { results: [INDEX_ROW] } });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is refused without attachWaitingPages", async () => {
    await stagePage();
    const r = await runExtractionAppend({ projectPath: dir, pageReadings: [] } as any, noReader, LOCAL);
    expect(r.ok).toBe(false);
    expect(r.errors?.join(" ")).toMatch(/goes with `attachWaitingPages: true` only/);
  });

  it("a confirming page keeps its page and writes no assertion and no log entry", async () => {
    await stagePage();
    const r = await run({ pageReadings: [{ sourceId: "src_001", readings: [] }] });
    expect(r).toMatchObject({ ok: true, attached: 1, readings: 0 });
    const after = await read();
    expect(after.assertions).toHaveLength(2);
    expect(after.log).toHaveLength(1);
    expect(after.sources[0].transcription).toMatch(/Hattie/);
  });

  it("a disagreement is written on the same source, marked [?], naming the index assertion it disputes", async () => {
    await stagePage();
    const r = await run({
      pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "Female", note: "row reads F" }] }],
    });
    expect(r).toMatchObject({ ok: true, attached: 1, readings: 1 });
    expect(r.summary).toMatch(/The index reads sex "Male"; the page reads "Female"/);
    const after = await read();
    const page = after.assertions.find((a: any) => a.disputes_assertion_id === "a_002");
    expect(page).toMatchObject({
      source_id: "src_001", record_id: RECORD, record_role: "principal", fact_type: "sex", value: "Female [?]",
      extracted_for_question_ids: ["q_001"],
    });
    expect(page.record_persona_id).toBeUndefined();
    expect(page.informant_bias_notes).toMatch(/row reads F/);
    expect(after.assertions.find((a: any) => a.id === "a_002")).toEqual(indexAssertion("a_002", "sex", "Male"));
    const pageLog = after.log.find((e: any) => e.id === page.log_entry_id);
    expect(pageLog).toMatchObject({ tool: "image_transcribe" });
    expect(pageLog.query?.ark).toBe(ARK);
    const v = await validateProject(dir);
    expect((v.errors ?? []).filter((e: any) => /assertions/.test(e.path))).toEqual([]);
  });

  it("a new fact is classified by the real classifier, never copied from a sibling assertion", async () => {
    await stagePage();
    await run({ pageReadings: [{ sourceId: "src_001", readings: [{ personAssertionId: "a_001", type: "residence", place: "Ward 3, Troy" }] }] });
    const after = await read();
    const added = after.assertions.find((a: any) => a.fact_type === "residence");
    const cls = classifyReading("census", "principal", "residence", "United States Census, 1880");
    expect(added).toMatchObject({
      value: "Ward 3, Troy", record_role: "principal",
      informant: cls.informant, informant_proximity: cls.informant_proximity, information_quality: cls.information_quality,
    });
    expect(added.informant).not.toBe("copied sibling");
    expect(added.disputes_assertion_id).toBeUndefined();
    expect(added.value).not.toMatch(/\[\?\]/);
  });

  it("a second held record still finds a page that a readings call logged", async () => {
    const doc = research({ sources: [source("src_001"), source("src_002", { log_entry_id: "log_001" })] });
    await seed(doc);
    await stagePage();
    await run({ pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "Female" }] }] });
    const after = await read();
    expect(after.sources[1].transcription).toMatch(/Hattie/);
    const later = { ...after, sources: [...after.sources, source("src_003")] };
    expect((await waitingPages(dir, later)).map((w) => w.sourceId)).toEqual(["src_003"]);
  });

  it("an accepted hint's record, whose entry keeps no index, is read again to classify", async () => {
    await seed(research({ resultsRef: false }));
    await stagePage();
    let reads = 0;
    const reader = {
      readRecord: async () => {
        reads++;
        const staged = await stageSearchResults({ projectPath: dir, tool: "record_read", response: { results: [INDEX_ROW] } });
        return { staged };
      },
    } as any;
    const r = await run({ pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "Female" }] }] }, reader);
    expect(reads).toBe(1);
    expect(r).toMatchObject({ ok: true, readings: 1 });
  });

  it("a page whose index cannot be read is not kept, and stays waiting", async () => {
    await seed(research({ resultsRef: false }));
    await stagePage();
    const r = await run({ pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "Female" }] }] });
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/stays waiting/);
    const after = await read();
    expect(after.sources[0].transcription).toBeUndefined();
    expect(after.assertions).toHaveLength(2);
    expect(await waitingPages(dir, after)).toHaveLength(1);
  });

  describe("a page already kept", () => {
    const kept = () => research({ sources: [source("src_001", { transcription: "Curtis, Hattie 14 F daughter" })] });

    it("refuses a reading that is not the researcher's", async () => {
      await seed(kept());
      const r = await run({ pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "Female" }] }] });
      expect(r.ok).toBe(false);
      expect(r.errors?.join(" ")).toMatch(/already kept, so only a researcher's own reading/);
    });

    it("takes the researcher's own reading, under its own log entry", async () => {
      await seed(kept());
      const r = await run({
        pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_001", type: "name", value: "Hattie Curtis", researcherWords: "It says Hattie, plainly." }] }],
      });
      expect(r).toMatchObject({ ok: true, attached: 0, readings: 1 });
      const after = await read();
      const mine = after.assertions.find((a: any) => a.disputes_assertion_id === "a_001");
      expect(mine.value).toBe("Hattie Curtis");
      expect(mine.informant_bias_notes).toMatch(/It says Hattie, plainly\./);
      expect(after.log.find((e: any) => e.id === mine.log_entry_id)).toMatchObject({ tool: "user_provided" });
    });
  });

  it.each([
    ["an unknown key", { sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "F", record_role: "x" }] }, /unknown key `record_role`/],
    ["both ids", { sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", personAssertionId: "a_001", type: "sex", value: "F" }] }, /exactly one of/],
    ["no reading", { sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex" }] }, /give the page's `value`/],
    ["a type the disputed assertion is not", { sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "age", value: "14" }] }, /a_002 is a sex/],
    ["an unknown assertion", { sourceId: "src_001", readings: [{ disputesAssertionId: "a_099", type: "sex", value: "F" }] }, /a_099 is not a live assertion/],
    ["researcherWords on a new fact", { sourceId: "src_001", readings: [{ personAssertionId: "a_001", type: "age", value: "14", researcherWords: "14" }] }, /only with `disputesAssertionId`/],
    ["an unknown source", { sourceId: "src_009", readings: [] }, /no source src_009/],
  ])("refuses %s and writes nothing", async (_label, entry, message) => {
    await stagePage();
    const r = await run({ pageReadings: [entry] });
    expect(r.ok).toBe(false);
    expect(r.errors?.join(" ")).toMatch(message);
    const after = await read();
    expect(after.sources[0].transcription).toBeUndefined();
    expect(after.assertions).toHaveLength(2);
  });

  it("refuses a dispute of another source's assertion", async () => {
    await seed(research({
      sources: [source("src_001"), source("src_002", { image_ark: undefined })],
      assertions: [indexAssertion("a_001", "name", "Harriet Curtis"), indexAssertion("a_002", "sex", "Male", "src_002")],
    }));
    await stagePage();
    const r = await run({ pageReadings: [{ sourceId: "src_001", readings: [{ disputesAssertionId: "a_002", type: "sex", value: "F" }] }] });
    expect(r.errors?.join(" ")).toMatch(/a_002 is on src_002, not src_001/);
  });
});

describe("research_append and disputes_assertion_id", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "disputes-caller-test-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(research()), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a caller cannot write an assertion at all", async () => {
    const { id: _id, ...entry } = indexAssertion("a_003", "sex", "Female [?]");
    const r: any = await researchAppendFromCaller({
      projectPath: dir, section: "assertions", op: "append", entry: { ...entry, disputes_assertion_id: "a_002" },
    } as any);
    expect(r.ok).toBe(false);
  });

  it("an extraction write without stampDisputes is refused on append", async () => {
    const { id: _id, record_persona_id: _p, ...entry } = indexAssertion("a_003", "sex", "Female [?]");
    const r: any = await researchAppend(
      { projectPath: dir, ops: [{ section: "assertions", op: "append", entry: { ...entry, disputes_assertion_id: "a_002" } }] } as any,
      { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain(DISPUTES_NOT_CALLERS);
  });

  it("and on update, even with stampDisputes", async () => {
    const r: any = await researchAppend(
      { projectPath: dir, ops: [{ section: "assertions", op: "update", entryId: "a_001", fields: { disputes_assertion_id: "a_002" } }] } as any,
      { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append", stampDisputes: true },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain(DISPUTES_NOT_CALLERS);
  });
});

describe("documents mode and a held record's page", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const census = {
    recordType: "census",
    census: { jurisdiction: "United States", year: 1880 },
    documentForm: "verbatim_transcript",
    source: { title: "1880 census, Troy", repository: "FamilySearch" },
    persons: [{ id: "c1", principal: true, gender: "female", names: [{ given: "Hattie", surname: "Curtis" }], facts: [] }],
  };
  const stageAt = async (ark: string) =>
    (await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: {
        query: { ark },
        results: [{ id: "page", source: { ark }, content_type: "image/jpeg", size_bytes: 1, model: "m", transcription: "Curtis, Hattie 14 F", image_ref: "images/page.jpg" }],
      },
    }))!.resultsRef;
  const extract = (ref: string) =>
    runExtractionAppend(
      { projectPath: dir, documents: [{ recordId: "capture:curtis-page", document: census, transcriptionRef: ref }] } as any,
      noReader,
      LOCAL,
    ) as unknown as Promise<ExtractionBatchResult>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "held-page-docs-test-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(research()), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a staged page of a held record, naming attachWaitingPages", async () => {
    const r = await extract(await stageAt(ARK));
    expect(r.records[0].status).toBe("refused");
    expect(r.records[0].summary).toMatch(/record already held \(src_001\).*attachWaitingPages: true, pageReadings/);
    expect((await read()).sources).toHaveLength(1);
  });

  it("refuses a logged page of a held record", async () => {
    const staged = await stageAt(ARK);
    const logged: any = await researchLogAppend({
      projectPath: dir, tool: "image_transcribe", outcome: "positive", resultsExamined: 1, stagedResultsRef: staged,
    } as any);
    expect(logged.ok).toBe(true);
    expect((await extract(logged.resultsRef)).records[0].status).toBe("refused");
    expect((await extract(staged)).records[0].status).toBe("refused");
  });

  it("does not refuse a read whose i= picks the image, which never joins a held record", async () => {
    const r = await extract(await stageAt(`${ARK}?i=15`));
    expect(r.records[0].status).toBe("extracted");
  });

  it("does not refuse a page of an image no held record shows", async () => {
    const r = await extract(await stageAt("ark:/61903/3:1:33S7-9YBC-V6L"));
    expect(r.records[0].status).toBe("extracted");
  });
});

describe("re-extracting a record whose page has spoken", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const ROW = { ...INDEX_ROW, gedcomx: { ...INDEX_ROW.gedcomx, persons: [{ ...INDEX_ROW.gedcomx.persons[0], gender: "Male" }] } };
  const reader = {
    readRecord: async () => ({
      staged: await stageSearchResults({ projectPath: dir, tool: "record_read", response: { results: [ROW] } }),
    }),
  } as any;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "page-reextract-test-"));
    const doc: any = research();
    doc.log.push({
      id: "log_002", performed: "2026-01-02T00:00:00Z", tool: "image_transcribe", query: { ark: ARK },
      outcome: "positive", results_examined: 1,
    });
    doc.assertions.push({
      ...indexAssertion("a_003", "sex", "Female [?]"), record_persona_id: undefined, log_entry_id: "log_002",
      disputes_assertion_id: "a_002",
    });
    delete doc.assertions[2].record_persona_id;
    await writeFile(join(dir, "research.json"), JSON.stringify(doc), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
    await getProjectStore().writeJson(dir, "results/log_001.json", { payload: { results: [ROW] } });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("retires the index assertions, leaves the page's reading live, and the dispute follows the successor", async () => {
    const r = await runExtractionAppend({ projectPath: dir, recordIds: [RECORD], reextract: true } as any, reader, LOCAL);
    expect(r.records[0]?.status, JSON.stringify(r)).toBe("extracted");
    const after = await read();
    const byId = new Map<string, any>(after.assertions.map((a: any) => [a.id, a]));
    expect(byId.get("a_003").superseded_by ?? null).toBeNull();
    expect(typeof byId.get("a_002").superseded_by).toBe("string");
    const successor = byId.get("a_002").superseded_by;
    expect(successor).toMatch(/^a_/);
    const groups = disputeGroups(after);
    expect(groups.get(successor)?.disputers.map((d: any) => d.id)).toEqual(["a_003"]);
  });
});
