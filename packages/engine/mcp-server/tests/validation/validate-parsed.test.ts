/**
 * Tests for the in-memory validation entry point `validateParsed` and its
 * parity with the file-reading `validateProject`.
 *
 * The existing `validator.test.ts` (the ~35-case behavior suite) is the primary
 * proof that `validateProject` is unchanged; this file proves the new
 * `validateParsed` delegate, the projectPath-gated sidecar pass, and the
 * null/non-object guard. Spec: docs/specs/validate-project-refactor-spec.md §7.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { validateProject, validateParsed } from "../../src/validation/validator.js";

describe("validateParsed", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "validate-parsed-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const minimalResearch = {
    project: {
      id: "rp_001",
      objective: "Test project",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [],
    plans: [],
    log: [],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };

  const minimalTree = {
    persons: [],
    relationships: [],
    sources: [],
  };

  async function writeProject(research: any, tree: any) {
    await writeFile(join(testDir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(testDir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }

  describe("parity with validateProject", () => {
    const fixtures: Array<{ name: string; research: any; tree: any }> = [
      { name: "valid minimal project", research: minimalResearch, tree: minimalTree },
      {
        name: "research enum error",
        research: {
          ...minimalResearch,
          project: { ...minimalResearch.project, status: "bogus" },
        },
        tree: minimalTree,
      },
      {
        name: "gedcomx error (person missing names)",
        research: minimalResearch,
        tree: {
          persons: [{ id: "I1", gender: "Male", names: [] }],
          relationships: [],
          sources: [],
        },
      },
      {
        name: "cross-file error (bad subject_person_ids)",
        research: {
          ...minimalResearch,
          project: { ...minimalResearch.project, subject_person_ids: ["NOPE"] },
        },
        tree: minimalTree,
      },
    ];

    for (const f of fixtures) {
      it(`matches validateProject for: ${f.name}`, async () => {
        await writeProject(f.research, f.tree);
        const viaPath = await validateProject(testDir);
        const viaParsed = await validateParsed(f.research, f.tree, { projectPath: testDir });
        expect(viaParsed).toEqual(viaPath);
      });
    }

    it("matches validateProject when a sidecar error is present", async () => {
      // Orphan sidecar: a results/ file no log entry references.
      await writeProject(minimalResearch, minimalTree);
      await mkdir(join(testDir, "results"), { recursive: true });
      await writeFile(join(testDir, "results", "orphan.json"), JSON.stringify({ x: 1 }));

      const viaPath = await validateProject(testDir);
      const viaParsed = await validateParsed(minimalResearch, minimalTree, {
        projectPath: testDir,
      });
      expect(viaPath.valid).toBe(false);
      expect(viaParsed).toEqual(viaPath);
    });
  });

  describe("log[].plan_item_id must be a pli_ reference or null (drift with research.schema.json)", () => {
    const withLog = (planItemId: unknown) => ({
      ...minimalResearch,
      log: [
        {
          id: "log_001",
          plan_item_id: planItemId,
          performed: "2026-01-01",
          tool: "record_search",
          query: {},
          outcome: "negative",
          results_examined: 0,
          external_site: null,
        },
      ],
    });
    const prefixError = (r: { errors: Array<{ message: string }> }) =>
      r.errors.some((e) => /should start with 'pli_'/.test(e.message));

    it("accepts a null plan_item_id (ad-hoc search)", async () => {
      const r = await validateParsed(withLog(null), minimalTree);
      expect(prefixError(r)).toBe(false);
    });

    it("accepts a pli_ plan_item_id", async () => {
      const r = await validateParsed(withLog("pli_001"), minimalTree);
      expect(prefixError(r)).toBe(false);
    });

    it("rejects a question id (q_) in plan_item_id — the ut_record_extraction_002 drift", async () => {
      const r = await validateParsed(withLog("q_001"), minimalTree);
      expect(r.valid).toBe(false);
      expect(prefixError(r)).toBe(true);
    });
  });

  describe("sidecar pass is gated on projectPath", () => {
    it("reports a sidecar error with projectPath and is inert without it", async () => {
      await writeProject(minimalResearch, minimalTree);
      await mkdir(join(testDir, "results"), { recursive: true });
      await writeFile(join(testDir, "results", "orphan.json"), JSON.stringify({ x: 1 }));

      const withPath = await validateParsed(minimalResearch, minimalTree, {
        projectPath: testDir,
      });
      expect(withPath.valid).toBe(false);
      expect(withPath.errors.some((e) => /orphan sidecar/.test(e.message))).toBe(true);

      const withoutPath = await validateParsed(minimalResearch, minimalTree);
      expect(withoutPath.valid).toBe(true);
      expect(withoutPath.errors).toHaveLength(0);
    });
  });

  describe("results/.staging/ is invisible to the orphan-sidecar check", () => {
    // Load-bearing for the whole Option B staging design (search-result-staging
    // §3/§9/§10): the validator's orphan scan is a non-recursive readdir that
    // only flags top-level *.json, so a `.staging` subdirectory entry is skipped.
    // A future switch to a recursive scan would silently break staging — this
    // pins it, with a real referenced sidecar alongside the un-finalized file.
    it("passes validation with a referenced sidecar and an un-finalized staged file present", async () => {
      const research = {
        ...minimalResearch,
        log: [
          {
            id: "log_001",
            plan_item_id: null,
            performed: "2026-01-01T00:00:00.000Z",
            tool: "record_search",
            query: {},
            outcome: "positive",
            results_examined: 1,
            external_site: null,
            results_ref: "results/log_001.json",
          },
        ],
      };
      await writeProject(research, minimalTree);
      await mkdir(join(testDir, "results", ".staging"), { recursive: true });
      // The real, referenced sidecar.
      await writeFile(
        join(testDir, "results", "log_001.json"),
        JSON.stringify({
          log_id: "log_001",
          tool: "record_search",
          retrieved: "2026-01-01T00:00:00.000Z",
          returned_count: 1,
          payload: { results: [{ recordId: "REC1" }] },
        }),
      );
      // An un-finalized staged file that no log entry references.
      await writeFile(
        join(testDir, "results", ".staging", "abc-123.json"),
        JSON.stringify({ tool: "record_search", retrieved: "x", returned_count: 1, payload: { results: [{}] } }),
      );

      const result = await validateProject(testDir);
      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => /orphan/.test(e.message))).toBe(false);
    });
  });

  describe("null / non-object guard", () => {
    it("returns an error (does not throw) for null research", async () => {
      const result = await validateParsed(null, minimalTree);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /research is null or not an object/.test(e.message))).toBe(
        true,
      );
    });

    it("returns an error (does not throw) for null tree", async () => {
      const result = await validateParsed(minimalResearch, null);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /tree is null or not an object/.test(e.message))).toBe(true);
    });

    it("returns an error for non-object inputs and runs no checks", async () => {
      const result = await validateParsed(42, "not a tree");
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it("does not throw on undefined inputs", async () => {
      await expect(
        validateParsed(undefined, undefined),
      ).resolves.toMatchObject({ valid: false });
    });
  });
});
