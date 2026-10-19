import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `fetchRelativeSources`' bounds, asserted at the module boundary.
 *
 * WHY A SEPARATE FILE. `person-read.test.ts` stubs the global `fetch`, which cannot see
 * what `fsFetch` was asked for — and the bound that matters here IS an argument to
 * `fsFetch`. Removing the per-read timeout left all 88 tests in that file green
 * (mutation-checked), which is exactly the gap this closes: the shared deadline decides
 * whether a read STARTS, and only the timeout bounds one already IN FLIGHT. Without it a
 * read beginning just under the deadline runs on `fsFetch`'s own 30s default plus its
 * retry budget and can push `person_read` past the 60s Cowork bridge abort — losing the
 * subject, not merely the enrichment.
 */
vi.mock("../../src/utils/fs-fetch.js", () => ({ fsFetch: vi.fn() }));

import { fsFetch } from "../../src/utils/fs-fetch.js";
import { LOCAL } from "../../src/auth/principal.js";
import { fetchRelativeSources, fetchSourceDescriptions } from "../../src/utils/relative-sources.js";

const mockFsFetch = vi.mocked(fsFetch);

/** The timeout argument `fsFetch` was given on call `n`. */
const timeoutOf = (n: number): unknown => mockFsFetch.mock.calls[n]?.[3];

function ok(descriptions: unknown[]): unknown {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ sourceDescriptions: descriptions }),
  };
}

beforeEach(() => {
  mockFsFetch.mockReset();
});

describe("fetchRelativeSources bounds every read it starts", () => {
  it("passes a per-read timeout, not fsFetch's default", async () => {
    mockFsFetch.mockResolvedValue(ok([{ id: "A-1" }]) as never);
    await fetchRelativeSources(["P1"], LOCAL, Date.now() + 40_000);
    expect(typeof timeoutOf(0)).toBe("number");
  });

  it("caps at RELATIVE_READ_TIMEOUT_MS when the deadline is further out", async () => {
    mockFsFetch.mockResolvedValue(ok([]) as never);
    await fetchRelativeSources(["P1"], LOCAL, Date.now() + 120_000);
    expect(timeoutOf(0)).toBeLessThanOrEqual(30_000);
  });

  it("uses the REMAINING budget when that is tighter than the cap", async () => {
    // The case the bound exists for: a read starting late must not outlive the budget.
    mockFsFetch.mockResolvedValue(ok([]) as never);
    await fetchRelativeSources(["P1"], LOCAL, Date.now() + 2_000);
    expect(timeoutOf(0)).toBeLessThanOrEqual(2_000);
    expect(timeoutOf(0)).toBeGreaterThan(0);
  });

  it("starts no read at all once the deadline has passed", async () => {
    await fetchRelativeSources(["P1", "P2"], LOCAL, Date.now() - 1);
    expect(mockFsFetch).not.toHaveBeenCalled();
  });
});

