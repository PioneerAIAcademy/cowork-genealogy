/**
 * extraction_append's re-extraction (#3678; research-append-tool-spec.md §11.6.1):
 * a record extracted wrongly is extracted again with `reextract: true`, and its
 * old assertions are retired in the same write — `superseded_by` naming the
 * replacement, or "retracted" with a reason.
 *
 * The wrong first reading is planted the way the Meacham feedback case (#3660)
 * produced it, grantor and grantee swapped plus a couple the corrected reading
 * does not carry, without the user's bundle: a `documents` call with no
 * `transcriptionRef`, so the deed-formula check has no page text to refuse it on.
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
import { researchAppendFromCaller } from "../../src/tools/research-append.js";
import { researchQuery } from "../../src/tools/research-query.js";
import { validateParsed } from "../../src/validation/validator.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { LOCAL } from "../../src/auth/principal.js";

const noReader = { readRecord: async () => { throw new Error("no reads on the document path"); } } as any;
const RECORD = "capture:deed-384";

function research() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

const person = (id: string, given: string, surname: string, statedRelation: string, gender = "male") =>
  ({ id, gender, names: [{ given, surname }], statedRelation, facts: [] as any[] });
const deed = (persons: any[], relationships?: any[]) => ({
  recordType: "land",
  documentForm: "page_image",
  source: { title: "Hampshire Co. deeds, p. 384", repository: "FamilySearch" },
  persons,
  ...(relationships ? { relationships } : {}),
});
/** As the defect wrote it: the parties swapped, and Paul's wife joined to him. */
const wrongDeed = () =>
  deed(
    [
      person("p1", "Paul", "Meacham", "grantee"),
      person("p2", "John", "Dewey", "grantor"),
      person("p3", "Gad", "Palmer", "witness"),
      person("p5", "Mary", "Meacham", "wife of Paul Meacham", "female"),
    ],
    [{ type: "couple", person1: "p1", person2: "p5" }],
  );
/** As the record reads. */
const rightDeed = () =>
  deed([
    person("p1", "Paul", "Meacham", "grantor"),
    person("p2", "John", "Dewey", "grantee"),
    person("p3", "Gad", "Palmer", "witness"),
  ]);

