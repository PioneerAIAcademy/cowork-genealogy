/**
 * research_log_append rolls back on a validation failure (#1572, Gennecis review).
 *
 * The organic trigger is unreachable through the public API: the tool builds a
 * valid log entry, `finalizeStagedSidecar` rebuilds a self-consistent sidecar
 * (log_id forced, returned_count recomputed from the payload), a bad plan_item_id
 * is only prefix-checked, and a bad outcome is rejected at input (the catch path,
 * covered by the batch invalid-outcome test). Pre-existing errors are now
 * tolerated. So the `!validation.valid` branch cannot fire from a real call —
 * this forces it with a mocked `validateIntroduced` to pin the rollback contract
 * directly: on a validation failure the staged sidecar is removed and
 * research.json is byte-unchanged. Deleting a `cleanupSidecars` call turns this red.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/validation/introduced-errors.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/validation/introduced-errors.js")
  >();
  return {
    ...actual,
    validateIntroduced: vi.fn(async () => ({
      valid: false,
      errors: [
        {
          path: "research.json/log[0]",
          message: "forced call-introduced failure (rollback test)",
        },
      ],
      warnings: [],
    })),
  };
});

import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";

const minimalTree = { persons: [], relationships: [], sources: [] };
function baseResearch() {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [], plans: [], log: [], sources: [], assertions: [], person_evidence: [],
    conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
  };
}

describe("research_log_append rollback on a validation failure", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "log-rollback-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  it("writes nothing and cleans up the staged sidecar when the project fails validation", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify(baseResearch(), null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(minimalTree, null, 2), "utf-8");
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
    // research.json byte-unchanged — nothing written on the failure path.
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    // ...and the finalized sidecar is removed, not left as a freeze-risk orphan.
    expect(await exists("results/log_001.json")).toBe(false);
  });

  it("(batch) same rollback at the batch validation site", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify(baseResearch(), null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(minimalTree, null, 2), "utf-8");
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");

    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results: [{ recordId: "A" }] },
    });
    const result = await researchLogAppend({
      projectPath: dir,
      ops: [
        { tool: "record_search", query: {}, outcome: "positive", resultsExamined: 1, stagedResultsRef: handle!.resultsRef },
      ],
    });

    expect(result.ok).toBe(false);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    expect(await exists("results/log_001.json")).toBe(false);
  });
});
