import { describe, it, expect, vi, beforeEach } from "vitest";
import { LOCAL } from "../../src/auth/principal.js";

const mockFulltext = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/fulltext-searchable.js", () => ({
  fetchFulltextSearchable: mockFulltext,
}));

import {
  FULLTEXT_BATCH,
  ROLLUP_MAX_PAGES,
  ROLLUP_PAGE_SIZE,
  fetchAllGroups,
  groupsForVolume,
  rollup,
  volumeRollup,
} from "../../src/utils/volume-rollup.js";
import type {
  MetadataRmsGroup,
  MetadataRmsSearchRequest,
  MetadataRmsSearchResponse,
} from "../../src/types/volume-search.js";

// Concept ids from RECORD_TYPE_GROUP_TABLE.
const RELIGIOUS = 123402;
const BAPTISM = 103612;
const BAPTISM_STRAY = 127575;
const CENSUS = 123363;

function vol(name: string, chains: number[][], indexed = 0): MetadataRmsGroup {
  return {
    id: `DGS-${name}`,
    groupName: name,
    indexedChildCount: indexed,
    coverages: chains.map((h) => ({ recordTypeConceptId: h[h.length - 1], recordTypeConceptIdHierarchy: h })),
  };
}

const BASE: MetadataRmsSearchRequest = {
  coverage: { placeRepIds: [1] },
  types: ["NATURAL"],
  returnChildCounts: true,
  active: true,
  pageSize: 100,
  nextPageToken: "stale",
};

beforeEach(() => {
  mockFulltext.mockReset();
});

describe("groupsForVolume", () => {
  it("puts a volume in its group and every ancestor group, as the filter would", () => {
    expect(groupsForVolume(vol("a", [[RELIGIOUS, BAPTISM, 999]]))).toEqual(new Set(["Religious", "Baptism"]));
  });

  it("reaches a group through a stray outside the anchor's subtree", () => {
    expect(groupsForVolume(vol("a", [[5, BAPTISM_STRAY]]))).toEqual(new Set(["Religious", "Baptism"]));
  });

  it("uses the bare concept id when the hierarchy is absent, and nothing when both are", () => {
    expect(groupsForVolume({ id: "x", groupName: "x", coverages: [{ recordTypeConceptId: CENSUS }] }))
      .toEqual(new Set(["Census"]));
    expect(groupsForVolume({ id: "y", groupName: "y", coverages: [{ place: "p" }] }).size).toBe(0);
  });
});

describe("rollup", () => {
  it("counts each volume once per group, untyped separately, and splits unindexed volumes into browse-only and full-text-only", () => {
    const groups = [
      vol("bap-browse", [[RELIGIOUS, BAPTISM]]),
      vol("bap-indexed", [[RELIGIOUS, BAPTISM]], 40),
      vol("census-fulltext", [[CENSUS]]),
      vol("mixed", [[CENSUS], [RELIGIOUS, BAPTISM], [CENSUS]]),
      vol("untyped", []),
    ];
    const r = rollup(groups, new Set(["census-fulltext"]), 5, true);
    expect(r.totalVolumes).toBe(5);
    expect(r.complete).toBe(true);
    expect(r.byRecordType).toEqual([
      { group: "Religious", volumes: 3, browseOnly: 2, fulltextOnly: 0 },
      { group: "Baptism", volumes: 3, browseOnly: 2, fulltextOnly: 0 },
      { group: "Census", volumes: 2, browseOnly: 1, fulltextOnly: 1 },
    ]);
    expect(r.untyped).toEqual({ volumes: 1, browseOnly: 1, fulltextOnly: 0 });
  });

  it("reports browseOnly and fulltextOnly as null, not zero, when the full-text check failed", () => {
    const r = rollup([vol("a", [[CENSUS]]), vol("b", [])], null, 2, true);
    expect(r.byRecordType).toEqual([{ group: "Census", volumes: 1, browseOnly: null, fulltextOnly: null }]);
    expect(r.untyped).toEqual({ volumes: 1, browseOnly: null, fulltextOnly: null });
  });

  it("is incomplete when fewer volumes came back than upstream counted", () => {
    expect(rollup([vol("a", [])], new Set(), 3, true).complete).toBe(false);
  });
});

