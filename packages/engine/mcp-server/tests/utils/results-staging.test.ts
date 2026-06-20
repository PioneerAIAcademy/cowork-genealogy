import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, utimes, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  stageSearchResults,
  finalizeStagedResults,
  STAGING_SUBDIR,
} from "../../src/utils/results-staging.js";

describe("results-staging", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "staging-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const stagingFiles = async () => {
    try {
      return (await readdir(join(dir, STAGING_SUBDIR))).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
  };

  describe("stageSearchResults", () => {
    it("stages a hit and returns a handle", async () => {
      const response = { query: { surname: "Smith" }, results: [{ recordId: "R1" }, { recordId: "R2" }] };
      const handle = await stageSearchResults({ projectPath: dir, tool: "record_search", response });

      expect(handle).not.toBeNull();
      expect(handle!.returnedCount).toBe(2);
      expect(handle!.resultsRef.startsWith(`${STAGING_SUBDIR}/`)).toBe(true);

      const envelope = JSON.parse(await readFile(join(dir, handle!.resultsRef), "utf-8"));
      expect(envelope.tool).toBe("record_search");
      expect(envelope.returned_count).toBe(2);
      expect(envelope.payload).toEqual(response);
      expect(typeof envelope.retrieved).toBe("string");
    });

    it("returns null and writes nothing for a nil search", async () => {
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { results: [] },
      });
      expect(handle).toBeNull();
      expect(await stagingFiles()).toEqual([]);
    });

    it("prunes staging files older than the TTL on the next write", async () => {
      await mkdir(join(dir, STAGING_SUBDIR), { recursive: true });
      const stale = join(dir, STAGING_SUBDIR, "stale.json");
      await writeFile(stale, "{}", "utf-8");
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await utimes(stale, old, old);

      await stageSearchResults({ projectPath: dir, tool: "record_search", response: { results: [{ recordId: "R1" }] } });

      const remaining = await stagingFiles();
      expect(remaining).not.toContain("stale.json");
      expect(remaining).toHaveLength(1); // the fresh one
    });
  });

  describe("finalizeStagedResults", () => {
    it("wraps the staged file into results/<logId>.json, recomputes count, and unlinks the staged file", async () => {
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { query: {}, results: [{ recordId: "A" }, { recordId: "B" }, { recordId: "C" }] },
      });

      const fin = await finalizeStagedResults({
        projectPath: dir,
        stagedResultsRef: handle!.resultsRef,
        logId: "log_005",
        expectedTool: "record_search",
      });

      expect(fin.resultsRef).toBe("results/log_005.json");
      expect(fin.returnedCount).toBe(3);

      const sidecar = JSON.parse(await readFile(join(dir, "results", "log_005.json"), "utf-8"));
      expect(sidecar).toMatchObject({ log_id: "log_005", tool: "record_search", returned_count: 3 });
      expect(sidecar.payload.results).toHaveLength(3);

      // staged file consumed.
      expect(await stagingFiles()).toEqual([]);
    });

    it("rejects a ref outside results/.staging/", async () => {
      await writeFile(join(dir, "elsewhere.json"), JSON.stringify({ tool: "record_search", payload: { results: [] } }));
      await expect(
        finalizeStagedResults({
          projectPath: dir,
          stagedResultsRef: "elsewhere.json",
          logId: "log_001",
          expectedTool: "record_search",
        }),
      ).rejects.toThrow(/not inside results\/\.staging/);
    });

    it("rejects a traversal escape", async () => {
      await expect(
        finalizeStagedResults({
          projectPath: dir,
          stagedResultsRef: "../../../etc/passwd",
          logId: "log_001",
          expectedTool: "record_search",
        }),
      ).rejects.toThrow(/escapes the project directory/);
    });

    it("rejects a tool mismatch", async () => {
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "fulltext_search",
        response: { results: [{ recordId: "A" }] },
      });
      await expect(
        finalizeStagedResults({
          projectPath: dir,
          stagedResultsRef: handle!.resultsRef,
          logId: "log_001",
          expectedTool: "record_search",
        }),
      ).rejects.toThrow(/does not match log entry tool/);
    });
  });
});
