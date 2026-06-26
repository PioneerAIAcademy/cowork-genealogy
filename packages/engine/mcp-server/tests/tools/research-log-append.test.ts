import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { stageSearchResults, STAGING_SUBDIR } from "../../src/utils/results-staging.js";
import { validateProject } from "../../src/validation/validator.js";

function baseResearch(log: any[] = []) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log,
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}
const minimalTree = { persons: [], relationships: [], sources: [] };

function logEntry(n: number) {
  return {
    id: `log_${String(n).padStart(3, "0")}`,
    plan_item_id: null,
    performed: "2026-01-01T00:00:00.000Z",
    tool: "record_search",
    query: {},
    outcome: "negative",
    results_examined: 0,
    external_site: null,
    results_ref: null,
  };
}

describe("research_log_append", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-append-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(research: any, tree: any = minimalTree) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readJson = async (name: string) => JSON.parse(await readFile(join(dir, name), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  it("appends a positive search with a finalized sidecar (staging round-trip)", async () => {
    await writeProject(baseResearch());
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { query: { surname: "Smith" }, results: [{ recordId: "A" }, { recordId: "B" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: { surname: "Smith" },
      outcome: "positive",
      resultsExamined: 2,
      planItemId: "pli_001",
      stagedResultsRef: handle!.resultsRef,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logId).toBe("log_001");
    expect(result.resultsRef).toBe("results/log_001.json");
    expect(result.returnedCount).toBe(2);
    expect(result.filesWritten).toEqual(["research.json", "results/log_001.json"]);

    // sidecar materialized; staged file consumed.
    const sidecar = await readJson("results/log_001.json");
    expect(sidecar).toMatchObject({ log_id: "log_001", returned_count: 2 });
    expect(await exists(handle!.resultsRef)).toBe(false);

    // entry persisted in snake_case.
    const research = await readJson("research.json");
    expect(research.log).toHaveLength(1);
    expect(research.log[0]).toMatchObject({
      id: "log_001",
      plan_item_id: "pli_001",
      results_examined: 2,
      results_ref: "results/log_001.json",
    });

    // project still validates.
    expect((await validateProject(dir)).valid).toBe(true);
  });

  it("logs a nil search with no sidecar", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resultsRef).toBeNull();
    expect(result.returnedCount).toBeNull();
    expect(result.filesWritten).toEqual(["research.json"]);
    const research = await readJson("research.json");
    expect(research.log[0].results_ref).toBeNull();
  });

  it("logs an external-site search and rejects when externalSite is missing", async () => {
    await writeProject(baseResearch());
    const ok = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: { url: "https://ancestry.com/search" },
      outcome: "partial",
      resultsExamined: 3,
      externalSite: { site: "ancestry", urlGenerated: "https://ancestry.com/search", captureReceived: false },
    });
    expect(ok.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].external_site).toEqual({
      site: "ancestry",
      url_generated: "https://ancestry.com/search",
      capture_received: false,
    });

    // missing externalSite for an external_site tool → input error.
    const bad = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects externalSite supplied for a non-external_site tool", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
      externalSite: { site: "ancestry", urlGenerated: "x", captureReceived: false },
    });
    expect(result.ok).toBe(false);
  });

  it("coerces a stringified externalSite and query back into objects", async () => {
    // Some models emit nested-object args as JSON strings; the tool should
    // parse them rather than fail with "externalSite.site 'undefined'".
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: JSON.stringify({ surname: "Flynn", birthplace: "Pennsylvania" }) as any,
      outcome: "partial",
      resultsExamined: 0,
      externalSite: JSON.stringify({
        site: "ancestry",
        urlGenerated: "https://ancestry.com/search?name=Flynn",
        captureReceived: false,
      }) as any,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log[0].external_site).toEqual({
      site: "ancestry",
      url_generated: "https://ancestry.com/search?name=Flynn",
      capture_received: false,
    });
    expect(research.log[0].query).toEqual({ surname: "Flynn", birthplace: "Pennsylvania" });
  });

  it("returns a clear error when a stringified externalSite is not valid JSON", async () => {
    await writeProject(baseResearch());
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "external_site",
      query: {},
      outcome: "partial",
      resultsExamined: 0,
      externalSite: "site=ancestry" as any,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/externalSite must be an object/);
  });

  it("assigns the next id as max + 1, not count + 1", async () => {
    // log_001..log_003 then a gap to log_009 → next is log_010.
    const log = [logEntry(1), logEntry(2), logEntry(3), logEntry(9)];
    await writeProject(baseResearch(log));
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.logId).toBe("log_010");
  });

  it("is append-only: existing entries are byte-unchanged", async () => {
    const log = [logEntry(1), logEntry(2)];
    await writeProject(baseResearch(log));
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "negative",
      resultsExamined: 0,
    });
    expect(result.ok).toBe(true);
    const research = await readJson("research.json");
    expect(research.log.slice(0, 2)).toEqual(log);
    expect(research.log).toHaveLength(3);
  });

  it("writes nothing and leaves no orphan sidecar when the would-be project is invalid", async () => {
    // Pre-existing dangling subject ref makes validation fail on append.
    const research = baseResearch();
    (research.project as any).subject_person_ids = ["GHOST"];
    await writeProject(research);
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");

    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });

    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "positive",
      resultsExamined: 1,
      stagedResultsRef: handle!.resultsRef,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/GHOST/);
    // research.json untouched and no orphan sidecar left behind.
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    expect(await exists("results/log_001.json")).toBe(false);
  });

  it("rejects a stagedResultsRef outside results/.staging/", async () => {
    await writeProject(baseResearch());
    // A staged-looking file at the project root (not under results/.staging/).
    await writeFile(join(dir, "loose.json"), "{}", "utf-8");
    const result = await researchLogAppend({
      projectPath: dir,
      tool: "record_search",
      query: {},
      outcome: "positive",
      resultsExamined: 1,
      stagedResultsRef: "loose.json",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/not inside results\/\.staging/);
  });

  it("leaves an un-finalized staged file invisible to the validator orphan check", async () => {
    await writeProject(baseResearch());
    await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });
    // A staged file exists under results/.staging/ but is referenced by no log
    // entry; the orphan check (top-level, non-recursive) must not flag it.
    expect(await exists(STAGING_SUBDIR)).toBe(true);
    const result = await validateProject(dir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