describe("extraction_append: reextract", () => {
  let dir: string;
  const read = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf8"));
  const write = async (name: string, doc: unknown) => writeFile(join(dir, name), JSON.stringify(doc), "utf8");
  const run = (input: Record<string, unknown>) =>
    runExtractionAppend({ projectPath: dir, ...input } as any, noReader, LOCAL) as unknown as Promise<ExtractionBatchResult>;
  const extractWrong = async (recordId = RECORD): Promise<string[]> => {
    const r = await run({ documents: [{ recordId, document: wrongDeed() }] });
    expect(r.ok).toBe(true);
    return (await read()).assertions.filter((a: any) => a.record_id === recordId).map((a: any) => a.id as string);
  };
  const reextract = (recordId = RECORD) => run({ reextract: true, documents: [{ recordId, document: rightDeed() }] });
  const files = async () =>
    Promise.all(["research.json", "tree.gedcomx.json"].map((f) => readFile(join(dir, f), "utf8")));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "extraction-reextract-test-"));
    await write("research.json", research());
    await write("tree.gedcomx.json", { persons: [], relationships: [], sources: [] });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a plain resend still writes nothing", async () => {
    await extractWrong();
    const r = await run({ documents: [{ recordId: RECORD, document: rightDeed() }] });
    expect(r.records[0].status).toBe("already_extracted");
  });

  it("corrects the deed: a fresh reading on the same source, every old assertion retired", async () => {
    const old = await extractWrong();
    const srcBefore = (await read()).sources.map((s: any) => s.id);
    const r = await reextract();
    expect(r.ok).toBe(true);
    expect(r.records[0].status).toBe("extracted");

    const doc = await read();
    expect(doc.sources.map((s: any) => s.id)).toEqual(srcBefore);
    expect(r.records[0].srcId).toBe(srcBefore[0]);
    const byId = new Map<string, any>(doc.assertions.map((a: any) => [a.id, a]));
    for (const id of old) expect(byId.get(id).superseded_by, id).toBeTruthy();

    const live = doc.assertions.filter((a: any) => a.superseded_by == null);
    const roles = Object.fromEntries(live.filter((a: any) => a.fact_type === "name").map((a: any) => [a.value, a.record_role]));
    expect(roles).toMatchObject({ "Paul Meacham": "grantor_1", "John Dewey": "grantee" });
    expect(live.some((a: any) => a.value.includes("Mary"))).toBe(false);

    // Mary and the couple have no counterpart in the corrected reading.
    const retracted = old.filter((id) => byId.get(id).superseded_by === "retracted");
    expect(retracted.length).toBeGreaterThan(0);
    for (const id of retracted) expect(byId.get(id).superseded_reason).toMatch(/wrote no counterpart/);
    for (const id of old.filter((x) => !retracted.includes(x))) {
      const next = byId.get(byId.get(id).superseded_by);
      expect(next, id).toBeDefined();
      expect(next.superseded_by ?? null).toBeNull();
    }
    expect(r.records[0].retired).toHaveLength(old.length);
    expect(r.records[0].summary).toMatch(/Re-extracted: \d+ earlier assertions retired \(\d+ retracted/);

    const v = await validateParsed(doc, await readTree());
    expect(v.errors).toEqual([]);
  });

  it("research_query leaves retired assertions out unless includeSuperseded", async () => {
    const old = await extractWrong();
    await reextract();
    const plain = await researchQuery({ projectPath: dir, section: "assertions" } as any);
    const all = await researchQuery({ projectPath: dir, section: "assertions", includeSuperseded: true } as any);
    expect(plain.ok && all.ok).toBe(true);
    if (!plain.ok || !all.ok) return;
    expect(plain.items.some((a: any) => old.includes(a.id))).toBe(false);
    expect(old.every((id) => all.items.some((a: any) => a.id === id))).toBe(true);
    const bad = await researchQuery({ projectPath: dir, section: "assertions", includeSuperseded: "yes" } as any);
    expect(bad.ok).toBe(false);
  });

  it("re-extracts a page cited under its own image_transcribe entry, which both readings share", async () => {
    const staged = await stageSearchResults({
      projectPath: dir,
      tool: "image_transcribe",
      response: {
        query: { imageId: "004022578_00190" },
        results: [{ id: "004022578_00190", source: { imageId: "004022578_00190" }, content_type: "image/jpeg", size_bytes: 1, model: "m", transcription: "Harold Dean Whitaker, 91, of Logan…" }],
      },
    } as any);
    const logged = await researchLogAppend({
      projectPath: dir,
      ops: [{ tool: "image_transcribe", query: { imageId: "004022578_00190" }, outcome: "positive", resultsExamined: 1, stagedResultsRef: (staged as any).resultsRef }],
    } as any);
    const ref = (logged as any).results[0].resultsRef as string;
    const obituary = (surname: string) => ({
      recordType: "obituary",
      documentForm: "verbatim_transcript",
      source: { title: "Obituary of Harold Dean Whitaker", repository: "Utah Digital Newspapers" },
      persons: [{ id: "p1", principal: true, gender: "male", names: [{ given: "Harold Dean", surname }], facts: [{ type: "death", date: "14 March 2021" }] }],
    });
    const first = await run({ documents: [{ recordId: "capture:obit", document: obituary("Whitacre"), transcriptionRef: ref }] });
    expect(first.records[0].status, JSON.stringify(first)).toBe("extracted");
    const r = await run({ reextract: true, documents: [{ recordId: "capture:obit", document: obituary("Whitaker"), transcriptionRef: ref }] });
    expect(r.records[0].status, JSON.stringify(r)).toBe("extracted");
    const live = (await read()).assertions.filter((a: any) => a.superseded_by == null && a.fact_type === "name");
    expect(live.map((a: any) => a.value)).toEqual(["Harold Dean Whitaker"]);
  });

  it("re-extracts only the id it names, never another record of the same source", async () => {
    await extractWrong("capture:deed-385");
    const other = (await read()).assertions.map((a: any) => a.id);
    await extractWrong();
    await reextract();
    const doc = await read();
    for (const id of other) expect(doc.assertions.find((a: any) => a.id === id).superseded_by ?? null).toBeNull();
  });

  it("refuses reextract beside personId or absences, or when not a boolean", async () => {
    for (const input of [
      { reextract: true, personId: "I1" },
      { reextract: true, absences: [{ collection: "x", name: "y", logEntryId: "log_001" }] },
      { reextract: "yes", documents: [{ recordId: RECORD, document: rightDeed() }] },
    ]) {
      const r = await run(input);
      expect(r.ok).toBe(false);
      expect((r.errors ?? []).join(" ")).toMatch(/reextract/);
    }
  });

  describe("refused while anything rests on an old assertion, writing nothing", () => {
    const plantAndRefuse = async (plant: (doc: any, tree: any, old: string[]) => void, message: RegExp) => {
      const old = await extractWrong();
      const doc = await read();
      const tree = await readTree();
      plant(doc, tree, old);
      await write("research.json", doc);
      await write("tree.gedcomx.json", tree);
      const before = await files();
      const r = await reextract();
      expect(r.records[0].status).toBe("refused");
      expect(r.records[0].summary).toMatch(message);
      expect(await files()).toEqual(before);
      return r;
    };
    const personI1 = { id: "I1", gender: "Male", names: [{ id: "N1", given: "Paul", surname: "Meacham", preferred: true }] };

    it("a live person_evidence link", async () => {
      await plantAndRefuse((doc, tree, old) => {
        tree.persons.push(personI1);
        doc.person_evidence.push({ id: "pe_001", assertion_id: old[0], person_id: "I1", confidence: "speculative", rationale: "x", match_score: null, created: "2026-01-01", superseded_by: null });
      }, /person_evidence pe_001 links a_\d+ to I1/);
    });

    it("but not a superseded one", async () => {
      const [elsewhere] = await extractWrong("capture:deed-385");
      const old = await extractWrong();
      const doc = await read();
      const tree = await readTree();
      tree.persons.push(personI1);
      doc.person_evidence.push(
        { id: "pe_001", assertion_id: old[0], person_id: "I1", confidence: "speculative", rationale: "x", match_score: null, created: "2026-01-01", superseded_by: "pe_002" },
        { id: "pe_002", assertion_id: elsewhere, person_id: "I1", confidence: "speculative", rationale: "x", match_score: null, created: "2026-01-01", superseded_by: null },
      );
      await write("research.json", doc);
      await write("tree.gedcomx.json", tree);
      const r = await reextract();
      expect(r.records[0].status).toBe("extracted");
    });

    it("a tree fact written from one", async () => {
      await plantAndRefuse((_doc, tree, old) => {
        tree.persons.push({ ...personI1, facts: [{ id: "F1", type: "Residence", value: "Southwick", assertion_id: old[0] }] });
      }, /tree fact F1 on I1 was written from a_\d+/);
    });

    it("a proof summary's claim, nested", async () => {
      await plantAndRefuse((doc, _tree, old) => {
        doc.proof_summaries.push({ id: "ps_001", claims: [{ supporting_assertion_ids: [old[1]] }] });
      }, /proof_summaries ps_001 cites a_\d+/);
    });

    it("a researcher's rejection, for good", async () => {
      await plantAndRefuse((doc, tree, old) => {
        tree.persons.push(personI1);
        doc.rejected_links = [{ id: "rj_001", assertion_id: old[0], person_id: "I1", reason: "not him", created: "2026-01-01" }];
      }, /rejected_links rj_001.*cannot be re-extracted.*Ask the researcher/);
    });

    it("an edge resting on this record alone: remove it first", async () => {
      await plantAndRefuse((doc, tree) => {
        const s = doc.sources[0].gedcomx_source_description_id;
        tree.persons.push(personI1, { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Meacham", preferred: true }] });
        tree.relationships.push({ id: "R1", type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: s }] });
      }, /tree relationship R1 rests on this record alone .* remove the edge with tree_correct/);
    });

    it("an edge that also rests on other evidence: never told to remove it", async () => {
      const r = await plantAndRefuse((doc, tree) => {
        const s = doc.sources[0].gedcomx_source_description_id;
        tree.sources.push({ id: "S99", title: "Another record" });
        tree.persons.push(personI1, { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Meacham", preferred: true }] });
        tree.relationships.push({ id: "R1", type: "Couple", person1: "I1", person2: "I2", sources: [{ ref: s }, { ref: "#S99" }] });
      }, /tree relationship R1 cites this record .* and also S99.*ask the researcher/);
      expect(r.records[0].summary).not.toMatch(/remove/);
    });
  });

  it("warns, naming a person minted from the retracted couple's source", async () => {
    await extractWrong();
    const doc = await read();
    const tree = await readTree();
    const s = doc.sources[0].gedcomx_source_description_id;
    tree.persons.push({ id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Meacham", preferred: true, sources: [{ ref: s }] }] });
    await write("tree.gedcomx.json", tree);
    const r = await reextract();
    expect(r.records[0].status).toBe("extracted");
    expect((r.records[0].warnings ?? []).join(" ")).toMatch(/retracted relationship claim .* is the source of a name on I2/);
  });

  it("retires an old assertion today's update rules would refuse", async () => {
    const old = await extractWrong();
    const doc = await read();
    const grantorName = doc.assertions.find((a: any) => old.includes(a.id) && a.fact_type === "name" && a.record_role === "grantor_1");
    grantorName.record_basis = "absent";
    await write("research.json", doc);
    const r = await reextract();
    expect(r.records[0].status).toBe("extracted");
    expect((await read()).assertions.find((a: any) => a.id === grantorName.id).superseded_by).toBeTruthy();
  });

  it("research_append refuses a new link to a retired assertion", async () => {
    const old = await extractWrong();
    await reextract();
    const tree = await readTree();
    tree.persons.push({ id: "I1", gender: "Male", names: [{ id: "N1", given: "Paul", surname: "Meacham", preferred: true }] });
    await write("tree.gedcomx.json", tree);
    const r = await researchAppendFromCaller({
      projectPath: dir,
      section: "person_evidence",
      op: "append",
      entry: { assertion_id: old[0], person_id: "I1", confidence: "speculative", rationale: "x", match_score: null },
    } as any);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/cites a_\d+ \(superseded_by [^)]+\): a re-extraction retired it/);
  });
});

describe("validator: an assertion's superseded_by", () => {
  const base = () => {
    const doc: any = research();
    doc.sources.push({ id: "src_001", citation: "c", source_classification: "original", repository: "r", access_date: "2026-01-01" });
    const a = (id: string, more: Record<string, unknown> = {}) => ({
      id, source_id: "src_001", record_id: "REC1", record_role: "principal", fact_type: "name", value: "X",
      information_quality: "primary", informant: "x", informant_proximity: "self", record_basis: "stated",
      extracted_for_question_ids: [], ...more,
    });
    return { doc, a };
  };
  const errorsOf = async (assertions: any[]) => {
    const { doc } = base();
    doc.assertions = assertions;
    const v = await validateParsed(doc, { persons: [], relationships: [], sources: [] });
    return v.errors.map((e: any) => e.message ?? String(e)).join(" | ");
  };

  it("accepts a replacement id and a retraction with its reason", async () => {
    const { a } = base();
    expect(await errorsOf([a("a_001", { superseded_by: "a_002" }), a("a_002"), a("a_003", { superseded_by: "retracted", superseded_reason: "none" })])).not.toMatch(/superseded/);
  });

  it.each([
    ["a dangling id", { superseded_by: "a_099" }, /a_099' which does not exist/],
    ["itself", { superseded_by: "a_001" }, /names the assertion itself/],
    ["a retraction with no reason", { superseded_by: "retracted" }, /requires a non-empty superseded_reason/],
    ["a non-string", { superseded_by: 7 }, /superseded_by must be a string or null/],
    ["another prefix", { superseded_by: "pe_001" }, /must be an 'a_' id or "retracted"/],
  ])("refuses %s", async (_label, more, message) => {
    const { a } = base();
    expect(await errorsOf([a("a_001", more)])).toMatch(message);
  });
});
