import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, utimes, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  stageSearchResults,
  consumeStagedResults,
  finalizeStagedResults,
  unloggedStagedSearches,
  stripQueryPlumbing,
  readStagedEnvelopeQuery,
  resolveStagedRef,
  STAGING_SUBDIR,
} from "../../src/utils/results-staging.js";

import { STAGING_CAPABLE_TOOLS, STAGING_SEARCH_TOOLS } from "../../src/utils/results-staging.js";

describe("results-staging", () => {
  describe("the two producer sets (#2048)", () => {
    it("every search producer is a capable producer, and the three acquisition producers are capable too", () => {
      for (const t of STAGING_SEARCH_TOOLS) expect(STAGING_CAPABLE_TOOLS.has(t)).toBe(true);
      expect(STAGING_CAPABLE_TOOLS.has("image_transcribe")).toBe(true);
      expect(STAGING_CAPABLE_TOOLS.has("record_read")).toBe(true);
      expect(STAGING_CAPABLE_TOOLS.has("person_read")).toBe(true);
      // The notes stay search semantics: the acquisition producers are NOT search-shaped.
      expect(STAGING_SEARCH_TOOLS.has("image_transcribe")).toBe(false);
      expect(STAGING_SEARCH_TOOLS.has("record_read")).toBe(false);
      expect(STAGING_SEARCH_TOOLS.has("person_read")).toBe(false);
    });
  });

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

  describe("stripQueryPlumbing / readStagedEnvelopeQuery (#1779)", () => {
    it("strips projectPath and subjectId and keeps every other key", () => {
      expect(stripQueryPlumbing({ surname: "A", recordType: "birth", projectPath: "/p", subjectId: "I1" })).toEqual({
        surname: "A",
        recordType: "birth",
      });
    });

    it.each([["null", null], ["a string", "{}"], ["an array", []], ["undefined", undefined]])(
      "returns undefined for %s",
      (_label, value) => {
        expect(stripQueryPlumbing(value)).toBeUndefined();
      },
    );

    it("reads a staged handle's tool and stripped query without consuming it", async () => {
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { query: { surname: "A", projectPath: "/p" }, results: [{ recordId: "R1" }] },
      });
      expect(await readStagedEnvelopeQuery(dir, handle!.resultsRef)).toEqual({
        tool: "record_search",
        query: { surname: "A" },
      });
      expect(await stagingFiles()).toHaveLength(1);
    });

    it("returns undefined for a ref outside the staging dir, a missing file, or a traversal", async () => {
      await mkdir(join(dir, "results"), { recursive: true });
      await writeFile(join(dir, "results", "log_001.json"), JSON.stringify({ tool: "record_search", payload: { query: {} } }));
      expect(await readStagedEnvelopeQuery(dir, "results/log_001.json")).toBeUndefined();
      expect(await readStagedEnvelopeQuery(dir, `${STAGING_SUBDIR}/missing.json`)).toBeUndefined();
      expect(await readStagedEnvelopeQuery(dir, "../outside.json")).toBeUndefined();
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

    it("does not count a staged acquisition file with no log entry", async () => {
      // record-extraction logs an upload as `user_provided` and a record_read with
      // no stagedResultsRef, so neither file can ever pair; counting it would nag
      // the next search about a read that was logged correctly.
      await writeResearch([]);
      await stage("image_transcribe");
      await stage("record_read");
      await stage("person_read");
      expect(await unloggedStagedSearches(dir)).toEqual([]);
    });

    it("still counts an unlogged search staged beside an acquisition file", async () => {
      await writeResearch([]);
      await stage("image_transcribe");
      await stage("record_search");
      const unlogged = await unloggedStagedSearches(dir);
      expect(unlogged.map((u) => u.tool)).toEqual(["record_search"]);
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

      // And it is a ref finalizeStagedResults actually accepts; research_log_append
      // then consumes it once its research.json write commits.
      await finalizeStagedResults({
        projectPath: dir,
        stagedResultsRef: unlogged.ref,
        logId: "log_009",
        expectedTool: unlogged.tool,
      });
      await consumeStagedResults(dir, [unlogged.ref]);
      expect(await unloggedStagedSearches(dir)).toHaveLength(0);
    });

    it("stops counting a staged file once its search is logged", async () => {
      await writeResearch([]);
      const handle = await stage();
      expect(await unloggedStagedSearches(dir)).toHaveLength(1);

      // The real path: research_log_append finalizes, commits research.json, and
      // only then consumes the staged file.
      await finalizeStagedResults({
        projectPath: dir,
        stagedResultsRef: handle!.resultsRef,
        logId: "log_001",
        expectedTool: "record_search",
      });
      await consumeStagedResults(dir, [handle!.resultsRef]);
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
    it("wraps the staged file into results/<logId>.json, recomputes count, and KEEPS the staged file", async () => {
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

      // Not consumed: research_log_append removes it only after its commit, so a
      // call refused after finalizing leaves it for the corrected re-send.
      expect(await stagingFiles()).toHaveLength(1);
    });

    it("consumeStagedResults removes the staged file, and an absent ref is not an error", async () => {
      const handle = await stageSearchResults({
        projectPath: dir,
        tool: "record_search",
        response: { query: {}, results: [{ recordId: "A" }] },
      });
      await consumeStagedResults(dir, [handle!.resultsRef, `${STAGING_SUBDIR}/never-staged.json`]);
      expect(await stagingFiles()).toEqual([]);
    });

    it("names what to do when the staged ref is missing, and says invalid JSON when it is unparseable", async () => {
      await expect(
        finalizeStagedResults({
          projectPath: dir,
          stagedResultsRef: `${STAGING_SUBDIR}/gone.json`,
          logId: "log_001",
          expectedTool: "record_search",
        }),
      ).rejects.toThrow(/stagedResultsRef '.*gone\.json' is not in results\/\.staging\/ — each staged ref can be logged once/);

      await mkdir(join(dir, STAGING_SUBDIR), { recursive: true });
      await writeFile(join(dir, STAGING_SUBDIR, "bad.json"), "{not json", "utf-8");
      await expect(
        finalizeStagedResults({
          projectPath: dir,
          stagedResultsRef: `${STAGING_SUBDIR}/bad.json`,
          logId: "log_001",
          expectedTool: "record_search",
        }),
      ).rejects.toThrow(/stagedResultsRef '.*bad\.json' is invalid JSON/);
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

// The cases reproduce the copy errors a corpus-wide scan of the committed run
// logs found (11 of 3,636 ref-carrying calls): the init-project k8d pair is
// verbatim; for the others the differing characters are the real ones and the
// rest of the UUID is filled in.
describe("resolveStagedRef", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "resolve-ref-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const stage = async (...names: string[]) => {
    await mkdir(join(dir, STAGING_SUBDIR), { recursive: true });
    for (const n of names) await writeFile(join(dir, STAGING_SUBDIR, `${n}.json`), "{}");
  };
  const at = (n: string) => `${STAGING_SUBDIR}/${n}.json`;

  it("returns an exact ref unchanged, with no correction", async () => {
    await stage("dbef78b1-1e5f-438a-ac1d-9bee233874f9");
    expect(await resolveStagedRef(dir, at("dbef78b1-1e5f-438a-ac1d-9bee233874f9"))).toEqual({
      ref: at("dbef78b1-1e5f-438a-ac1d-9bee233874f9"),
    });
  });

  it.each([
    ["a dropped character (init-project k8d)", "dbef78b1-1e5f-438a-ac1d-9ee233874f9", "dbef78b1-1e5f-438a-ac1d-9bee233874f9"],
    ["one character changed (pedro-chaves-spouse)", "0b7e5f0c-61d4-4b8e-88a8-2173d1390cb4", "0b7e5f0c-61d4-4b8e-88a8-2273d1390cb4"],
    ["one character changed (anders-monsen)", "5d2c3a10-7c1e-4d55-a1b2-9824097a7245", "5d2c3a10-7c1e-4d55-a1b2-9824099a7245"],
    ["two characters changed (anders-monsen)", "87521b4-0e6f-4a8b-9c1d-2e3f4a5b6c7d", "87521cd4-0e6f-4a8b-9c1d-2e3f4a5b6c7d"],
  ])("maps a near-copy onto the one staged file — %s", async (_label, bad, good) => {
    await stage(good, "11111111-2222-4333-8444-555555555555");
    expect(await resolveStagedRef(dir, at(bad))).toEqual({ ref: at(good), correctedFrom: at(bad) });
  });

  it.each([
    ["a bare UUID", "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"],
    ["a bare UUID with .json", "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b.json"],
    ["a .staging/ prefix with no results/", ".staging/6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b.json"],
  ])("restores a dropped results/.staging/ prefix — %s", async (_label, bad) => {
    await stage("6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(await resolveStagedRef(dir, bad)).toEqual({
      ref: at("6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b"),
      correctedFrom: bad,
    });
  });

  it("completes a name cut short to a unique prefix of 8 or more characters", async () => {
    await stage("e2e868d0-91aa-4c2b-8f3e-0a1b2c3d4e5f", "77777777-2222-4333-8444-555555555555");
    expect(await resolveStagedRef(dir, at("e2e868d0"))).toEqual({
      ref: at("e2e868d0-91aa-4c2b-8f3e-0a1b2c3d4e5f"),
      correctedFrom: at("e2e868d0"),
    });
  });

  it.each([
    ["two staged files are both near it", ["aaaaaaaa-1111-4222-8333-444444444444", "aaaaaaaa-1111-4222-8333-444444444445"], at("aaaaaaaa-1111-4222-8333-44444444444")],
    ["it is more than three edits from every file", ["aaaaaaaa-1111-4222-8333-444444444444"], at("aaaaaaaa-1111-4222-8333-4444444xxxx4")],
    ["a prefix shorter than 8 characters", ["e2e868d0-91aa-4c2b-8f3e-0a1b2c3d4e5f"], at("e2e868d")],
    ["it names a finalized sidecar, not a staged file", ["aaaaaaaa-1111-4222-8333-444444444444"], "results/log_027.json"],
    ["it names another directory", ["aaaaaaaa-1111-4222-8333-444444444444"], "elsewhere/aaaaaaaa-1111-4222-8333-444444444444.json"],
    ["it walks out of the project", ["aaaaaaaa-1111-4222-8333-444444444444"], "../aaaaaaaa-1111-4222-8333-444444444444.json"],
  ])("never guesses when %s", async (_label, names, bad) => {
    await stage(...(names as string[]));
    expect(await resolveStagedRef(dir, bad as string)).toEqual({ ref: bad });
  });

  it("returns the ref unchanged when there is no staging directory at all", async () => {
    expect(await resolveStagedRef(dir, at("dbef78b1-1e5f-438a-ac1d-9ee233874f9"))).toEqual({
      ref: at("dbef78b1-1e5f-438a-ac1d-9ee233874f9"),
    });
  });
});
