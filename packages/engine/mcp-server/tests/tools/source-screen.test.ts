/**
 * source_screen: one verdict per attachment, read off the project person mode
 * built. Every project here is built by `extraction_append({ personId })` over
 * captured records, so the tool reads the shape that ships: an imported tree
 * whose facts cite no source, with person-level refs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, readdir } from "fs/promises";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { runExtractionAppend } from "../../src/tools/extraction-append.js";
import { sourceScreenTool, type SourceScreenOptions } from "../../src/tools/source-screen.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { arkToBareId } from "../../src/utils/ark.js";
import { LOCAL } from "../../src/auth/principal.js";
import { configureTranscriptionCap, withTranscriptionSlot, __resetTranscriptionSlotsForTests } from "../../src/utils/ocr.js";
import { writeProjectFile } from "../helpers/project-files.js";
import type { SourceScreenAttachment, SourceScreenResult } from "../../src/types/source-screen.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-extract");
const element = (n: string) => JSON.parse(readFileSync(join(FIX, `${n}.json`), "utf8")).element;

// The 1870 census: John Boyer p_260900945 (MZGS-1B7, b. 1845 PA), Anna p_260900946 (MZGS-1BW).
const CENSUS = () => element("census-1870-no-relationship-column");
// The 1880 census with a relationship column: Charles Miller head (MNH8-SHT), Theresa wife (MNH8-SHY).
const CENSUS_1880 = () => element("census-1880-with-relationship-column");

/** The captured death record, re-cut as John Boyer's: one persona, its own ARK. */
function deathOf(bare: string, given: string, surname: string, birth: { date: string; place: string }, death = { date: "1900", place: "Carbon, Pennsylvania, United States" }) {
  const el = structuredClone(element("death"));
  el.recordId = bare;
  const p = el.gedcomx.persons[0];
  p.id = `p_${bare}`;
  p.ark = `ark:/61903/1:1:${bare}`;
  p.names[0].given = given;
  p.names[0].surname = surname;
  for (const f of p.facts) {
    if (f.type === "Birth") Object.assign(f, { date: birth.date, standard_date: birth.date, place: birth.place });
    if (f.type === "Death") Object.assign(f, { date: death.date, standard_date: death.date, place: death.place });
    if (f.type === "Residence") f.place = "Carbon, Pennsylvania";
  }
  el.indexFields = { [p.id]: { age: "55" } };
  return el;
}

const url = (bare: string) => `https://familysearch.org/ark:/61903/1:1:${bare}`;
const PROJECT = {
  project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
  questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [],
  conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
};

