import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, utimes, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  stageSearchResults,
  finalizeStagedResults,
  unloggedStagedSearches,
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

    it("persists the payload verbatim, key order included", async () => {
      // Verbatim is the contract (search-result-staging-spec.md). Withholding a
      // caller's advisory field is the CALLER's job — record_search does it by
      // passing a copy — so this transport, shared by three tools, must not know
      // one caller's field names.
      //
      // Key order asserted on the serialized text, not with toEqual, which is
      // order-insensitive and would pass against a payload rebuilt in any order.
      const response = {
        query: { surname: "Smith" },
        totalMatches: 1,
        results: [{ recordId: "R1" }],
      };
      const handle = await stageSearchResults({ projectPath: dir, tool: "record_search", response });

      const text = await readFile(join(dir, handle!.resultsRef), "utf-8");
      const envelope = JSON.parse(text);
      expect(envelope.payload).toEqual(response);
      expect(text.indexOf('"query"')).toBeLessThan(text.indexOf('"totalMatches"'));
      expect(text.indexOf('"totalMatches"')).toBeLessThan(text.indexOf('"results"'));
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

  describe("unloggedStagedSearches", () => {
    // A project the reader will accept: classifyProjectPath wants research.json
    // present before it will read anything out of the folder.
    const writeResearch = async (log: unknown[]) =>
      writeFile(join(dir, "research.json"), JSON.stringify({ log }, null, 2), "utf-8");

    const stage = async (tool = "record_search") =>
      stageSearchResults({
        projectPath: dir,
        tool,
        response: { results: [{ recordId: "R1" }] },
      });

    it("returns [] with no staging directory at all", async () => {
      await writeResearch([]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("returns one handle per staged file when the log is empty", async () => {
      await writeResearch([]);
      await stage();
      await stage();
      expect(await unloggedStagedSearches(dir)).toHaveLength(2);
    });

    it("returns handles the model can hand straight back as stagedResultsRef", async () => {
      // A bare count is unusable to the session that lost the ref, which is the
      // session this note exists for. The ref must come back with it.
      await writeResearch([]);
      const handle = await stage();
      const [unlogged] = await unloggedStagedSearches(dir);

      expect(unlogged.ref).toBe(handle!.resultsRef);
      expect(unlogged.tool).toBe("record_search");
      expect(Date.parse(unlogged.retrieved)).not.toBeNaN();

      // And it is a ref finalizeStagedResults actually accepts.
      await finalizeStagedResults({
        projectPath: dir,
        stagedResultsRef: unlogged.ref,
        logId: "log_009",
        expectedTool: unlogged.tool,
      });
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("stops counting a staged file once its search is logged", async () => {
      await writeResearch([]);
      const handle = await stage();
      expect(await unloggedStagedSearches(dir)).toHaveLength(1);

      // The real path: research_log_append finalizes, which unlinks the staged file.
      await finalizeStagedResults({
        projectPath: dir,
        stagedResultsRef: handle!.resultsRef,
        logId: "log_001",
        expectedTool: "record_search",
      });
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("does not count a staged file whose search was logged without a sidecar", async () => {
      // The ~10% population: logged with results, no `results_ref`, so finalize
      // never ran and the staged file outlives the entry that documents it.
      await stage();
      await writeResearch([
        {
          id: "log_001",
          tool: "record_search",
          performed: new Date(Date.now() + 1000).toISOString(),
          results_available: 4,
          results_ref: null,
        },
      ]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("still counts an unlogged staged file when the project also holds an older logged-without-sidecar entry", async () => {
      // Round 2's blocking case. Count subtraction gives max(0, 1 - 1) = 0 here even
      // though the entry predates the file and cannot be describing it.
      await stage();
      await writeResearch([
        {
          id: "log_001",
          tool: "record_search",
          performed: new Date(Date.now() - 60_000).toISOString(),
          results_available: 4,
          results_ref: null,
        },
      ]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(1);
    });

    it("pairs at most one staged file per unattached entry", async () => {
      await stage();
      await stage();
      await writeResearch([
        {
          id: "log_001",
          tool: "record_search",
          performed: new Date(Date.now() + 1000).toISOString(),
          results_available: 4,
          results_ref: null,
        },
      ]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(1);
    });

    it("does not pair across tools", async () => {
      await stage("record_search");
      await writeResearch([
        {
          id: "log_001",
          tool: "external_links_search",
          performed: new Date(Date.now() + 1000).toISOString(),
          results_available: 4,
          results_ref: null,
        },
      ]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(1);
    });

    it("ignores a staged file past the TTL, whether or not prune has swept it", async () => {
      await writeResearch([]);
      const handle = await stage();
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await utimes(join(dir, handle!.resultsRef), stale, stale);
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("still ignores a stale file after a nil search, which never prunes", async () => {
      // `pruneStale` runs inside `stageSearchResults` after its nil early-return, so
      // a nil search sweeps nothing. The reader's TTL skip has to stand on its own
      // rather than on the file being about to disappear.
      await writeResearch([]);
      const handle = await stage();
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await utimes(join(dir, handle!.resultsRef), stale, stale);

      // A nil search: stages nothing, prunes nothing.
      const nil = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { results: [] },
      });
      expect(nil).toBeNull();
      await access(join(dir, handle!.resultsRef)); // still on disk

      expect(await unloggedStagedSearches(dir)).toStrictEqual([]);
    });

    it("returns [] rather than throwing on an explicit null or empty projectPath", async () => {
      // The callers gate on `!== undefined`, so a null gets through to here and
      // `join(null, …)` is a TypeError — which would fail a search that already
      // succeeded. The absent case is covered by the tool tests; this is the shape
      // one over.
      expect(
        await unloggedStagedSearches(null as unknown as string),
      ).toStrictEqual([]);
      expect(await unloggedStagedSearches("")).toStrictEqual([]);
    });

    it("returns [] rather than throwing when research.json is unreadable", async () => {
      await stage();
      await writeFile(join(dir, "research.json"), "{ not json", "utf-8");
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
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
