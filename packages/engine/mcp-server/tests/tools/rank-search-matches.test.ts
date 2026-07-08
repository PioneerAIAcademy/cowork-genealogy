import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Mock the FS token and the pair scorer — this is a pure unit test of the
// re-ranker's read/score/rank/log orchestration, not of matchTwoExamples.
vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));
vi.mock("../../src/utils/match-engine.js", () => ({
  scorePair: vi.fn(),
}));

import { rankSearchMatches } from "../../src/tools/rank-search-matches.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { scorePair } from "../../src/utils/match-engine.js";
import {
  stageSearchResults,
  finalizeStagedResults,
  STAGING_SUBDIR,
} from "../../src/utils/results-staging.js";
import type { SamePersonResult } from "../../src/types/same-person.js";

const getValidTokenMock = vi.mocked(getValidToken);
const scorePairMock = vi.mocked(scorePair);

beforeEach(() => {
  getValidTokenMock.mockReset();
  getValidTokenMock.mockResolvedValue("test-token");
  scorePairMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SUBJECT_ID = "KNS4-P6W";

const subjectTree = {
  persons: [
    {
      id: SUBJECT_ID,
      names: [{ preferred: true, given: "Kenneth Werner", surname: "Quass" }],
      facts: [{ type: "Birth", date: "4 Dec 1917" }],
    },
  ],
  relationships: [],
  sources: [],
};

function scoreResult(score: number, confidence?: number): SamePersonResult {
  const out: SamePersonResult = {
    matched: confidence !== undefined,
    score,
    queryArk: "ark:/61903/1:1:QUERY",
    candidateArk: "ark:/61903/1:1:CAND",
    apiTitle: "Matches for ark:/61903/1:1:QUERY",
    updated: "2026-07-06T00:00:00.000Z",
  };
  if (confidence !== undefined) out.confidence = confidence;
  return out;
}

interface CandOpts {
  recordId: string;
  primaryId?: string;
  hasGedcomx?: boolean;
  personName?: string;
  birthDate?: string;
  deathDate?: string;
  collectionTitle?: string;
  recordArk?: string;
}

function candidate(opts: CandOpts): Record<string, unknown> {
  const r: Record<string, unknown> = {
    recordId: opts.recordId,
    events: [],
    treeMatches: [],
  };
  if (opts.hasGedcomx !== false) {
    r.gedcomx = {
      persons: [
        {
          id: opts.primaryId ?? "p",
          names: [{ preferred: true, given: "A", surname: "B" }],
        },
      ],
    };
  }
  if (opts.primaryId) r.primaryId = opts.primaryId;
  if (opts.personName) r.personName = opts.personName;
  if (opts.birthDate) r.birthDate = opts.birthDate;
  if (opts.deathDate) r.deathDate = opts.deathDate;
  if (opts.collectionTitle) r.collectionTitle = opts.collectionTitle;
  if (opts.recordArk) r.recordArk = opts.recordArk;
  return r;
}

describe("rank_search_matches", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rank-search-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTree(tree: unknown = subjectTree): Promise<void> {
    await writeFile(
      join(dir, "tree.gedcomx.json"),
      JSON.stringify(tree, null, 2),
      "utf-8",
    );
  }

  async function stage(results: unknown[]): Promise<string> {
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: { results },
    });
    if (!handle) throw new Error("expected a staged handle");
    return handle.resultsRef;
  }

  const readScoreLog = async (): Promise<Record<string, unknown>[]> => {
    const text = await readFile(
      join(dir, "results/match-scores.jsonl"),
      "utf-8",
    );
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  };

  // ── Return shape / ordering / top-N ────────────────────────────────────────

  it("returns top-N stubs sorted by matchScore desc (nulls last), searchRank preserved", async () => {
    await writeTree();
    // c5 has no gedcomx → skipped, scored null with no FS call (fast).
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1", personName: "Best" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA2", primaryId: "p2", personName: "Low" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA3", primaryId: "p3", personName: "Mid" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA5", hasGedcomx: false, personName: "NoDoc" }),
    ]);

    const scores: Record<string, number> = { p1: 0.99, p2: 0.3, p3: 0.72 };
    scorePairMock.mockImplementation(async (_g1, id1) =>
      scoreResult(scores[id1], scores[id1] > 0.5 ? 5 : undefined),
    );

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.subjectId).toBe(SUBJECT_ID);
    expect(out.scoredCount).toBe(4);
    expect(out.returnedCount).toBe(4);
    expect(out.scoringErrors).toBe(0);
    expect(out.scoreLogError).toBeNull();

    // Sorted: p1(0.99) → p3(0.72) → p2(0.30) → the no-gedcomx null last.
    expect(out.matches.map((m) => m.recordId)).toEqual([
      "ark:/61903/1:1:AAAA-AA1",
      "ark:/61903/1:1:AAAA-AA3",
      "ark:/61903/1:1:AAAA-AA2",
      "ark:/61903/1:1:AAAA-AA5",
    ]);
    expect(out.matches.map((m) => m.matchRank)).toEqual([1, 2, 3, 4]);
    // searchRank carries the original staged position (1-based).
    expect(out.matches.map((m) => m.searchRank)).toEqual([1, 3, 2, 4]);
    expect(out.matches[0].matchScore).toBeCloseTo(0.99);
    expect(out.matches[0].matchConfidence).toBe(5);
    expect(out.matches[3].matchScore).toBeNull();
    // The no-gedcomx candidate never hit the scorer.
    expect(scorePairMock).toHaveBeenCalledTimes(3);
  });

  it("returns exactly `top` stubs when top < scoredCount", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA2", primaryId: "p2" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA3", primaryId: "p3" }),
    ]);
    const scores: Record<string, number> = { p1: 0.9, p2: 0.4, p3: 0.7 };
    scorePairMock.mockImplementation(async (_g1, id1) => scoreResult(scores[id1], 5));

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
      top: 2,
    });

    expect(out.scoredCount).toBe(3);
    expect(out.returnedCount).toBe(2);
    expect(out.matches).toHaveLength(2);
    expect(out.matches.map((m) => m.recordId)).toEqual([
      "ark:/61903/1:1:AAAA-AA1",
      "ark:/61903/1:1:AAAA-AA3",
    ]);
  });

  // ── Full-set score-log append + best-effort scoreLogError ──────────────────

  it("appends the FULL scored set (not just top) to results/match-scores.jsonl", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1", personName: "Best", birthDate: "1917", collectionTitle: "Find A Grave Index" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA2", primaryId: "p2" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA3", primaryId: "p3" }),
    ]);
    const scores: Record<string, number> = { p1: 0.99, p2: 0.2, p3: 0.6 };
    scorePairMock.mockImplementation(async (_g1, id1) =>
      scoreResult(scores[id1], scores[id1] > 0.5 ? 5 : undefined),
    );

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
      top: 1, // only 1 returned, but all 3 must be logged
    });

    expect(out.returnedCount).toBe(1);

    const log = await readScoreLog();
    expect(log).toHaveLength(3);
    // Ordered by match_rank ascending; snake_case; verbatim ARK record_id.
    expect(log.map((l) => l.match_rank)).toEqual([1, 2, 3]);
    expect(log.map((l) => l.record_id)).toEqual([
      "ark:/61903/1:1:AAAA-AA1",
      "ark:/61903/1:1:AAAA-AA3",
      "ark:/61903/1:1:AAAA-AA2",
    ]);
    expect(log[0]).toMatchObject({
      subject_id: SUBJECT_ID,
      staged_results_ref: ref,
      search_rank: 1,
      person_name: "Best",
      birth_date: "1917",
      collection_title: "Find A Grave Index",
      match_score: 0.99,
      match_confidence: 5,
    });
    expect(typeof log[0].performed).toBe("string");
  });

  it("surfaces scoreLogError (and still succeeds) when the log append fails", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
    ]);
    scorePairMock.mockResolvedValue(scoreResult(0.9, 5));

    // Force EISDIR: pre-create the score-log path as a directory.
    await mkdir(join(dir, "results/match-scores.jsonl"), { recursive: true });

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.scoreLogError).toBeTruthy();
    expect(typeof out.scoreLogError).toBe("string");
    // The rank call itself still returned its matches.
    expect(out.returnedCount).toBe(1);
    expect(out.matches[0].matchScore).toBeCloseTo(0.9);
  });

  // ── Null-score handling (never dropped) ────────────────────────────────────

  it("keeps a persistently-failing pair with matchScore null and counts scoringErrors", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA4", primaryId: "pfail" }),
    ]);
    scorePairMock.mockImplementation(async (_g1, id1) => {
      if (id1 === "pfail") throw new Error("transient FS failure");
      return scoreResult(0.95, 5);
    });

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.scoredCount).toBe(2);
    expect(out.scoringErrors).toBe(1);
    // The failing pair is present (nulls last), never dropped.
    const failed = out.matches.find((m) => m.recordId === "ark:/61903/1:1:AAAA-AA4");
    expect(failed).toBeDefined();
    expect(failed!.matchScore).toBeNull();
    expect(out.matches).toHaveLength(2);
  });

  it("does NOT count a skipped (no gedcomx / no primaryId) candidate as a scoringError", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA5", hasGedcomx: false }),
    ]);
    scorePairMock.mockResolvedValue(scoreResult(0.9, 5));

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.scoringErrors).toBe(0);
    expect(out.scoredCount).toBe(2);
    const skipped = out.matches.find((m) => m.recordId === "ark:/61903/1:1:AAAA-AA5");
    expect(skipped!.matchScore).toBeNull();
    expect(scorePairMock).toHaveBeenCalledTimes(1);
  });

  // ── subjectResolvable: false ───────────────────────────────────────────────

  it("sets subjectResolvable:false when every score sits at/below the degenerate floor", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA2", primaryId: "p2" }),
    ]);
    scorePairMock.mockResolvedValue(scoreResult(0.001)); // near-zero, no confidence

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.subjectResolvable).toBe(false);
  });

  it("omits subjectResolvable when at least one score clears the floor", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
    ]);
    scorePairMock.mockResolvedValue(scoreResult(0.8, 5));

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: ref,
      subjectId: SUBJECT_ID,
    });

    expect(out.subjectResolvable).toBeUndefined();
  });

  // ── Empty staged results (not an error) ────────────────────────────────────

  it("returns an empty shape for an empty staged set without erroring or logging", async () => {
    await writeTree();
    await mkdir(join(dir, STAGING_SUBDIR), { recursive: true });
    const rel = `${STAGING_SUBDIR}/empty.json`;
    await writeFile(
      join(dir, rel),
      JSON.stringify({ tool: "record_search", payload: { results: [] } }),
      "utf-8",
    );

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: rel,
      subjectId: SUBJECT_ID,
    });

    expect(out).toMatchObject({ scoredCount: 0, returnedCount: 0, matches: [] });
    expect(out.scoreLogError).toBeNull();
    // No scoring, no token needed, no log written.
    expect(scorePairMock).not.toHaveBeenCalled();
    await expect(access(join(dir, "results/match-scores.jsonl"))).rejects.toThrow();
  });

  // ── Guard rejections ───────────────────────────────────────────────────────

  it("rejects a path-traversal ref", async () => {
    await writeTree();
    await expect(
      rankSearchMatches({
        projectPath: dir,
        stagedResultsRef: "../evil.json",
        subjectId: SUBJECT_ID,
      }),
    ).rejects.toThrow(/escapes the project directory/);
  });

  it("rejects a ref that is neither a staged handle nor a top-level results sidecar", async () => {
    await writeTree();
    await expect(
      rankSearchMatches({
        projectPath: dir,
        stagedResultsRef: "notresults/x.json",
        subjectId: SUBJECT_ID,
      }),
    ).rejects.toThrow(/must be a staged handle/);
  });

  it("rejects a missing staged file", async () => {
    await writeTree();
    await expect(
      rankSearchMatches({
        projectPath: dir,
        stagedResultsRef: `${STAGING_SUBDIR}/missing.json`,
        subjectId: SUBJECT_ID,
      }),
    ).rejects.toThrow(/does not exist or is invalid JSON/);
  });

  it("rejects an envelope with no payload.results array", async () => {
    await writeTree();
    await mkdir(join(dir, STAGING_SUBDIR), { recursive: true });
    const rel = `${STAGING_SUBDIR}/malformed.json`;
    await writeFile(join(dir, rel), JSON.stringify({ tool: "record_search", payload: {} }), "utf-8");

    await expect(
      rankSearchMatches({
        projectPath: dir,
        stagedResultsRef: rel,
        subjectId: SUBJECT_ID,
      }),
    ).rejects.toThrow(/no payload\.results array/);
  });

  it("rejects a subjectId absent from tree.gedcomx.json, naming the id", async () => {
    await writeTree();
    const ref = await stage([
      candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" }),
    ]);
    await expect(
      rankSearchMatches({
        projectPath: dir,
        stagedResultsRef: ref,
        subjectId: "NOPE-XYZ",
      }),
    ).rejects.toThrow(/NOPE-XYZ/);
  });

  // ── Read-only + finalizable ────────────────────────────────────────────────

  it("never unlinks the staged file — it remains finalizable after ranking", async () => {
    await writeTree();
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: {
        results: [candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" })],
      },
    });
    if (!handle) throw new Error("expected a staged handle");
    scorePairMock.mockResolvedValue(scoreResult(0.9, 5));

    await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: handle.resultsRef,
      subjectId: SUBJECT_ID,
    });

    // Still on disk after the read-only rank call.
    await expect(access(join(dir, handle.resultsRef))).resolves.toBeUndefined();

    // And research_log_append's finalize path still works against it.
    const final = await finalizeStagedResults({
      projectPath: dir,
      stagedResultsRef: handle.resultsRef,
      logId: "log_001",
      expectedTool: "record_search",
    });
    expect(final.resultsRef).toBe("results/log_001.json");
    await expect(access(join(dir, "results/log_001.json"))).resolves.toBeUndefined();
  });

  // ── Finalized-ref acceptance ───────────────────────────────────────────────

  it("also accepts a finalized top-level results/<log_id>.json ref", async () => {
    await writeTree();
    await mkdir(join(dir, "results"), { recursive: true });
    const rel = "results/log_007.json";
    await writeFile(
      join(dir, rel),
      JSON.stringify({
        log_id: "log_007",
        tool: "record_search",
        payload: {
          results: [candidate({ recordId: "ark:/61903/1:1:AAAA-AA1", primaryId: "p1" })],
        },
      }),
      "utf-8",
    );
    scorePairMock.mockResolvedValue(scoreResult(0.9, 5));

    const out = await rankSearchMatches({
      projectPath: dir,
      stagedResultsRef: rel,
      subjectId: SUBJECT_ID,
    });

    expect(out.scoredCount).toBe(1);
    expect(out.matches[0].recordId).toBe("ark:/61903/1:1:AAAA-AA1");
  });
});
