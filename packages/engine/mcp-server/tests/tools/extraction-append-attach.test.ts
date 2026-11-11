/**
 * Keeping a read page: `waitingPages` joins a held record's source to a staged
 * `image_transcribe` read, and `extraction_append({ attachWaitingPages })` copies
 * the page onto that source (research-append-tool-spec.md §11.9).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { buildExtractionOps, runExtractionAppend, type ExtractionBatchResult } from "../../src/tools/extraction-append.js";
import { projectContext } from "../../src/tools/project-context.js";
import { getProjectStore } from "../../src/store/project-store.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { pageKey, waitingPages } from "../../src/utils/waiting-pages.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { validateProject } from "../../src/validation/validator.js";
import { LOCAL } from "../../src/auth/principal.js";

const refused = vi.hoisted(() => new Set<string>());
vi.mock("../../src/tools/research-append.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/research-append.js")>();
  return {
    ...actual,
    researchAppend: async (input: any, options: any) =>
      input.ops?.some((op: any) => refused.has(op.entryId))
        ? { ok: false, errors: ["refused"] }
        : actual.researchAppend(input, options),
  };
});

const noReader = { readRecord: async () => { throw new Error("no reads when attaching"); } } as any;

const ARK = "ark:/61903/3:1:33SQ-GRZ6-P95";
const OTHER = "ark:/61903/3:1:33S7-9YBC-V6L";

const source = (id: string, extra: Record<string, unknown>) => ({
  id,
  gedcomx_source_description_id: "S1",
  citation: "1800 census",
  citation_detail: {
    who: "the enumerated household", what: `Census ${id}`, when_created: "1800", when_accessed: "2026-01-01",
    where: "FamilySearch", where_within: id,
  },
  source_classification: "derivative",
  repository: "FamilySearch",
  access_date: "2026-01-01",
  log_entry_id: "log_001",
  ...extra,
});

function research(sources: unknown[]) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [], sources, assertions: [], person_evidence: [],
    log: [{ id: "log_001", performed: "2026-01-01T00:00:00Z", tool: "record_read", query: { recordId: "XHRQ-CGX" }, outcome: "positive", results_examined: 1 }],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

describe("waiting pages", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const seed = (sources: unknown[]) => writeFile(join(dir, "research.json"), JSON.stringify(research(sources)), "utf8");
  const attach = () =>
    runExtractionAppend({ projectPath: dir, attachWaitingPages: true } as any, noReader, LOCAL) as unknown as Promise<ExtractionBatchResult>;
  const listed = async () => waitingPages(dir, await read());

  const stagePage = async (query: Record<string, unknown>, row: Record<string, unknown> = {}) =>
    (await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: {
        query,
        results: [{
          id: "page", source: query, content_type: "image/jpeg", size_bytes: 1, model: "m",
          transcription: "Paul Raymond 1 1 0 3 1", image_ref: "images/page.jpg", ...row,
        }],
      },
    }))!.resultsRef;

  const logPage = async (ref: string, query?: Record<string, unknown>) => {
    const r: any = await researchLogAppend({
      projectPath: dir, tool: "image_transcribe", outcome: "positive", resultsExamined: 1, stagedResultsRef: ref,
      ...(query ? { query } : {}),
    } as any);
    expect(r.ok).toBe(true);
    return r.resultsRef as string;
  };

  beforeEach(async () => {
    refused.clear();
    dir = await mkdtemp(join(tmpdir(), "attach-test-"));
    await seed([]);
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [{ id: "S1", title: "Census" }] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("pageKey", () => {
    it("ignores cc, which selects no image", () => {
      expect(pageKey(`${ARK}?cc=1923888`)).toBe(pageKey(ARK));
    });
    it("names no page when i or groupId picks one of several", () => {
      expect(pageKey(`${ARK}?i=15&cc=1923888`)).toBeNull();
      expect(pageKey(`${ARK}?groupId=4`)).toBeNull();
    });
  });

  it("an indexed record's source records its image", () => {
    const { ops } = buildExtractionOps(
      {
        recordId: "ark:/61903/1:1:XHRQ-CGX",
        gedcomx: {
          persons: [{ id: "XHRQ-CGX", names: [{ given: "Paul", surname: "Raymond" }], facts: [] }],
          sources: [{ id: "i", url: `https://familysearch.org/${ARK}?cc=1`, resource_type: "DigitalArtifact" }],
        },
      } as any,
      { logEntryId: "log_001" },
    );
    expect((ops[0] as any).entry.image_ark).toBe(`${ARK}?cc=1`);
  });

  it("a record with no image gets no image_ark", () => {
    const { ops } = buildExtractionOps(
      { recordId: "ark:/61903/1:1:XHRQ-CGX", gedcomx: { persons: [{ id: "XHRQ-CGX", names: [], facts: [] }], sources: [] } } as any,
      { logEntryId: "log_001" },
    );
    expect((ops[0] as any).entry).not.toHaveProperty("image_ark");
  });

  it("project_context lists a staged page of a held record", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    const ref = await stagePage({ ark: ARK });
    const r: any = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.waitingPages).toEqual([{ sourceId: "src_001", ref, index: [] }]);
  });

  it("project_context lists each waiting page's index: its source's live assertions (#4286)", async () => {
    const doc = research([source("src_001", { image_ark: ARK })]);
    const a = (id: string, more: Record<string, unknown> = {}) => ({
      id, source_id: "src_001", record_id: "XHRQ-CGX", record_role: "child_1", fact_type: "name", value: "Harriet Curtis",
      information_quality: "primary", informant: "x", informant_proximity: "self", record_basis: "stated",
      extracted_for_question_ids: [], ...more,
    });
    doc.assertions = [a("a_001"), a("a_002", { superseded_by: "retracted", superseded_reason: "r" }), a("a_003", { source_id: "src_009" })] as any;
    await writeFile(join(dir, "research.json"), JSON.stringify(doc), "utf8");
    const ref = await stagePage({ ark: ARK });
    const r: any = await projectContext({ projectPath: dir }, LOCAL);
    expect(r.waitingPages).toEqual([
      { sourceId: "src_001", ref, index: [{ assertionId: "a_001", role: "child_1", factType: "name", value: "Harriet Curtis" }] },
    ]);
  });

  it("project_context leaves the key out when nothing waits", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    expect(await projectContext({ projectPath: dir }, LOCAL)).not.toHaveProperty("waitingPages");
  });

  it("a page read before its record was extracted attaches", async () => {
    await stagePage({ ark: ARK });
    await seed([source("src_001", { image_ark: ARK })]);
    expect((await attach()).attached).toBe(1);
  });

  it("a record extracted before its page was read attaches", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK });
    expect((await attach()).attached).toBe(1);
  });

  it("attaching fills the existing source, and writes no second source, no assertion and no log entry", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK });
    const r = await attach();
    expect(r.ok).toBe(true);
    expect(r.records).toEqual([]);
    expect(r.summary).toMatch(/Census src_001/);
    expect(r.summary).not.toMatch(/Paul Raymond/);
    const after = await read();
    expect(after.sources).toHaveLength(1);
    expect(after.sources[0]).toMatchObject({ transcription: "Paul Raymond 1 1 0 3 1", image_filename: "images/page.jpg" });
    expect(after.assertions).toEqual([]);
    expect(after.log).toHaveLength(1);
  });

  describe("a logged page", () => {
    it("loses its staged copy, and still attaches", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      const staged = await stagePage({ ark: ARK });
      const ref = await logPage(staged);
      expect(await getProjectStore().exists(dir, staged)).toBe(false);
      expect(await listed()).toEqual([{ sourceId: "src_001", ref, index: [] }]);
      const r = await attach();
      expect(r).toMatchObject({ ok: true, attached: 1 });
      const after = await read();
      expect(after.sources[0]).toMatchObject({ transcription: "Paul Raymond 1 1 0 3 1", image_filename: "images/page.jpg" });
      expect(after.sources).toHaveLength(1);
      expect(after.assertions).toEqual([]);
    });

    it("is found when the log names the page as imageArk", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      await logPage(await stagePage({ ark: ARK }), { imageArk: ARK });
      expect(await listed()).toHaveLength(1);
    });

    it("attaches to a record extracted after it was logged", async () => {
      const ref = await logPage(await stagePage({ ark: ARK }));
      const doc = await read();
      doc.sources.push(source("src_001", { image_ark: ARK }));
      await getProjectStore().writeJson(dir, "research.json", doc);
      expect(await listed()).toEqual([{ sourceId: "src_001", ref, index: [] }]);
    });

    it("is listed, attached, then not listed", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      await logPage(await stagePage({ ark: ARK }));
      await attach();
      expect(await listed()).toEqual([]);
      expect((await attach()).attached).toBe(0);
    });

    it("that holds no text is not listed, so it cannot be listed forever", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      await logPage(await stagePage({ ark: ARK }, { transcription: "" }));
      expect(await listed()).toEqual([]);
    });

    it("whose sidecar is gone is not listed", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      const ref = await logPage(await stagePage({ ark: ARK }));
      await getProjectStore().remove(dir, ref);
      expect(await listed()).toEqual([]);
    });

    it("wins over a staged read of the same page", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      const ref = await logPage(await stagePage({ ark: ARK }, { transcription: "logged reading" }));
      await stagePage({ ark: ARK }, { transcription: "staged reading" });
      expect((await listed())[0].ref).toBe(ref);
    });

    it("that came first wins over a later logged read", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      const first = await logPage(await stagePage({ ark: ARK }, { transcription: "first reading" }));
      await logPage(await stagePage({ ark: ARK }, { transcription: "second reading" }));
      expect((await listed())[0].ref).toBe(first);
    });

    it("with no text gives way to a later one that has it", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      await logPage(await stagePage({ ark: ARK }, { transcription: "" }));
      const good = await logPage(await stagePage({ ark: ARK }));
      expect((await listed())[0].ref).toBe(good);
    });

    it("with i= does not attach", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      await logPage(await stagePage({ ark: `${ARK}?i=15` }));
      expect(await listed()).toEqual([]);
    });

    it("of another image does not attach, and its sidecar is not read", async () => {
      await seed([source("src_001", { image_ark: ARK })]);
      const ref = await logPage(await stagePage({ ark: OTHER }));
      const spy = vi.spyOn(getProjectStore(), "readText");
      expect(await listed()).toEqual([]);
      expect(spy.mock.calls.map((c) => c[1])).not.toContain(ref);
      spy.mockRestore();
    });

    it("is matched only on an image_transcribe entry", async () => {
      const doc = research([source("src_001", { image_ark: ARK })]);
      doc.log.push({ id: "log_002", performed: "2026-01-01T00:00:00Z", tool: "image_read", query: { ark: ARK }, results_ref: "results/log_002.json", outcome: "positive", results_examined: 1 } as any);
      await getProjectStore().writeJson(dir, "results/log_002.json", { payload: { results: [{ transcription: "text" }] } });
      await writeFile(join(dir, "research.json"), JSON.stringify(doc), "utf8");
      expect(await listed()).toEqual([]);
    });
  });

  it("a read carrying lookingFor still matches", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK, lookingFor: "Paul Raymond" });
    expect(await listed()).toHaveLength(1);
  });

  it("the context query on either side does not stop a match", async () => {
    await seed([source("src_001", { image_ark: `${ARK}?cc=1` })]);
    await stagePage({ ark: `${ARK}?cc=2` });
    expect(await listed()).toHaveLength(1);
  });

  it("a read of the same ARK with a different i= does not attach", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: `${ARK}?i=15&cc=1923888` });
    expect(await listed()).toEqual([]);
    expect((await attach()).attached).toBe(0);
  });

  it("a read and a source with the same i= do not attach, since the read may have fallen back to the bare URL", async () => {
    await seed([source("src_001", { image_ark: `${ARK}?i=15` })]);
    await stagePage({ ark: `${ARK}?i=15` });
    expect(await listed()).toEqual([]);
  });

  it("a source with i= takes no bare read", async () => {
    await seed([source("src_001", { image_ark: `${ARK}?i=15` })]);
    await stagePage({ ark: ARK });
    expect(await listed()).toEqual([]);
  });

  it("the oldest read wins, so a repeat read cannot displace the first", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    const first = await stagePage({ ark: ARK }, { transcription: "first reading" });
    await new Promise((r) => setTimeout(r, 5));
    await stagePage({ ark: ARK }, { transcription: "second reading" });
    expect((await listed())[0].ref).toBe(first);
    await attach();
    expect((await read()).sources[0].transcription).toBe("first reading");
  });

  it("a page of two held records attaches to both", async () => {
    await seed([source("src_001", { image_ark: ARK }), source("src_002", { image_ark: ARK })]);
    await stagePage({ ark: ARK });
    expect((await attach()).attached).toBe(2);
    expect((await read()).sources.map((s: any) => s.transcription)).toEqual(["Paul Raymond 1 1 0 3 1", "Paul Raymond 1 1 0 3 1"]);
  });

  it("a truncated page carries transcription_truncated, from a process that did not read it", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK }, { truncated: true, image_ref: "images/capped.jpg" });
    await attach();
    expect((await read()).sources[0].transcription_truncated).toBe(true);
  });

  it("a page is listed, attached, then not listed", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK });
    expect(await listed()).toHaveLength(1);
    await attach();
    expect(await listed()).toEqual([]);
    expect((await attach()).attached).toBe(0);
  });

  it("a second record extracted later still finds the page", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK });
    await attach();
    const doc = await read();
    doc.sources.push(source("src_002", { image_ark: ARK }));
    await getProjectStore().writeJson(dir, "research.json", doc);
    expect((await attach()).attached).toBe(1);
  });

  it("a source that already holds a transcription is not listed, and keeps its text", async () => {
    await seed([source("src_001", { image_ark: ARK, transcription: "read by hand" })]);
    await stagePage({ ark: ARK });
    expect(await listed()).toEqual([]);
    await attach();
    expect((await read()).sources[0].transcription).toBe("read by hand");
  });

  it("an unreadable page leaves the others attached, and names itself", async () => {
    await seed([source("src_001", { image_ark: ARK }), source("src_002", { image_ark: OTHER })]);
    await stagePage({ ark: ARK }, { transcription: "" });
    await stagePage({ ark: OTHER });
    const r = await attach();
    expect(r.ok).toBe(true);
    expect(r.attached).toBe(1);
    expect(r.errors?.join(" ")).toMatch(/read it again with image_transcribe/);
    expect((await read()).sources.map((s: any) => s.transcription ?? null)).toEqual([null, "Paul Raymond 1 1 0 3 1"]);
  });

  it("a refused write on one page leaves the others attached, and a later call retries it", async () => {
    await seed([source("src_001", { image_ark: ARK }), source("src_002", { image_ark: OTHER })]);
    await stagePage({ ark: ARK });
    await stagePage({ ark: OTHER });
    refused.add("src_001");
    const r = await attach();
    expect(r).toMatchObject({ ok: true, attached: 1 });
    expect(r.errors?.join(" ")).toMatch(/src_001 was not kept: refused/);
    expect((await read()).sources.map((s: any) => s.transcription ?? null)).toEqual([null, "Paul Raymond 1 1 0 3 1"]);
    refused.clear();
    expect((await attach()).attached).toBe(1);
  });

  it("is ok: false when something waited and nothing was kept, and says so", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ ark: ARK }, { transcription: "" });
    const r = await attach();
    expect(r.ok).toBe(false);
    expect(r.attached).toBe(0);
    expect(r.summary).toMatch(/^No page was kept\./);
  });

  it("an ARK with no held record lists nothing, and nothing to attach is ok", async () => {
    await seed([source("src_001", { image_ark: OTHER })]);
    await stagePage({ ark: ARK });
    expect(await listed()).toEqual([]);
    expect(await attach()).toMatchObject({ ok: true, attached: 0, summary: "No read pages were waiting to be kept." });
  });

  it("an imageId read lists nothing", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    await stagePage({ imageId: "004022578_00190" });
    expect(await listed()).toEqual([]);
  });

  it("a source with no image_ark never waits", async () => {
    await seed([source("src_001", {})]);
    await stagePage({ ark: ARK });
    expect(await listed()).toEqual([]);
  });

  it("a source's image_ark must be a string", async () => {
    await seed([source("src_001", { image_ark: 5 })]);
    const r = await validateProject(dir);
    expect(JSON.stringify(r.errors)).toMatch(/image_ark must be a string/);
  });

  it("a source's image_ark passes validation", async () => {
    await seed([source("src_001", { image_ark: ARK })]);
    const r = await validateProject(dir);
    expect(JSON.stringify(r.errors)).not.toMatch(/image_ark/);
  });

  it("refuses anything but true, and refuses a second mode", async () => {
    expect(await runExtractionAppend({ projectPath: dir, attachWaitingPages: false } as any, noReader, LOCAL)).toMatchObject({ ok: false });
    const both = await runExtractionAppend({ projectPath: dir, attachWaitingPages: true, recordIds: ["X"] } as any, noReader, LOCAL);
    expect(both.ok).toBe(false);
    expect(both.errors?.[0]).toMatch(/together/);
    const redo = await runExtractionAppend({ projectPath: dir, attachWaitingPages: true, reextract: true } as any, noReader, LOCAL);
    expect(redo.ok).toBe(false);
  });
});
