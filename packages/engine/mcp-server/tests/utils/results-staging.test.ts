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

    it("strips the advisory rankingSkipped note from the persisted payload", async () => {
      // The sidecar records what the upstream search RETURNED. `rankingSkipped`
      // is a ~250-char instruction to the model about how to call the tool
      // better next time, and it would otherwise be retained in 112 of 171
      // sidecars on a real run. Same reasoning as the `projectPath`/`subjectId`
      // strip on the echoed query: this file moves between machines.
      const response = {
        query: { surname: "Smith" },
        rankingSkipped: "No `subjectId`, so match-score ranking did not run.",
        results: [{ recordId: "R1" }],
      };
      const handle = await stageSearchResults({ projectPath: dir, tool: "record_search", response });

      const envelope = JSON.parse(await readFile(join(dir, handle!.resultsRef), "utf-8"));
      expect(envelope.payload.rankingSkipped).toBeUndefined();
      // Everything else is still verbatim, including key order.
      expect(envelope.payload).toEqual({
        query: { surname: "Smith" },
        results: [{ recordId: "R1" }],
      });
      // And the caller's own object is untouched — the strip must not mutate the
      // live response the model is about to read.
      expect(response.rankingSkipped).toBeTruthy();
    });

    it("keeps rankingSkipped out of the finalized sidecar too", async () => {
      const response = {
        query: { surname: "Smith" },
        rankingSkipped: "No `subjectId`, so match-score ranking did not run.",
        results: [{ recordId: "R1" }],
      };
      const handle = await stageSearchResults({ projectPath: dir, tool: "record_search", response });
      const final = await finalizeStagedResults({
        projectPath: dir,
        logId: "log_001",
        stagedResultsRef: handle!.resultsRef,
        expectedTool: "record_search",
      });

      const sidecar = JSON.parse(
        await readFile(join(dir, "results", "log_001.json"), "utf-8"),
      );
      expect(JSON.stringify(sidecar)).not.toContain("rankingSkipped");
      expect(final.resultsRef).toBe("results/log_001.json");
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
