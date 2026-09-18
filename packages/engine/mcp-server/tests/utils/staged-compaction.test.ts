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

  it("preserves flat top-level fields (role, relativeTerms, batchNumber) after gedcomx is stripped", () => {
    const resp = fullRecordSearchResponse();
    (resp.results[0] as any).role = "Principal";
    (resp.results[0] as any).batchNumber = "M01048-5";
    (resp.results[0] as any).relativeTerms = { father: { present: true } };

    const out = compactStagedRecordSearch(resp);
    const row = out.results[0] as any;
    expect(row.gedcomx).toBeUndefined();
    expect(row.role).toBe("Principal");
    expect(row.batchNumber).toBe("M01048-5");
    expect(row.relativeTerms).toEqual({ father: { present: true } });
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
 * `results` is ALWAYS present and complete; the ranking rides on the rows
 * (#1212 ruling, 2026-09-15). There is no drop decision left to make, so the
 * property each arm below holds is that nothing goes MISSING: every row
 * survives, an unscored row trails the scored ones rather than vanishing, and
 * `ranked` gives up `matches` once the scores are on the rows.
 *
 * The earlier design dropped `results` behind a positive two-part condition.
 * That is gone, and so is the failure mode worth guarding then (a length-only
 * condition silently failing the scoreable-no-match arm). Do not reinstate a
 * drop here without re-measuring the payload claim in `#1212 payload` below:
 * the drop shape was BIGGER, because its stub re-carried `collectionTitle`.
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

  /** A row as it leaves compaction: `collectionTitle` has been HOISTED into the
   *  response-level `collections` map, so the row carries only `collectionId`. */
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

  /** The stub the DROP shape emitted. Note `collectionTitle`: the stub put back
   *  on every scored row the exact string compaction had just hoisted out of the
   *  rows — the duplication that made the old -4.6% figure wrong. */
  const oldStub = (i: number) => {
    const { score: _s, confidence: _c, ...rest } = row(i);
    return {
      matchRank: i + 1,
      searchRank: i + 1,
      ...rest,
      collectionTitle: "Pennsylvania Deaths and Burials, 1720-1999",
      matchScore: 0.9,
      matchConfidence: 7,
      candidateFactCount: 4,
    };
  };

  /** Option B: the row itself, annotated. No second copy of anything. */
  const annotated = (i: number) => ({
    ...row(i),
    matchRank: i + 1,
    searchRank: i + 1,
    matchScore: 0.9,
    matchConfidence: 7,
    candidateFactCount: 4,
  });

  const collections = { "2000123": "Pennsylvania Deaths and Burials, 1720-1999" };

  it("is smaller than the drop shape it replaces, because nothing is duplicated", () => {
    // BEFORE — the drop shape: rows gone, every scored candidate re-emitted as a
    // stub that re-carries the hoisted collection title.
    const before = JSON.stringify({
      collections,
      ranked: {
        subjectId: "KNS4-P6W",
        scoredCount: ROWS,
        returnedCount: ROWS,
        matches: Array.from({ length: ROWS }, (_, i) => oldStub(i)),
      },
    }).length;

    // AFTER — Option B: one annotated row list, `ranked` metadata only.
    const after = JSON.stringify({
      collections,
      results: Array.from({ length: ROWS }, (_, i) => annotated(i)),
      ranked: { subjectId: "KNS4-P6W", scoredCount: ROWS, returnedCount: ROWS },
    }).length;

    // Measured on this branch at 50 rows, not quoted from the issue:
    //   before 36,956   after 35,206   delta -1,750 (-4.7%)
    //
    // The saving is STRUCTURAL: the drop shape's stub re-introduced
    // `collectionTitle` on every scored row after compaction had just hoisted it
    // into `collections`. Option B has no stub, so it cannot reintroduce
    // anything. That is also why the PR's original -4.6% was wrong — the
    // fixture it was measured on had no `collectionTitle` to duplicate, so it
    // priced a saving the real shape never had (review: about +2.7% against
    // production's shape, i.e. the drop shape was BIGGER).
    //
    // Floor is 3%, under the measured 4.7%, so a field-width edit does not red
    // this while a regression that reintroduces duplication does.
    expect(after).toBeLessThan(before);
    expect((before - after) / before).toBeGreaterThan(0.03);

    // The ABSOLUTE figures, pinned because the rank spec quotes them by name.
    // The ratio assertions above cannot hold them: widening a field moves both
    // sides together and leaves the delta at 4.7%, so the spec's "36,956 /
    // 35,206" would rot with the suite green — which is exactly how the -4.6%
    // this replaced survived the pivot to Option B. Band is +/-1%, wide enough
    // that reflowing a fixture string does not red it and narrow enough that a
    // real shape change does.
    //
    // If these fail, the fixture moved: re-measure, then update BOTH this block
    // and docs/specs/rank-search-matches-tool-spec.md, which cites the pair.
    expect(before).toBeGreaterThan(36956 * 0.99);
    expect(before).toBeLessThan(36956 * 1.01);
    expect(after).toBeGreaterThan(35206 * 0.99);
    expect(after).toBeLessThan(35206 * 1.01);
  });

  it("the ranking annotation is a small fraction of the row it rides on", () => {
    // Guards the other direction: if a future field makes the annotation heavy,
    // "annotate in place" stops being obviously the cheaper shape.
    // Measured: bare row 607 B, annotated 696 B — the ranking costs 89 B
    // (14.7%) per row. Ceiling 25% leaves room for one more score field before
    // this needs re-thinking, and reds if the annotation starts rivalling the
    // row it rides on.
    const bare = JSON.stringify(row(0)).length;
    const withScore = JSON.stringify(annotated(0)).length;
    expect(withScore - bare).toBeLessThan(bare * 0.25);
  });
});

