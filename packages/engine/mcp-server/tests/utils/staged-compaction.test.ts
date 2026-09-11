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
  dropInlineResultsWhenRanked,
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
describe("dropInlineResultsWhenRanked", () => {
  const row = { recordId: "ark:/61903/1:1:AAAA-AA1" };

  /** A response carrying `results`, plus whatever `ranked` the case needs. */
  function resp(ranked?: unknown): RecordSearchToolResponse {
    return {
      results: [row],
      ...(ranked === undefined ? {} : { ranked }),
    } as unknown as RecordSearchToolResponse;
  }

  const rankedWith = (matches: unknown[], extra: Record<string, unknown> = {}) => ({
    subjectId: "KNS4-P6W",
    scoredCount: matches.length,
    returnedCount: matches.length,
    matches,
    ...extra,
  });

  it("drops `results` when ranking produced usable rows", () => {
    const out = dropInlineResultsWhenRanked(resp(rankedWith([{ matchRank: 1 }])));
    expect(out.results).toBeUndefined();
    expect(out.ranked).toBeTruthy();
  });

  it("keeps `results` when ranking never ran (`ranked` absent)", () => {
    // No staged ref, no subjectId, or no projectPath — record-search.ts never
    // assigns `ranked`, and this is also the shape a thrown ranking leaves
    // behind (`rankingError` set, `ranked` never assigned).
    expect(dropInlineResultsWhenRanked(resp()).results).toEqual([row]);
  });

  it("keeps `results` when the ranking was withheld (`matches` emptied)", () => {
    const ranked = rankedWith([], {
      subjectResolvable: false,
      diagnostic: "subject carries no dated or placed fact",
    });
    expect(dropInlineResultsWhenRanked(resp(ranked)).results).toEqual([row]);
  });

  it("keeps `results` on a scoreable subject with a genuine no-match, though `matches` is POPULATED", () => {
    // The arm a length-only condition gets wrong. `subjectResolvable: false`
    // here means "every candidate scored at or below the degenerate floor" —
    // the rows exist but must not be triaged as a ranking. Dropping `results`
    // would leave the caller holding search order wearing match scores, which
    // is what the withheld branch exists to refuse.
    const ranked = rankedWith([{ matchRank: 1 }, { matchRank: 2 }], {
      subjectResolvable: false,
      diagnostic: "no candidate scored above the floor — a real negative",
    });
    const out = dropInlineResultsWhenRanked(resp(ranked));
    expect(out.results).toEqual([row]);
    expect(out.ranked).toBeTruthy();
  });

  it("is idempotent", () => {
    const r = resp(rankedWith([{ matchRank: 1 }]));
    expect(dropInlineResultsWhenRanked(dropInlineResultsWhenRanked(r)).results)
      .toBeUndefined();
    const keep = resp(rankedWith([], { subjectResolvable: false }));
    expect(dropInlineResultsWhenRanked(dropInlineResultsWhenRanked(keep)).results)
      .toEqual([row]);
  });
});

/**
 * #1212 ask 5: "keep the payload flat or better". Asserted with both numbers in
 * the test rather than described, because a byte claim with no bound and no
 * baseline is not falsifiable.
 *
 * The comparison is against the shape `origin/main` sends for the SAME search:
 * every row inline in `results`, PLUS a top-10 `ranked` block holding the first
 * ten of them again in a leaner stub. That duplication is what this change
 * removes, and it is why enriching the stub with four more fields still comes
 * out ahead.
 */
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