/** A live record_read: any persona's ARK returns the whole record, staged. */
const reader = (els: any[]) => ({
  readRecord: async ({ recordId, projectPath }: { recordId: string; projectPath?: string }) => {
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

/** The import's shape: facts and names cite no source; the attachments hang on the person. */
const person = (id: string, given: string, surname: string, gender: string, refs: string[], facts: any[] = []) => ({
  id, gender,
  names: [{ id: `${id}-N1`, given, surname }],
  facts: facts.map((f, i) => ({ id: `${id}-F${i + 1}`, ...f })),
  sources: refs.map((ref) => ({ ref })),
});
const JOHN = (refs: string[], facts = [{ type: "Birth", date: "1845", place: "Pennsylvania" }]) => person("I1", "John", "Boyer", "Male", refs, facts);

/** A matcher stub: `${pid}|${personaId}` -> score; 0.95 for anything unnamed. */
function matcher(scores: Record<string, number> = {}, calls: any[][] = []) {
  return vi.fn(async (pairs: any[]) => {
    calls.push(pairs);
    return {
      scorer: "familysearch" as const, model: null, floors: { thinSubject: 0.01, realNegative: 0.01 },
      results: pairs.map((p) => ({ score: scores[`${p.pid}|${p.personaId}`] ?? 0.95 })),
    };
  });
}

describe("source_screen", () => {
  let dir: string;
  const writeTree = (persons: any[], sources: any[], relationships: any[] = []) =>
    writeProjectFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons, relationships, sources }));
  const build = async (personId: string, els: any[]) => {
    const r = await runExtractionAppend({ projectPath: dir, personId } as any, reader(els) as any, LOCAL);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r;
  };
  const screen = async (opts: SourceScreenOptions = {}, personId = "I1") => {
    const r = await sourceScreenTool({ projectPath: dir, personId }, LOCAL, { imageTranscribe: vi.fn(async () => { throw new Error("no OCR in this test"); }) as any, ...opts });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r as SourceScreenResult;
  };
  const row = (r: SourceScreenResult, sid: string) => r.attachments.find((a) => a.sourceId === sid) as SourceScreenAttachment;

  const S1 = { id: "S1", title: "United States Census, 1870", url: url("MZGS-1B7") };
  const S2 = { id: "S2", title: "Ohio death", url: url("DDDD-111") };
  const DEATH_OK = () => deathOf("DDDD-111", "John", "Boyer", { date: "1845", place: "Pennsylvania" });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "source-screen-test-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(PROJECT), "utf8");
    __resetTranscriptionSlotsForTests();
  });
  afterEach(async () => {
    __resetTranscriptionSlotsForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("fine: two attachments that agree with the person and score clear", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), DEATH_OK()]);
    const r = await screen({ matchPairs: matcher() });
    expect(r.attachments.map((a) => a.verdict)).toEqual(["fine", "fine"]);
    expect(r.counts).toEqual({ fine: 2 });
    expect(row(r, "S1").recordId).toBe("ark:/61903/1:1:MZGS-1B7");
    expect(row(r, "S1").personaId).toBe("p_260900945");
  });

  it("misattributed: a leave-one-out score below the threshold", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), DEATH_OK()]);
    const r = await screen({ matchPairs: matcher({ "I1|p_DDDD-111": 0.2 }) });
    expect(row(r, "S2").verdict).toBe("misattributed");
    expect(row(r, "S2").reasons.join(" ")).toMatch(/^a: leave-one-out score 0\.20/);
    expect(row(r, "S1").verdict).toBe("fine");
  });

  it("misattributed: a record whose facts would bring an impossible warning (b)", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), deathOf("DDDD-111", "John", "Boyer", { date: "1845", place: "Pennsylvania" }, { date: "1800", place: "Carbon, Pennsylvania, United States" })]);
    const r = await screen({ matchPairs: matcher() });
    expect(row(r, "S2").signals.b!.impossible.length).toBeGreaterThan(0);
    expect(row(r, "S2").verdict).toBe("misattributed");
    expect(row(r, "S1").verdict).toBe("fine");
  });

  it("weak: a score in the grey band", async () => {
    await writeTree([JOHN(["S1"])], [S1]);
    await build("I1", [CENSUS()]);
    const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.6 }) });
    expect(row(r, "S1").verdict).toBe("weak");
    expect(row(r, "S1").signals.a).toEqual({ score: 0.6, band: "grey" });
  });

  it("scores the record against the person minus what only that record supports", async () => {
    // The death record alone supports the death fact; the birth is held by both.
    await writeTree([JOHN(["S1", "S2"], [
      { type: "Birth", date: "1845", place: "Pennsylvania" },
      { type: "Death", date: "1900", place: "Carbon, Pennsylvania" },
    ])], [S1, S2]);
    await build("I1", [CENSUS(), DEATH_OK()]);
    const calls: any[][] = [];
    await screen({ matchPairs: matcher({}, calls) });
    const forDeath = calls[0].find((p: any) => p.personaId === "p_DDDD-111");
    const forCensus = calls[0].find((p: any) => p.personaId === "p_260900945");
    const types = (p: any) => p.tree.persons.find((x: any) => x.id === "I1").facts.map((f: any) => f.type);
    expect(types(forDeath)).toEqual(["Birth"]);
    expect(types(forCensus)).toEqual(["Birth", "Death"]);
    expect(calls).toHaveLength(1);
  });

  it("contradicts: two attachments whose births disagree, each naming the other", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), deathOf("DDDD-111", "John", "Boyer", { date: "1860", place: "Jackson Co., Ohio" })]);
    const r = await screen({ matchPairs: matcher() });
    expect(row(r, "S1")).toMatchObject({ verdict: "contradicts", contradicts: ["S2"] });
    expect(row(r, "S2")).toMatchObject({ verdict: "contradicts", contradicts: ["S1"] });
    expect(row(r, "S1").signals.h!.contradicts.map((c) => c.fact).sort()).toEqual(["birth place", "birth year"]);
  });

  it("indexing_error: a flagged attachment whose page shows the tree's value; OCR only for flagged attachments", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), DEATH_OK()]);
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
    const census = research.sources.find((s: any) => s.gedcomx_source_description_id === "S1");
    expect(census.image_ark).toMatch(/^ark:\/61903\/3:1:/);
    const ocr = vi.fn(async (input: any, _p: any, opts: any) => ({ transcription: "x", found: "FOUND" as const, input, opts }));
    const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }), imageTranscribe: ocr as any });
    expect(ocr).toHaveBeenCalledTimes(1);
    expect(ocr.mock.calls[0][0]).toEqual({ ark: census.image_ark, lookingFor: "John Boyer" });
    expect(ocr.mock.calls[0][0]).not.toHaveProperty("projectPath");
    expect(ocr.mock.calls[0][2].ocrTimeoutMs).toBeGreaterThan(0);
    expect(row(r, "S1").verdict).toBe("indexing_error");
    expect(row(r, "S2").verdict).toBe("fine");
  });

  it("an image that does not show the tree's value leaves the attachment misattributed", async () => {
    await writeTree([JOHN(["S1"])], [S1]);
    await build("I1", [CENSUS()]);
    const ocr = vi.fn(async () => ({ transcription: "x", found: "NOT FOUND" as const }));
    const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }), imageTranscribe: ocr as any });
    expect(row(r, "S1").verdict).toBe("misattributed");
    expect(row(r, "S1").signals.e).toEqual({ lookingFor: "John Boyer", found: "NOT FOUND" });
  });

  it("checks: leaving a check out removes its signal and its verdict", async () => {
    await writeTree([JOHN(["S1"])], [S1]);
    await build("I1", [CENSUS()]);
    const all = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }) });
    expect(row(all, "S1").verdict).toBe("misattributed");
    const without = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }), checks: ["b", "c", "d", "e", "g", "h"] });
    expect(row(without, "S1").verdict).toBe("fine");
    expect(row(without, "S1").signals).not.toHaveProperty("a");
  });

  it("d: a low score on a name variant is weak, not misattributed", async () => {
    await writeTree([person("I1", "Johann", "Boyer", "Male", ["S1"], [{ type: "Birth", date: "1845", place: "Pennsylvania" }])], [S1]);
    await build("I1", [CENSUS()]);
    const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.3 }) });
    expect(row(r, "S1").signals.d).toEqual({ relation: "variant", recordName: "John Boyer" });
    expect(row(r, "S1").verdict).toBe("weak");
  });

  it("g: a record failing for another tree person it is linked to is flagged", async () => {
    const S3 = { id: "S3", title: "census", url: url("MZGS-1BW") };
    await writeTree(
      [JOHN(["S1"]), person("I2", "Anna", "Boyer", "Female", ["S3"], [{ type: "Birth", date: "1849", place: "Pennsylvania" }])],
      [S1, S3],
    );
    await build("I1", [CENSUS()]);
    const r = await screen({ matchPairs: matcher({ "I2|p_260900946": 0.1 }) });
    expect(row(r, "S1").verdict).toBe("misattributed");
    expect(row(r, "S1").signals.g!.failing).toEqual([{ personId: "I2", personaId: "p_260900946", score: 0.1 }]);
  });

  it("c: a record that calls the tree's mother the subject's wife is misattributed", async () => {
    const C1 = { id: "S1", title: "1880", url: url("MNH8-SHT") };
    const C2 = { id: "S2", title: "1880", url: url("MNH8-SHY") };
    await writeTree(
      [
        person("I1", "Charles", "Miller", "Male", ["S1"], [{ type: "Birth", date: "1832", place: "France" }]),
        person("I2", "Theresa", "Miller", "Female", ["S2"], [{ type: "Birth", date: "1805", place: "Germany" }]),
      ],
      [C1, C2],
      [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    );
    await build("I1", [CENSUS_1880()]);
    const r = await screen({ matchPairs: matcher() });
    expect(row(r, "S1").verdict).toBe("misattributed");
    expect(row(r, "S1").signals.b).toEqual({ impossible: [], implausible: [] });
    expect(row(r, "S1").reasons).toEqual([expect.stringMatching(/^c: the record states I2 is spouse of I1/)]);
  });

  it("KW8N-2TB: a census that states no relationship gives no role, so a 'Household of' title flags nothing", async () => {
    // Blanche (2) is indexed first with no relationship to head; the title names her household.
    const el = structuredClone(CENSUS());
    const [first, second] = el.gedcomx.persons;
    Object.assign(first.names[0], { given: "Blanche", surname: "Gibson" });
    first.gender = "Female";
    for (const f of first.facts) if (f.type === "Birth") Object.assign(f, { date: "1917", standard_date: "1917", place: "Colorado" });
    for (const f of first.facts) if (f.type === "Census") Object.assign(f, { date: "1920", standard_date: "1920" });
    const { relationshipToHead: _none, ...firstFields } = el.indexFields[first.id];
    el.indexFields[first.id] = { ...firstFields, age: "2 years" };
    el.gedcomx.sources[0].title = "Household of Blanche Gibson";
    await writeTree(
      [
        person("I1", "Blanche", "Gibson", "Female", ["S1"], [{ type: "Birth", date: "1918", place: "Colorado" }]),
        person("I2", "Sam", "Gibson", "Male", []),
      ],
      [S1],
      [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
    );
    await build("I1", [el]);
    const r = await screen({ matchPairs: matcher() });
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
    expect(research.assertions.some((a: any) => a.fact_type === "relationship")).toBe(false);
    expect(row(r, "S1").verdict).toBe("fine");
    expect(row(r, "S1").signals.c!.disagreements).toEqual([]);
  });

  describe("not scored", () => {
    it("unindexed: an attachment that is not a 1:1 record", async () => {
      const IMG = { id: "S9", title: "image", url: "https://familysearch.org/ark:/61903/3:1:33SQ-GRZ6-P95" };
      await writeTree([JOHN(["S1", "S9"])], [S1, IMG]);
      await build("I1", [CENSUS()]);
      const r = await screen({ matchPairs: matcher() });
      expect(row(r, "S9")).toMatchObject({ verdict: "not_scored", recordId: null });
      expect(row(r, "S9").reasons[0]).toMatch(/^unindexed:/);
      expect(r.counts).toEqual({ fine: 1, not_scored: 1 });
    });

    it("unreadable: a record person mode could not read", async () => {
      await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
      await runExtractionAppend({ projectPath: dir, personId: "I1" } as any, reader([CENSUS()]) as any, LOCAL);
      const r = await screen({ matchPairs: matcher() });
      expect(row(r, "S2").reasons[0]).toMatch(/^unreadable:/);
      expect(row(r, "S1").verdict).toBe("fine");
    });

    it("reused_hint_no_persona: the record was read but no persona carries the attachment's ARK", async () => {
      const HINT = { id: "S5", title: "hint", url: url("ZZZZ-ZZZ") };
      await writeTree([JOHN(["S1", "S5"])], [S1, HINT]);
      await build("I1", [CENSUS(), { ...element("census-1850-no-relationship-column"), recordId: "ZZZZ-ZZZ" }]);
      const r = await screen({ matchPairs: matcher() });
      expect(row(r, "S5").reasons[0]).toMatch(/^reused_hint_no_persona:/);
    });

    it("ambiguous_party: a relationship-level source whose other party has no known gender", async () => {
      const C1 = { id: "S1", title: "1880", url: url("MNH8-SHT") };
      const W = { id: "S4", title: "1880", url: url("MNH8-SHY") };
      await writeTree(
        [person("I1", "Charles", "Miller", "Male", ["S1"], [{ type: "Birth", date: "1832", place: "France" }]), person("I2", "Theresa", "Miller", "Unknown", [])],
        [C1, W],
        [{ id: "R1", type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: "S4" }] }],
      );
      await build("I1", [CENSUS_1880()]);
      const r = await screen({ matchPairs: matcher() });
      expect(row(r, "S4")).toMatchObject({ level: "relationship", verdict: "not_scored" });
      expect(row(r, "S4").reasons[0]).toMatch(/^ambiguous_party: the persona of party I2 \(no_gender\)/);
    });

    it("unlinked: a persona two tree persons claim is linked to neither", async () => {
      await writeTree([JOHN(["S1"]), person("I3", "John", "Boyer", "Male", ["S1"])], [S1]);
      await build("I1", [CENSUS()]);
      const r = await screen({ matchPairs: matcher() });
      expect(row(r, "S1").reasons[0]).toMatch(/^unlinked:/);
    });
  });

  it("screens an attachment whose attachment link was superseded by a checked link", async () => {
    await writeTree([JOHN(["S1"])], [S1]);
    await build("I1", [CENSUS()]);
    const p = join(dir, "research.json");
    const research = JSON.parse(await readFile(p, "utf8"));
    const n = research.person_evidence.length;
    research.person_evidence = research.person_evidence.flatMap((pe: any, i: number) => {
      const next = `pe_${String(n + i + 1).padStart(3, "0")}`;
      return [
        { ...pe, superseded_by: next },
        { ...pe, id: next, confidence: "probable", match_score: 0.97, rationale: "Checked against the tree." },
      ];
    });
    await writeProjectFile(p, JSON.stringify(research));
    const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.2 }) });
    expect(row(r, "S1").verdict).toBe("misattributed");
  });

  it("refuses, naming the call, when person mode has not run", async () => {
    await writeTree([JOHN(["S1"])], [S1]);
    const r: any = await sourceScreenTool({ projectPath: dir, personId: "I1" }, LOCAL, { matchPairs: matcher() });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/extraction_append\(\{ projectPath, personId: "I1" \}\)/);
  });

  it("answers no_project outside a project", async () => {
    const empty = await mkdtemp(join(tmpdir(), "source-screen-empty-"));
    try {
      const r: any = await sourceScreenTool({ projectPath: empty, personId: "I1" }, LOCAL);
      expect(r).toMatchObject({ ok: false, reason: "no_project" });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("is read-only: no project file changes", async () => {
    await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
    await build("I1", [CENSUS(), DEATH_OK()]);
    const snapshot = async () => {
      const out: Record<string, string> = {};
      const walk = async (rel: string) => {
        for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
          const r = join(rel, e.name);
          if (e.isDirectory()) await walk(r);
          else out[r] = await readFile(join(dir, r), "utf8");
        }
      };
      await walk("");
      return out;
    };
    const before = await snapshot();
    const ocr = vi.fn(async () => ({ transcription: "x", found: "FOUND" as const }));
    await screen({ matchPairs: matcher({ "I1|p_DDDD-111": 0.1 }), imageTranscribe: ocr as any });
    expect(ocr).toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  describe("time budget", () => {
    it("an image read unfinished at the deadline is not_run: budget, and the call returns", async () => {
      await writeTree([JOHN(["S1"])], [S1]);
      await build("I1", [CENSUS()]);
      const slow = vi.fn(() => new Promise<any>(() => {}));
      const t0 = Date.now();
      const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }), imageTranscribe: slow as any, deadlineMs: 300 });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(row(r, "S1").signals.e).toEqual({ not_run: "budget" });
      expect(row(r, "S1").verdict).toBe("misattributed");
      expect((slow.mock.calls[0] as any[])[2].ocrTimeoutMs).toBeLessThanOrEqual(300);
    });

    it("a transcription slot refused is not_run with the slot reason", async () => {
      await writeTree([JOHN(["S1", "S2"])], [S1, S2]);
      await build("I1", [CENSUS(), DEATH_OK()]);
      configureTranscriptionCap({ max: 1 });
      const ocr = vi.fn((_i: any) => withTranscriptionSlot(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { transcription: "x", found: "NOT FOUND" as const };
      }));
      const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1, "I1|p_DDDD-111": 0.1 }), imageTranscribe: ocr as any });
      const es = r.attachments.map((a) => a.signals.e as any);
      expect(es.filter((e) => e.found === "NOT FOUND")).toHaveLength(1);
      expect(es.filter((e) => /^slot_limit:/.test(e.not_run ?? ""))).toHaveLength(1);
    });

    it("no OpenRouter key: e is not_run with the key error and the verdict stands", async () => {
      await writeTree([JOHN(["S1"])], [S1]);
      await build("I1", [CENSUS()]);
      const ocr = vi.fn(async () => { throw new Error("No OpenRouter API key is configured."); });
      const r = await screen({ matchPairs: matcher({ "I1|p_260900945": 0.1 }), imageTranscribe: ocr as any });
      expect(row(r, "S1").signals.e).toEqual({ not_run: "error: No OpenRouter API key is configured." });
      expect(row(r, "S1").verdict).toBe("misattributed");
    });
  });
});
