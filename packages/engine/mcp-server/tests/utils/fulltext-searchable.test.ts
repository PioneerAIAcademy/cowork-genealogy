import { describe, it, expect, vi, beforeEach } from "vitest";

// The HTTP call is the seam, so the SHIPPED `fetchFulltextSearchableBatched`
// runs end to end — batching included. It exists because an unbounded `?ids=`
// list is either truncated by the endpoint (ids past its cap come back absent,
// which a caller reading absence as "not searchable" turns into a false
// refusal) or rejected with a 414.
const mockFsFetch = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/fs-fetch.js", () => ({ fsFetch: mockFsFetch }));

const { fetchFulltextSearchableBatched, FULLTEXT_BATCH } = await import(
  "../../src/utils/fulltext-searchable.js"
);
const { LOCAL } = await import("../../src/auth/principal.js");

/** The ids this request carried. Plain string work on purpose — `new URL`
 *  throwing inside a mock implementation surfaces as a confusing "Invalid URL"
 *  from the function under test rather than as a test error. */
const idsOf = (url: string): string[] =>
  decodeURIComponent(url.split("ids=")[1] ?? "").split(",").filter(Boolean);

const ok = (ids: string[]) => ({ ok: true, json: async () => ({ ids }) });

describe("fetchFulltextSearchableBatched", () => {
  beforeEach(() => mockFsFetch.mockReset());

  it("chunks at FULLTEXT_BATCH rather than sending one unbounded query string", async () => {
    mockFsFetch.mockImplementation(async () => ok([]));
    const names = Array.from({ length: 250 }, (_, i) => `g${i}`);
    await fetchFulltextSearchableBatched(names, LOCAL);
    expect(mockFsFetch).toHaveBeenCalledTimes(3);
    const sent = mockFsFetch.mock.calls.map((c: unknown[]) => idsOf(String(c[1])));
    expect(sent.every((b) => b.length <= FULLTEXT_BATCH)).toBe(true);
    expect(sent.flat()).toEqual(names);
  });

  it("is UNKNOWN (null) if ANY batch fails — a partial view cannot deny", async () => {
    // Args read by index, not destructured: anything that throws inside this
    // implementation is swallowed by `fetchFulltextSearchable`'s own catch and
    // comes back as a confusing null rather than a test failure.
    mockFsFetch.mockImplementation(async (...args: unknown[]) =>
      idsOf(String(args[1])).includes("g200") ? { ok: false } : ok([]),
    );
    const r = await fetchFulltextSearchableBatched(
      Array.from({ length: 250 }, (_, i) => `g${i}`),
      LOCAL,
    );
    expect(r).toBeNull();
  });

  it("unions the batches when every one answers", async () => {
    mockFsFetch.mockImplementation(async (...args: unknown[]) =>
      ok(idsOf(String(args[1])).filter((n) => n.endsWith("0"))),
    );
    const r = await fetchFulltextSearchableBatched(
      Array.from({ length: 150 }, (_, i) => `g${i}`),
      LOCAL,
    );
    expect(r).not.toBeNull();
    expect(r!.has("g10")).toBe(true);
    expect(r!.has("g11")).toBe(false);
    expect(r!.has("g140")).toBe(true);
  });

  it("asks nothing and answers UNKNOWN for an empty list", async () => {
    expect(await fetchFulltextSearchableBatched([], LOCAL)).toBeNull();
    expect(mockFsFetch).not.toHaveBeenCalled();
  });

  it("sends one request when the list fits in a batch", async () => {
    mockFsFetch.mockImplementation(async () => ok(["a"]));
    const r = await fetchFulltextSearchableBatched(["a", "b"], LOCAL);
    expect(mockFsFetch).toHaveBeenCalledTimes(1);
    expect(r).toEqual(new Set(["a"]));
  });
});
