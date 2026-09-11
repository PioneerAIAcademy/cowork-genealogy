/**
 * `record_search`'s own wiring of the inline-`results` drop.
 *
 * The condition itself is unit-tested on `dropInlineResultsWhenRanked`
 * (tests/utils/staged-compaction.test.ts) and end-to-end through the eval mock.
 * What neither covers is what THIS file covers: that `recordSearchTool` calls
 * it at all, calls it after the ranking try/catch, and forwards `top`.
 *
 * `rankSearchMatches` is mocked rather than driven, because the real scorer
 * reaches the network: in the sibling suite every candidate scores null, which
 * lands every subject-named search in the `subjectResolvable: false` branch and
 * makes the drop-when-usable path unreachable there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn().mockResolvedValue(null) };
});
vi.mock("../../src/tools/rank-search-matches.js", () => ({
  rankSearchMatches: vi.fn(),
}));

import { recordSearchTool } from "../../src/tools/record-search.js";
import { rankSearchMatches } from "../../src/tools/rank-search-matches.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockedRank = vi.mocked(rankSearchMatches);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let dir: string;

beforeEach(async () => {
  mockFetch.mockReset();
  mockedRank.mockReset();
  vi.mocked(getValidToken).mockReset();
  vi.mocked(getValidToken).mockResolvedValue("test-token");
  dir = await mkdtemp(join(tmpdir(), "rs-drop-"));
  await writeFile(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({
      persons: [
        {
          id: "I1",
          names: [{ preferred: true, given: "Abraham", surname: "Lincoln" }],
          facts: [{ type: "Birth", date: "1809", place: "Hardin, Kentucky, United States" }],
        },
      ],
    }),
    "utf-8",
  );
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      results: 2,
      index: 0,
      entries: [1, 2].map((n) => ({
        id: `1:1:AAAA-AA${n}`,
        title: "Entry",
        content: {
          gedcomx: {
            persons: [
              {
                id: `p${n}`,
                principal: true,
                names: [{ nameForms: [{ fullText: "Abraham Lincoln" }] }],
              },
            ],
          },
        },
      })),
    }),
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A usable ranking: rows present, subject scoreable. */
const usableRanking = (n = 2) => ({
  subjectId: "I1",
  scoredCount: n,
  returnedCount: n,
  matches: Array.from({ length: n }, (_, i) => ({
    matchRank: i + 1,
    searchRank: i + 1,
    recordId: `ark:/61903/1:1:AAAA-AA${i + 1}`,
    matchScore: 0.9,
  })),
  scoringErrors: 0,
  scoreLogError: null,
});

const search = (extra: Record<string, unknown> = {}) =>
  recordSearchTool({ surname: "Lincoln", projectPath: dir, subjectId: "I1", ...extra });

describe("record_search: dropping the inline results block", () => {
  it("drops `results` when the ranking is usable", async () => {
    mockedRank.mockResolvedValue(usableRanking() as never);

    const out = await search();

    expect(out.ranked).toBeTruthy();
    expect(out.results).toBeUndefined();
    // The rows are not lost — the sidecar still holds them at full fidelity.
    expect(out.staged).toBeTruthy();
  });

  it("keeps `results` when the ranking says not to triage on it", async () => {
    mockedRank.mockResolvedValue({
      ...usableRanking(),
      subjectResolvable: false,
      diagnostic: "no candidate scored above the floor",
    } as never);

    const out = await search();

    expect(out.ranked!.matches).toHaveLength(2);
    expect(out.results).toHaveLength(2);
  });

  it("keeps `results` when ranking throws", async () => {
    // What protects `results` here is that a throw leaves `out.ranked` unset,
    // so the drop finds nothing to replace the rows with. Deliberately NOT
    // asserted as "the drop runs after the catch": both placements pass this,
    // because the drop no-ops either way — a mutation moving it inside the try
    // does not fail, so claiming it would be a check that cannot fail.
    mockedRank.mockRejectedValue(new Error("matcher throttled"));

    const out = await search();

    expect(out.rankingError).toBe("matcher throttled");
    expect(out.ranked).toBeUndefined();
    expect(out.results).toHaveLength(2);
  });

  it("forwards `top` to the ranker, and omits it when the caller does", async () => {
    mockedRank.mockResolvedValue(usableRanking() as never);

    await search({ top: 3 });
    expect(mockedRank.mock.calls[0][0]).toMatchObject({ top: 3 });

    mockedRank.mockClear();
    await search();
    // Omitted, not defaulted — a default here would reinstate the host-side cap
    // one layer up from the tool that just stopped applying it.
    expect(mockedRank.mock.calls[0][0]).not.toHaveProperty("top");
  });
});