describe("fetchRelativeSources returns raw descriptions for the caller to shape", () => {
  it("does not strip or rename upstream fields", async () => {
    // The caller runs these through `shapeSources`. Shaping here instead is what emitted
    // `resource_type` into the tree and made `project_create` refuse the project, so the
    // raw passthrough is the contract, not an oversight.
    mockFsFetch.mockResolvedValue(
      ok([{ id: "A-1", resourceType: "http://gedcomx.org/Record", titles: [{ value: "T" }] }]) as never,
    );
    const out = await fetchRelativeSources(["P1"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions[0]).toMatchObject({ id: "A-1", resourceType: "http://gedcomx.org/Record" });
  });

  it("dedupes by id across relatives", async () => {
    mockFsFetch.mockResolvedValue(ok([{ id: "SHARED" }]) as never);
    const out = await fetchRelativeSources(["P1", "P2"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions.map((d) => d.id)).toEqual(["SHARED"]);
  });

  it("reports a failed relative in `skipped` and keeps the rest", async () => {
    mockFsFetch
      .mockRejectedValueOnce(new Error("unreachable"))
      .mockResolvedValueOnce(ok([{ id: "GOOD" }]) as never);
    const out = await fetchRelativeSources(["BAD", "OK"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions.map((d) => d.id)).toEqual(["GOOD"]);
    expect(out.skipped).toEqual(["BAD"]);
  });

  it("treats 204 as 'no sources', not as a failure", async () => {
    mockFsFetch.mockResolvedValue({ ok: true, status: 204 } as never);
    const out = await fetchRelativeSources(["P1"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions).toEqual([]);
    expect(out.skipped).toEqual([]);
  });
});

// `fetchSourceDescriptions` (issue #3229): the descriptions behind the refs on the EDGES, read
// by id. It shares `fetchOne` with the relatives' read, so its bounds are asserted here too,
// at the module boundary where `fsFetch`'s arguments are visible.
const DESCRIPTIONS = "https://api.familysearch.org/platform/sources/descriptions";

/** The URL `fsFetch` was given on call `n`. */
const urlOf = (n: number): unknown => mockFsFetch.mock.calls[n]?.[1];

describe("fetchSourceDescriptions reads each distinct id once, by id", () => {
  it("asks the descriptions endpoint, once per id however many times it is cited", async () => {
    mockFsFetch.mockImplementation(((_p: unknown, url: string) =>
      Promise.resolve(ok([{ id: url.slice(url.lastIndexOf("/") + 1) }]))) as never);
    const out = await fetchSourceDescriptions(["D-1", "D-2", "D-1"], LOCAL, Date.now() + 30_000);
    expect(mockFsFetch).toHaveBeenCalledTimes(2);
    expect([urlOf(0), urlOf(1)].sort()).toEqual([`${DESCRIPTIONS}/D-1`, `${DESCRIPTIONS}/D-2`]);
    expect(out.descriptions.map((d) => d.id).sort()).toEqual(["D-1", "D-2"]);
    expect(out.skipped).toEqual([]);
  });

  it("returns the raw description for the caller to shape", async () => {
    mockFsFetch.mockResolvedValue(
      ok([{ id: "D-1", resourceType: "DEFAULT", titles: [{ value: "T" }] }]) as never,
    );
    const out = await fetchSourceDescriptions(["D-1"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions[0]).toMatchObject({ id: "D-1", resourceType: "DEFAULT" });
  });

  it("skips an id whose read fails, and keeps the rest", async () => {
    mockFsFetch
      .mockRejectedValueOnce(new Error("unreachable"))
      .mockResolvedValueOnce({ ok: false, status: 404 } as never)
      .mockResolvedValueOnce(ok([{ id: "GOOD" }]) as never);
    const out = await fetchSourceDescriptions(["BAD", "GONE", "GOOD"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions.map((d) => d.id)).toEqual(["GOOD"]);
    expect(out.skipped).toEqual(["BAD", "GONE"]);
  });

  it("skips an id that answers with no description, unlike a person with no sources", async () => {
    // A relative with nothing attached is an answer. A description id came from a ref, so a
    // description exists for it, and an empty answer is a miss the response must count.
    mockFsFetch
      .mockResolvedValueOnce({ ok: true, status: 204 } as never)
      .mockResolvedValueOnce(ok([]) as never);
    const out = await fetchSourceDescriptions(["NONE-1", "NONE-2"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions).toEqual([]);
    expect(out.skipped).toEqual(["NONE-1", "NONE-2"]);
  });

  it("starts no read at all once the deadline has passed", async () => {
    const out = await fetchSourceDescriptions(["D-1", "D-2"], LOCAL, Date.now() - 1);
    expect(mockFsFetch).not.toHaveBeenCalled();
    expect(out.skipped).toEqual(["D-1", "D-2"]);
  });

  it("bounds each read by the cap, or by what is left of the deadline when that is tighter", async () => {
    mockFsFetch.mockResolvedValue(ok([{ id: "D-1" }]) as never);
    await fetchSourceDescriptions(["D-1"], LOCAL, Date.now() + 120_000);
    expect(timeoutOf(0)).toBeLessThanOrEqual(30_000);

    mockFsFetch.mockClear();
    await fetchSourceDescriptions(["D-1"], LOCAL, Date.now() + 2_000);
    expect(timeoutOf(0)).toBeLessThanOrEqual(2_000);
    expect(timeoutOf(0)).toBeGreaterThan(0);
  });
});
