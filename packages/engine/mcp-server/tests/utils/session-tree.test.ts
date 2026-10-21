import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { SESSION_TREE_URL, withSessionTree } from "../../src/utils/session-tree.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { LOCAL, bearerPrincipal } from "../../src/auth/principal.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** A fake session whose current tree the GET reads and the POST sets. */
function fakeSession(initial: string, opts: { failSetTo?: string } = {}) {
  const state = { tree: initial, log: [] as string[] };
  mockFetch.mockImplementation(async (url: string, init: { method?: string; body?: string } = {}) => {
    if (url !== SESSION_TREE_URL) throw new Error(`unexpected ${url}`);
    if ((init.method ?? "GET") === "GET") {
      state.log.push(`get:${state.tree}`);
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ treeId: state.tree }) };
    }
    const to = JSON.parse(init.body!).treeId as string;
    state.log.push(`set:${to}`);
    if (to === opts.failSetTo) return { ok: false, status: 400, statusText: "Bad Request", json: async () => ({}) };
    state.tree = to;
    return { ok: true, status: 204, statusText: "No Content", json: async () => ({}) };
  });
  return state;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withSessionTree", () => {
  it("switches to the tree for the call and restores the original", async () => {
    const s = fakeSession("PRIVATE");
    const seen = await withSessionTree(LOCAL, "9NMM-TEST", async () => s.tree);
    expect(seen).toBe("9NMM-TEST");
    expect(s.tree).toBe("PRIVATE");
    expect(s.log).toEqual(["get:PRIVATE", "set:9NMM-TEST", "set:PRIVATE"]);
  });

  it("restores the original when the call throws, and rethrows", async () => {
    const s = fakeSession("PRIVATE");
    await expect(withSessionTree(LOCAL, "9NMM-TEST", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(s.tree).toBe("PRIVATE");
  });

  it("does not switch when the session is already on the tree", async () => {
    const s = fakeSession("9NMM-TEST");
    await withSessionTree(LOCAL, "9NMM-TEST", async () => null);
    expect(s.log).toEqual(["get:9NMM-TEST"]);
  });

  it("surfaces a failed restore rather than leaving the session switched silently", async () => {
    fakeSession("PRIVATE", { failSetTo: "PRIVATE" });
    await expect(withSessionTree(LOCAL, "9NMM-TEST", async () => "ok")).rejects.toThrow(/PRIVATE: 400/);
    fakeSession("PRIVATE", { failSetTo: "PRIVATE" });
    await expect(withSessionTree(LOCAL, "9NMM-TEST", async () => { throw new Error("boom"); })).rejects.toThrow(/boom Restoring the session's current tree also failed/);
  });

  it("runs one caller at a time per principal, so two trees never interleave", async () => {
    const s = fakeSession("PRIVATE");
    const seen: string[] = [];
    const slow = (label: string) => async () => {
      seen.push(`${label} start on ${s.tree}`);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(`${label} end on ${s.tree}`);
    };
    await Promise.all([withSessionTree(LOCAL, "TREE-AAA", slow("a")), withSessionTree(LOCAL, "TREE-BBB", slow("b"))]);
    expect(seen).toEqual(["a start on TREE-AAA", "a end on TREE-AAA", "b start on TREE-BBB", "b end on TREE-BBB"]);
    expect(s.tree).toBe("PRIVATE");
  });

  it("does not hold one principal's caller behind another's", async () => {
    fakeSession("PRIVATE");
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const a = withSessionTree(bearerPrincipal("token-a"), "TREE-AAA", async () => { order.push("a start"); await held; order.push("a end"); });
    await new Promise((r) => setTimeout(r, 5));
    await withSessionTree(bearerPrincipal("token-b"), "TREE-AAA", async () => { order.push("b ran"); });
    release();
    await a;
    expect(order).toEqual(["a start", "b ran", "a end"]);
  });

  it("a caller after a failed one still runs", async () => {
    fakeSession("PRIVATE");
    const first = withSessionTree(LOCAL, "TREE-AAA", async () => { throw new Error("first"); });
    const second = withSessionTree(LOCAL, "TREE-AAA", async () => "second");
    await expect(first).rejects.toThrow("first");
    await expect(second).resolves.toBe("second");
  });
});
