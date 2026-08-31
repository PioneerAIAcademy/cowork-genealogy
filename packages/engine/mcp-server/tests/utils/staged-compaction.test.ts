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
    const row = out.results[0];

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
    expect(out.results[0].textDocument).toBeUndefined();
    // The triage stubs survive — this is what search-full-text reads.
    expect(out.results[0].title).toBe("Deed Book A");
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
