/**
 * The two search tools' post-staging compaction, tested directly rather than
 * only through the tools.
 *
 * The tool suites already pin what each transformation does on a fresh
 * response. What they cannot cover is the property the eval harness newly
 * depends on: **idempotency**. `mock_mcp.py` applies these functions to canned
 * fixture responses. Every fixture is in the full shape today — measured, not
 * assumed — so nothing applies them twice yet. This pins the property before
 * the first fixture re-recorded from a live call arrives already compacted, at
 * which point a destructive second pass would reach the agent damaged with no
 * tool test seeing it.
 */

import { describe, it, expect } from "vitest";
import {
  compactStagedRecordSearch,
  compactStagedFulltextSearch,
  annotateResultsWithRanking,
} from "../../src/utils/staged-compaction.js";
import type { RecordSearchToolResponse } from "../../src/types/record-search.js";
import type { FulltextSearchResponse } from "../../src/types/fulltext-search.js";

function fullRecordSearchResponse(): RecordSearchToolResponse {
  return {
    query: {},
    totalMatches: 2,
    paginationCappedAt: 4999,
    returned: 1,
    offset: 0,
    hasMore: true,
    results: [
      {
        id: "ark:/61903/1:1:ABCD",
        gedcomx: { persons: [] },
        collectionId: "1234",
        collectionUrl: "https://familysearch.org/search/collection/1234",
        collectionTitle: "1850 United States Census",
        treeMatches: [],
        events: [
          { type: "Census", date: "1850", place: "Ohio" },
          { type: "Census", date: "1850", place: "Ohio" },
          { type: "Residence", date: "1850", place: "Ohio" },
        ],
      },
    ],
  } as unknown as RecordSearchToolResponse;
}

describe("compactStagedRecordSearch", () => {
  it("strips, hoists and de-duplicates on a full response", () => {
    const out = compactStagedRecordSearch(fullRecordSearchResponse());
    const row = out.results![0];

    expect(row.gedcomx).toBeUndefined();
    expect(row.collectionUrl).toBeUndefined();
    expect(row.collectionTitle).toBeUndefined();
    expect(row.treeMatches).toBeUndefined();
    expect(row.events).toHaveLength(2);
    expect(out.collections).toEqual({ "1234": "1850 United States Census" });
    // Kept deliberately — rank_search_matches skips a candidate without it.
    expect(row.collectionId).toBe("1234");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = compactStagedRecordSearch(fullRecordSearchResponse());
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = compactStagedRecordSearch(once);
    expect(JSON.parse(JSON.stringify(twice))).toEqual(snapshot);
  });

  it("does not blank an existing collections map when no row carries a title", () => {
    // The shape an already-compacted fixture has: response-level `collections`,
    // no per-row `collectionTitle`. A naive re-run would overwrite it with {}.
    const alreadyCompacted = {
      query: {},
      totalMatches: 1,
      paginationCappedAt: 4999,
      returned: 1,
      offset: 0,
      hasMore: false,
      collections: { "1234": "1850 United States Census" },
      results: [{ id: "ark:/61903/1:1:ABCD", collectionId: "1234" }],
    } as unknown as RecordSearchToolResponse;

    const out = compactStagedRecordSearch(alreadyCompacted);
    expect(out.collections).toEqual({ "1234": "1850 United States Census" });
  });

  it("leaves a nil result set alone", () => {
    const nil = {
      query: {},
      totalMatches: 0,
      paginationCappedAt: 4999,
      returned: 0,
      offset: 0,
      hasMore: false,
      results: [],
    } as unknown as RecordSearchToolResponse;

    const out = compactStagedRecordSearch(nil);
    expect(out.results).toEqual([]);
    expect(out.collections).toBeUndefined();
  });
});

describe("compactStagedFulltextSearch", () => {
  it("drops textDocument from every row", () => {
    const full = {
      query: {},
      totalResults: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      results: [
        { id: "ark:/61903/3:1:ABCD", textDocument: "x".repeat(5000), title: "Deed Book A" },
      ],
    } as unknown as FulltextSearchResponse;

    const out = compactStagedFulltextSearch(full);
    expect(out.results![0].textDocument).toBeUndefined();
    // The triage stubs survive — this is what search-full-text reads.
    expect(out.results![0].title).toBe("Deed Book A");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = compactStagedFulltextSearch({
      query: {},
      totalResults: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      results: [{ id: "ark:/61903/3:1:ABCD", textDocument: "page text" }],
    } as unknown as FulltextSearchResponse);
    const snapshot = JSON.parse(JSON.stringify(once));
    const twice = compactStagedFulltextSearch(once);
    expect(JSON.parse(JSON.stringify(twice))).toEqual(snapshot);
  });
});

/**
 * `results` is dropped only when `ranked` genuinely replaces it (#1212). The
 * condition is positive and two-part; each arm below is a distinct production
 * shape, and a length-only condition silently fails the last one.
 */
