import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Same offline place-resolver stub the research_append suite uses. It doubles as
// the probe for "did the lane gate run before the network pre-pass?" — a rejected
// call must leave this mock untouched.
vi.mock("../../src/utils/place-resolver.js", () => ({
  resolveStandardPlace: vi.fn(async (text: string) => {
    if (text === "Schuylkill County, Pennsylvania") return "Schuylkill, Pennsylvania, United States";
    return null;
  }),
}));

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
  evidence_type: "direct",
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
    expect(r.entryId).toBe("src_002");
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
    expect(r.entryId).toBe("pe_001");
  });
});
