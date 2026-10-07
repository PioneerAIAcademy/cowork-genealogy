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
import { fetchRelativeSources } from "../../src/utils/relative-sources.js";

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
