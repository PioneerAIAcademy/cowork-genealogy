import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// No place text appears in any fixture below, so the resolver is never called —
// but stub it anyway so a stray geocode can never make these offline tests hit
// the network or go non-deterministic.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});

import { researchAppend } from "../../src/tools/research-append.js";
import { materializeFacts } from "../../src/tools/materialize-facts.js";

// ─── fixtures ─────────────────────────────────────────────────────────────────

function baseResearch() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: ["I1"] },
    questions: [],
    plans: [],
    log: [],
    sources: [
      {
        id: "src_001",
        gedcomx_source_description_id: "S1",
        citation: "1850 U.S. Census, Schuylkill County, PA",
        citation_detail: { who: "Enumerator", what: "1850 Census", when_created: "1850", when_accessed: "2026-01-01", where: "Schuylkill County, PA", where_within: "dwelling 201" },
        source_classification: "original",
        repository: "NARA",
        access_date: "2026-01-01",
      },
    ],
    assertions: [
      {
        id: "a_001",
        source_id: "src_001",
        record_id: "REC",
        record_role: "principal",
        fact_type: "birth",
        value: "1850",
        information_quality: "primary",
        informant: "self",
        informant_proximity: "self",
        evidence_type: "direct",
        extracted_for_question_ids: [],
      },
    ],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}

function baseTree() {
  return {
    persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
    relationships: [],
    sources: [{ id: "S1", title: "1850 U.S. Census" }],
  };
}

// An assertion append that cites the pre-existing src_001 (research-only write,
// no place → no geocoding). Distinct `value` per call so a lost update is
// visible as a missing value, not just a missing id.
const assertionAppend = (value: string) => ({
  source_id: "src_001",
  record_id: "REC",
  record_role: "principal",
  fact_type: "birth",
  value,
  information_quality: "primary",
  informant: "self",
  informant_proximity: "self",
  evidence_type: "direct",
  extracted_for_question_ids: [],
});

// A create-or-enrich persona for materialize_facts: a name + a Birth, no place.
// Distinct assertion ids so it can be appended to baseResearch without clashing.
const persona = (recordId: string, given: string) => [
  { id: "a_010", source_id: "src_001", record_id: recordId, record_role: "child", record_persona_id: null, fact_type: "name", value: `${given} Smith`, date: null, place: null, standard_place: null, information_quality: "primary", informant: "unknown", informant_proximity: "official_duty", evidence_type: "direct", extracted_for_question_ids: [] },
  { id: "a_011", source_id: "src_001", record_id: recordId, record_role: "child", record_persona_id: null, fact_type: "birth", value: "1855", date: "1855", place: null, standard_place: null, information_quality: "primary", informant: "unknown", informant_proximity: "official_duty", evidence_type: "direct", extracted_for_question_ids: [] },
];

describe("write serialization under concurrency (issue #1715)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "write-serialization-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any, tree: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf-8");
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));

  it("two concurrent research_append calls both persist with distinct ids (no lost update)", async () => {
    await writeProject(baseResearch(), baseTree());

    // Fire both without awaiting between them: both read research.json before
    // either writes, so on today's code both allocate a_002 and one write is
    // silently lost.
    const [rA, rB] = await Promise.all([
      researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionAppend("valueA") }),
      researchAppend({ projectPath: dir, section: "assertions", op: "append", entry: assertionAppend("valueB") }),
    ]);

    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);

    const research = await readResearch();
    // Grew by the SUM of both appends (1 pre-existing + 2), not by one.
    expect(research.assertions).toHaveLength(3);
    // Both callers' reported ids are distinct and both are present on disk.
    const ids = research.assertions.map((a: any) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const values = research.assertions.map((a: any) => a.value).sort();
    expect(values).toEqual(["1850", "valueA", "valueB"]);
  });

  it("research_append (composite tree write) concurrent with materialize_facts: both tree writes survive", async () => {
    // Seed the persona materialize_facts will mint I2 from (REC-SON).
    const seeded = baseResearch();
    seeded.assertions.push(...persona("REC-SON", "Robert"));
    await writeProject(seeded, baseTree());

    // A: composite sources append — creates a NEW tree S entry (tree + research
    //    written together via atomicWriteBoth).
    // B: materialize_facts — mints person I2 with facts (tree write).
    // Both read tree.gedcomx.json before either writes; on today's code one
    // tool's tree mutation is clobbered by the other's write.
    const [rA, rB] = await Promise.all([
      researchAppend({
        projectPath: dir,
        section: "sources",
        op: "append",
        entry: {
          citation: "1860 U.S. Census, Provo, Utah",
          citation_detail: { who: "Enumerator", what: "1860 Census", when_created: "1860", when_accessed: "2026-01-01", where: "Provo, Utah", where_within: "dwelling 5" },
          source_classification: "original",
          repository: "NARA",
          access_date: "2026-01-01",
        },
        sourceDescription: { title: "1860 U.S. Census" },
      }),
      // I2 minted from a distinct record; person id is explicit so the two
      // writers touch different parts of the tree — a per-file lock keyed on a
      // tool's "primary" file could still lose one, which is why the fix locks
      // per project, not per file.
      materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }),
    ]);

    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);

    const tree = await readTree();
    // A's new S entry survived.
    expect(tree.sources.some((s: any) => s.title === "1860 U.S. Census")).toBe(true);
    // B's minted person survived.
    expect(tree.persons.some((p: any) => p.id === "I2")).toBe(true);
    // research.json carries A's new source.
    const research = await readResearch();
    expect(research.sources).toHaveLength(2);
  });
});