function pagedSearch(total: number, opts: { pageNumberWorks?: boolean } = {}) {
  const all = Array.from({ length: total }, (_, i) => vol(`g${i}`, [[CENSUS]]));
  const page = (n: number) => all.slice((n - 1) * ROLLUP_PAGE_SIZE, n * ROLLUP_PAGE_SIZE);
  const calls: MetadataRmsSearchRequest[] = [];
  const search = vi.fn(async (body: MetadataRmsSearchRequest): Promise<MetadataRmsSearchResponse> => {
    calls.push(body);
    let n = 1;
    if (body.nextPageToken) n = Number(body.nextPageToken.slice(1));
    else if (body.pageNumber != null) {
      if (opts.pageNumberWorks === false) return { groups: page(1), totalCount: total, nextPageToken: "p2" };
      n = body.pageNumber;
    }
    const next = n * ROLLUP_PAGE_SIZE < total ? `p${n + 1}` : undefined;
    return { groups: page(n), totalCount: total, nextPageToken: next };
  });
  return { search, calls };
}

describe("fetchAllGroups", () => {
  it("asks for 1,000 a page and never sends the caller's page token on the first call", async () => {
    const { search, calls } = pagedSearch(20);
    const out = await fetchAllGroups(BASE, LOCAL, search);
    expect(out).toMatchObject({ total: 20, complete: true });
    expect(out.groups).toHaveLength(20);
    expect(calls).toHaveLength(1);
    expect(calls[0].pageSize).toBe(ROLLUP_PAGE_SIZE);
    expect(calls[0].nextPageToken).toBeUndefined();
  });

  it("fetches the remaining pages by pageNumber", async () => {
    const { search, calls } = pagedSearch(2500);
    const out = await fetchAllGroups(BASE, LOCAL, search);
    expect(out.groups).toHaveLength(2500);
    expect(calls.map((c) => c.pageNumber).filter((n) => n != null).sort()).toEqual([2, 3]);
  });

  it("falls back to token paging when pageNumber returns the wrong pages", async () => {
    const { search, calls } = pagedSearch(2500, { pageNumberWorks: false });
    const out = await fetchAllGroups(BASE, LOCAL, search);
    expect(out.groups).toHaveLength(2500);
    expect(new Set(out.groups.map((g) => g.groupName)).size).toBe(2500);
    expect(calls.filter((c) => c.nextPageToken).map((c) => c.nextPageToken)).toEqual(["p2", "p3"]);
  });

  it("stops at the page cap and reports the result incomplete", async () => {
    const total = (ROLLUP_MAX_PAGES + 2) * ROLLUP_PAGE_SIZE;
    const { search } = pagedSearch(total);
    const out = await fetchAllGroups(BASE, LOCAL, search);
    expect(out.complete).toBe(false);
    expect(out.groups).toHaveLength(ROLLUP_MAX_PAGES * ROLLUP_PAGE_SIZE);
  });
});

describe("volumeRollup", () => {
  it("checks full text in batches of 100 and marks browseOnly unknown if one batch fails", async () => {
    const { search } = pagedSearch(250);
    mockFulltext.mockImplementation(async (names: string[]) =>
      names.includes("g200") ? null : new Set<string>(),
    );
    const r = await volumeRollup(BASE, LOCAL, search);
    expect(mockFulltext).toHaveBeenCalledTimes(3);
    expect(mockFulltext.mock.calls.every(([names]) => names.length <= FULLTEXT_BATCH)).toBe(true);
    expect(r.byRecordType).toEqual([{ group: "Census", volumes: 250, browseOnly: null, fulltextOnly: null }]);
  });

  it("checks full text only for volumes with no indexed images", async () => {
    const groups = [vol("indexed", [[CENSUS]], 10), vol("bare", [[CENSUS]])];
    const search = vi.fn(async () => ({ groups, totalCount: 2 }));
    mockFulltext.mockResolvedValue(new Set<string>());
    const r = await volumeRollup(BASE, LOCAL, search);
    expect(mockFulltext.mock.calls.map(([names]) => names)).toEqual([["bare"]]);
    expect(r.byRecordType).toEqual([{ group: "Census", volumes: 2, browseOnly: 1, fulltextOnly: 0 }]);
  });
});
