/**
 * extraction_append's `documents` input (spec §11.7): the record-structurer
 * agent's document, validated and extracted in code. The classification values
 * asserted here are the genealogist's rulings (2026-09-29/30), carried exactly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { runExtractionAppend, type ExtractionBatchResult } from "../../src/tools/extraction-append.js";
import { validateStructuredDocument } from "../../src/utils/structured-document.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { LOCAL } from "../../src/auth/principal.js";

const noReader = { readRecord: async () => { throw new Error("no reads on the document path"); } } as any;

function research() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

const src = (title: string) => ({ title, repository: "Utah Digital Newspapers" });

const obituary = {
  recordType: "obituary",
  documentForm: "verbatim_transcript",
  source: src("Obituary of Harold Dean Whitaker, Herald Journal, Logan, 16 Mar 2021"),
  persons: [
    {
      id: "p1", principal: true, gender: "male",
      names: [{ given: "Harold Dean", surname: "Whitaker" }],
      facts: [
        { type: "death", date: "14 March 2021", place: "Logan, Cache, Utah" },
        { type: "birth", date: "8 January 1930", place: "Brigham City, Box Elder, Utah" },
        { type: "residence", date: "2021", place: "Logan, Cache, Utah" },
        { type: "residence", date: "1955", place: "Ogden, Weber, Utah" },
      ],
    },
    { id: "p2", gender: "male", statedRelation: "son", names: [{ given: "Robert", surname: "Whitaker" }], facts: [{ type: "residence", place: "Portland, Oregon" }] },
    { id: "p3", gender: "male", statedRelation: "father", names: [{ given: "Walter", surname: "Whitaker" }], facts: [] },
  ],
  relationships: [
    { type: "parent_child", person1: "p1", person2: "p2" },
    { type: "parent_child", person1: "p3", person2: "p1" },
  ],
};

const census1850 = {
  recordType: "census",
  documentForm: "verbatim_transcript",
  census: { jurisdiction: "United States", year: 1850 },
  source: { title: "1850 U.S. Census, Schuylkill County", repository: "NARA" },
  persons: [
    {
      id: "c1", gender: "male", statedRelation: "head",
      names: [{ given: "Thomas", surname: "Flynn" }],
      facts: [
        { type: "age", value: "32" },
        { type: "birth", date: "1818", place: "Ireland", computed: ["date"] },
      ],
    },
    { id: "c2", gender: "female", statedRelation: "wife", names: [{ given: "Bridget", surname: "Flynn" }], facts: [] },
  ],
};

const marriage = {
  recordType: "marriage",
  documentForm: "verbatim_transcript",
  source: { title: "Marriage license 4872, Schuylkill County", repository: "Schuylkill County Orphans' Court" },
  informant: { name: "Patrick Flynn" },
  persons: [
    { id: "m1", principal: true, gender: "male", names: [{ given: "Patrick", surname: "Flynn" }], facts: [{ type: "marriage", date: "18 October 1870", place: "Pottsville, Schuylkill, Pennsylvania" }] },
    { id: "m2", principal: true, gender: "female", names: [{ given: "Mary", surname: "Brennan" }], facts: [] },
  ],
  relationships: [{ type: "couple", person1: "m1", person2: "m2" }],
};

describe("extraction_append: documents", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const run = (documents: any[]) =>
    runExtractionAppend({ projectPath: dir, documents } as any, noReader, LOCAL) as unknown as Promise<ExtractionBatchResult>;
  const assertionsFor = async (recordId: string) => (await read()).assertions.filter((a: any) => a.record_id === recordId);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-docs-test-"));
    await writeFile(join(dir, "research.json"), JSON.stringify(research()), "utf8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("refusal, writing nothing", () => {
    it("refuses a smuggled classification field", () => {
      const bad = structuredClone(obituary) as any;
      bad.persons[0].facts[0].record_basis = "stated";
      expect(validateStructuredDocument(bad).join(" ")).toMatch(/record_basis: not a document field/);
    });

    it("refuses a census with no census block", () => {
      const bad = structuredClone(census1850) as any;
      delete bad.census;
      expect(validateStructuredDocument(bad).join(" ")).toMatch(/census: required on a census/);
    });

    it("refuses a computed attribute the fact does not carry, and a relationship to nobody", () => {
      const bad = structuredClone(obituary) as any;
      bad.persons[0].facts[0].computed = ["value"];
      bad.relationships[0].person2 = "p9";
      const errs = validateStructuredDocument(bad).join(" ");
      expect(errs).toMatch(/names 'value', which this fact does not carry/);
      expect(errs).toMatch(/person2: must name a person id/);
    });

    it("refuses the whole batch when one document is malformed, byte-identical", async () => {
      const before = await readFile(join(dir, "research.json"), "utf8");
      const bad = structuredClone(marriage) as any;
      bad.persons[0].informant_proximity = "self";
      const r = await run([
        { recordId: "capture:obituary-whitaker", document: obituary },
        { recordId: "capture:marriage-4872", document: bad },
      ]);
      expect(r.ok).toBe(false);
      expect(r.errors?.join(" ")).toMatch(/documents\[1\]\.document\.persons\[0\]\.informant_proximity/);
      expect(await readFile(join(dir, "research.json"), "utf8")).toBe(before);
    });
  });

  describe("a valid three-document batch", () => {
    beforeEach(async () => {
      const r = await run([
        { recordId: "capture:obituary-whitaker", document: obituary },
        { recordId: "capture:census-1850-flynn", document: census1850 },
        { recordId: "capture:marriage-4872", document: marriage },
      ]);
      expect(r.ok).toBe(true);
      expect(r.records.map((o) => o.status)).toEqual(["extracted", "extracted", "extracted"]);
    });

    it("logs each source once and writes a derivative source for each", async () => {
      const after = await read();
      expect(after.log.map((e: any) => e.tool)).toEqual(["user_provided", "user_provided", "user_provided"]);
      expect(after.sources.map((s: any) => s.source_classification)).toEqual(["derivative", "derivative", "derivative"]);
      expect(after.sources[0].notes).toMatch(/transcript/);
    });

    it("never sets record_persona_id", async () => {
      expect((await read()).assertions.some((a: any) => "record_persona_id" in a)).toBe(false);
    });

    it("obituary: recent family knowledge vs life history", async () => {
      const as = await assertionsFor("capture:obituary-whitaker");
      const find = (role: string, ft: string, place?: string) =>
        as.find((a: any) => a.record_role === role && a.fact_type === ft && (!place || a.place === place));
      const at = (a: any) => `${a.informant_proximity}/${a.information_quality}`;
      expect(at(find("deceased", "death"))).toBe("household_member/indeterminate");
      expect(at(find("deceased", "birth"))).toBe("family_not_present/secondary");
      expect(at(find("deceased", "residence", "Logan, Cache, Utah"))).toBe("household_member/indeterminate");
      expect(at(find("deceased", "residence", "Ogden, Weber, Utah"))).toBe("family_not_present/secondary");
      const son = as.find((a: any) => a.fact_type === "name" && a.value === "Robert Whitaker");
      expect(son.record_role).toMatch(/^child_\d+$/);
      expect(at(son)).toBe("household_member/indeterminate");
      const father = as.find((a: any) => a.fact_type === "name" && a.value === "Walter Whitaker");
      expect(at(father)).toBe("family_not_present/secondary");
    });

    it("census: a computed attribute is split into its own inferred assertion", async () => {
      const births = (await assertionsFor("capture:census-1850-flynn")).filter((a: any) => a.fact_type === "birth");
      const place = births.find((a: any) => a.place === "Ireland");
      const year = births.find((a: any) => a.date === "1818");
      expect(place.record_basis).toBe("stated");
      expect(year.record_basis).toBe("inferred");
      expect(year.date_certainty).toBe("approximate");
    });

    it("census: a pre-1880 schedule's stated relations are not relationship claims", async () => {
      const as = await assertionsFor("capture:census-1850-flynn");
      expect(as.some((a: any) => a.fact_type === "relationship")).toBe(false);
    });

    it("marriage: a named informant replaces the generic string only on a family row", async () => {
      const as = await assertionsFor("capture:marriage-4872");
      const groom = as.find((a: any) => a.record_role === "groom" && a.fact_type === "name");
      expect(groom.informant_proximity).toBe("self");
      expect(groom.informant).toBe("the party");
    });

    it("skips a resend and names the existing source", async () => {
      const r = await run([{ recordId: "capture:obituary-whitaker", document: obituary }]);
      expect(r.records[0].status).toBe("already_extracted");
      expect((await read()).log).toHaveLength(3);
    });
  });

  it("probate with a will: testator, witnesses, clerk, petitioner", async () => {
    const probate = {
      recordType: "probate",
      recordLabel: "will and probate",
      documentForm: "verbatim_transcript",
      source: { title: "Will of John Becker, Hamilton County Probate", repository: "Hamilton County Probate Court" },
      persons: [
        {
          id: "t1", principal: true, gender: "male", names: [{ given: "John", surname: "Becker" }],
          facts: [
            { type: "will", date: "2 May 1901", place: "Cincinnati, Hamilton, Ohio" },
            { type: "probate", date: "9 June 1903", place: "Hamilton, Ohio" },
            { type: "death", date: "1 June 1903" },
            { type: "residence", place: "Cincinnati, Hamilton, Ohio" },
          ],
        },
        { id: "t2", gender: "female", statedRelation: "heir", names: [{ given: "Anna", surname: "Becker" }], facts: [] },
        { id: "t3", gender: "male", statedRelation: "witness", names: [{ given: "Carl", surname: "Weis" }], facts: [] },
      ],
    };
    await run([{ recordId: "capture:will-becker", document: probate }]);
    const as = await assertionsFor("capture:will-becker");
    const at = (pred: (a: any) => boolean) => {
      const a = as.find(pred);
      return `${a.informant}|${a.informant_proximity}|${a.information_quality}`;
    };
    expect(at((a) => a.record_role === "testator" && a.fact_type === "name")).toBe("the testator|self|primary");
    expect(at((a) => a.fact_type === "will")).toBe("the witnesses|witness|primary");
    expect(at((a) => a.fact_type === "probate")).toBe("the court clerk|official_duty|primary");
    expect(at((a) => a.fact_type === "death")).toBe("the petitioner (executor or administrator)|household_member|indeterminate");
    expect(at((a) => a.value === "Anna Becker")).toBe("the testator|self|primary");
    expect(at((a) => a.value === "Carl Weis")).toBe("the witnesses|witness|primary");
  });

  it("newspaper wedding: bride and groom, parents with the event, birthplace as life history", async () => {
    const wedding = {
      recordType: "newspaper_announcement",
      documentForm: "verbatim_transcript",
      source: { title: "Doyle–Kelly wedding, Boston Globe, 12 June 1925", repository: "Boston Public Library" },
      persons: [
        { id: "w1", principal: true, gender: "female", names: [{ given: "Margaret", surname: "Doyle" }], facts: [{ type: "marriage", date: "10 June 1925", place: "Boston, Suffolk, Massachusetts" }, { type: "birth", place: "Dublin, Ireland" }] },
        { id: "w2", principal: true, gender: "male", names: [{ given: "James", surname: "Kelly" }], facts: [] },
        { id: "w3", gender: "male", statedRelation: "father", names: [{ given: "John", surname: "Doyle" }], facts: [] },
      ],
      relationships: [{ type: "parent_child", person1: "w3", person2: "w1" }],
    };
    await run([{ recordId: "capture:wedding-doyle", document: wedding }]);
    const as = await assertionsFor("capture:wedding-doyle");
    const at = (a: any) => `${a.informant_proximity}/${a.information_quality}`;
    expect(as.find((a: any) => a.value === "Margaret Doyle").record_role).toBe("bride");
    expect(as.find((a: any) => a.value === "James Kelly").record_role).toBe("groom");
    expect(at(as.find((a: any) => a.fact_type === "marriage"))).toBe("household_member/indeterminate");
    expect(at(as.find((a: any) => a.value === "John Doyle"))).toBe("household_member/indeterminate");
    expect(at(as.find((a: any) => a.fact_type === "birth"))).toBe("family_not_present/secondary");
  });

  it("a compiled work is authored", async () => {
    const book = { ...structuredClone(obituary), documentForm: "compiled_work", source: src("History of Cache County") };
    await run([{ recordId: "capture:history-cache", document: book }]);
    expect((await read()).sources[0].source_classification).toBe("authored");
  });

  it("a transcription ref is logged as image_transcribe and its text copied to the source", async () => {
    const staged = await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: {
        query: { imageId: "004022578_00190" },
        results: [{ id: "004022578_00190", source: { imageId: "004022578_00190" }, content_type: "image/jpeg", size_bytes: 1, model: "m", transcription: "Harold Dean Whitaker, 91, of Logan…" }],
      },
    });
    const r = await run([
      { recordId: "capture:obituary-whitaker", document: obituary, transcriptionRef: staged!.resultsRef, imageFilename: "images/004022578_00190.jpg" },
    ]);
    expect(r.ok).toBe(true);
    const after = await read();
    expect(after.log[0].tool).toBe("image_transcribe");
    expect(after.log[0].results_ref).toMatch(/^results\/log_/);
    expect(after.sources[0].transcription).toMatch(/Harold Dean Whitaker/);
    expect(after.sources[0].image_filename).toBe("images/004022578_00190.jpg");
  });

  it("flags an Old Style date in the summary without changing it", async () => {
    const baptism = {
      recordType: "christening",
      documentForm: "verbatim_transcript",
      source: { title: "Reformed Protestant Dutch Church of Albany, baptisms", repository: "Holland Society" },
      persons: [{ id: "b1", principal: true, names: [{ given: "Maria", surname: "Van Rensselaer" }], facts: [{ type: "christening", date: "18 March 1750", place: "Albany, New York" }] }],
    };
    const r = await run([{ recordId: "capture:baptism-albany", document: baptism }]);
    expect(r.records[0].summary).toMatch(/Calendar: 18 March 1750/);
    expect((await assertionsFor("capture:baptism-albany")).find((a: any) => a.fact_type === "christening").date).toBe("18 March 1750");
  });

  it("names a wedding notice's parents by side, as an indexed marriage does", async () => {
    const wedding = {
      recordType: "newspaper_announcement",
      recordLabel: "wedding notice",
      documentForm: "verbatim_transcript",
      source: { title: "Flynn-Gallagher wedding notice, Shenandoah Herald, 1870", repository: "Shenandoah Herald" },
      persons: [
        { id: "p1", principal: true, gender: "male", names: [{ given: "Patrick", surname: "Flynn" }], facts: [{ type: "marriage", date: "15 October 1870" }] },
        { id: "p2", principal: true, gender: "female", names: [{ given: "Catherine", surname: "Gallagher" }], facts: [] },
        { id: "p3", gender: "male", statedRelation: "father", names: [{ given: "Thomas", surname: "Flynn" }], facts: [] },
        { id: "p4", gender: "male", statedRelation: "father", names: [{ given: "James", surname: "Gallagher" }], facts: [] },
      ],
      relationships: [
        { type: "couple", person1: "p1", person2: "p2" },
        { type: "parent_child", person1: "p3", person2: "p1" },
        { type: "parent_child", person1: "p4", person2: "p2" },
      ],
    };
    const r = await run([{ recordId: "capture:wedding-1870", document: wedding }]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const roleOf = async (value: string) =>
      (await assertionsFor("capture:wedding-1870")).find((a: any) => a.fact_type === "name" && a.value === value)?.record_role;
    expect(await roleOf("Thomas Flynn")).toBe("father_of_groom");
    expect(await roleOf("James Gallagher")).toBe("father_of_bride");
  });
});