describe("annotateResultsWithRanking", () => {
  const rowA = { recordId: "ark:/61903/1:1:AAAA-AA1", events: [] };
  const rowB = { recordId: "ark:/61903/1:1:BBBB-BB2", events: [] };

  const resp = (ranked?: unknown) =>
    ({ results: [rowA, rowB].map((r) => ({ ...r })), ...(ranked ? { ranked } : {}) }) as never;

  const rankedWith = (matches: unknown[], extra: Record<string, unknown> = {}) =>
    ({ subjectId: "I1", scoredCount: matches.length, returnedCount: matches.length, matches, ...extra });

  it("annotates the rows in place and returns them best first", () => {
    // B scores higher, so it comes back first — and its ORIGINAL position
    // survives on searchRank, which is what makes the re-order auditable.
    const out = annotateResultsWithRanking(
      resp(rankedWith([
        { recordId: rowB.recordId, matchRank: 1, searchRank: 2, matchScore: 0.9, matchConfidence: 9 },
        { recordId: rowA.recordId, matchRank: 2, searchRank: 1, matchScore: 0.2 },
      ])),
    );
    expect(out.results.map((r) => r.recordId)).toEqual([rowB.recordId, rowA.recordId]);
    expect(out.results[0]).toMatchObject({ matchRank: 1, searchRank: 2, matchScore: 0.9, matchConfidence: 9 });
    expect(out.results[1]).toMatchObject({ matchRank: 2, searchRank: 1, matchScore: 0.2 });
  });

  it("gives up the duplicate row list: `ranked` keeps metadata, not matches", () => {
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    expect(out.ranked).toBeDefined();
    expect((out.ranked as { matches?: unknown }).matches).toBeUndefined();
    expect(out.ranked).toMatchObject({ subjectId: "I1", scoredCount: 1 });
  });

  it("never drops a row — results is always present and complete", () => {
    for (const ranked of [
      undefined,
      rankedWith([]),
      rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.1 }], { subjectResolvable: false }),
    ]) {
      const out = annotateResultsWithRanking(resp(ranked));
      expect(out.results).toHaveLength(2);
    }
  });

  it("keeps an unscored row, sorted after the scored ones", () => {
    // Only A was scored. B is not dropped and not promoted — it trails.
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    expect(out.results.map((r) => r.recordId)).toEqual([rowA.recordId, rowB.recordId]);
    expect(out.results[1].matchRank).toBeUndefined();
  });

  it("matches on the bare id, so a bare-vs-canonical ARK still annotates", () => {
    // Fixtures predate canonical ARKs and carry `AAAA-AA1` against
    // `ark:/61903/1:1:AAAA-AA1`. Exact matching would annotate nothing.
    const out = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: "AAAA-AA1", matchRank: 1, searchRank: 1, matchScore: 0.7 }])),
    );
    expect(out.results[0]).toMatchObject({ recordId: rowA.recordId, matchScore: 0.7 });
  });

  it("is idempotent", () => {
    const once = annotateResultsWithRanking(
      resp(rankedWith([{ recordId: rowA.recordId, matchRank: 1, searchRank: 1, matchScore: 0.5 }])),
    );
    const twice = annotateResultsWithRanking({ ...once } as never);
    expect(twice.results).toEqual(once.results);
  });
});

describe("#1212 payload", () => {
  const ROWS = 50;

  /** A row with the fields a real staged (post-compaction) search row carries. */
  const row = (i: number) => ({
    recordId: `ark:/61903/1:1:ABCD-${String(i).padStart(3, "0")}`,
    primaryId: `p${i}`,
    personName: `Patrick Flynn ${i}`,
    sex: "Male",
    birthDate: "12 March 1845",
    birthPlace: "County Cork, Ireland",
    deathDate: "4 August 1912",
    deathPlace: "Philadelphia, Pennsylvania, United States",
    events: [
      { type: "Birth", date: "12 March 1845", place: "County Cork, Ireland" },
      { type: "Residence", date: "1880", place: "Philadelphia, Pennsylvania" },
    ],
    collectionId: "2000123",
    recordTitle: "Pennsylvania Deaths and Burials, 1720-1999",
    treeMatches: [{ id: `KWZZ-${i}`, name: `Patrick Flynn` }],
    recordArk: `ark:/61903/1:2:WXYZ-${String(i).padStart(3, "0")}`,
    score: 0.42,
    confidence: 3,
  });

  /** The ranked stub this branch emits: the row plus rank/score, minus FS relevance. */
  const stub = (i: number) => {
    const { score: _s, confidence: _c, ...rest } = row(i);
    return { matchRank: i + 1, searchRank: i + 1, ...rest, matchScore: 0.9, matchConfidence: 7 };
  };

  it("is smaller than the results-plus-top-10-ranked shape it replaces", () => {
    const before = JSON.stringify({
      results: Array.from({ length: ROWS }, (_, i) => row(i)),
      ranked: {
        subjectId: "KNS4-P6W",
        scoredCount: ROWS,
        returnedCount: 10,
        // the old lean stub: no events/collectionId/recordTitle/treeMatches
        matches: Array.from({ length: 10 }, (_, i) => {
          const { events: _e, collectionId: _ci, recordTitle: _rt, treeMatches: _tm, ...lean } = stub(i);
          return lean;
        }),
      },
    }).length;

    const after = JSON.stringify({
      ranked: {
        subjectId: "KNS4-P6W",
        scoredCount: ROWS,
        returnedCount: ROWS,
        matches: Array.from({ length: ROWS }, (_, i) => stub(i)),
      },
    }).length;

    // Measured on this branch at 50 rows, not quoted from the issue:
    //   before 34,147   after 32,585   delta -1,562 (-4.6%)
    // Bounds are loose enough to survive a field-width edit and tight enough
    // that swapping either shape for the other fails.
    expect(before).toBeGreaterThan(33_000);
    expect(before).toBeLessThan(35_500);
    expect(after).toBeGreaterThan(31_500);
    expect(after).toBeLessThan(34_000);
    expect(after).toBeLessThan(before);
    // "Flat or better" (#1212 ask 5) — and it IS only ~5%, because the saving
    // is the deduplication, not the stub being lean: a rich stub (645 B) is
    // WIDER than a full row (607 B). Asserted as a floor so a future field
    // added to the stub without a matching saving turns this red rather than
    // quietly eating the margin.
    expect((before - after) / before).toBeGreaterThan(0.03);
  });
});
