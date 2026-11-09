import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import {
  SESSION_TREE_URL,
  restoreSwitchedSessionTrees,
  setSessionTree,
  withSessionTree,
} from "../../src/utils/session-tree.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { LOCAL, bearerPrincipal, connectorPrincipal } from "../../src/auth/principal.js";
import {
  __resetUserLimitsForTests,
  __userLimitsStateForTests,
  recordFsPause,
} from "../../src/utils/user-limits.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** A fake session whose current tree the GET reads and the POST sets. */
function fakeSession(
  initial: string,
  opts: { failSetTo?: string; tooManyOnSetTo?: string; onGet?: () => void } = {},
) {
  const state = { tree: initial, log: [] as string[] };
  mockFetch.mockImplementation(async (url: string, init: { method?: string; body?: string } = {}) => {
    if (url !== SESSION_TREE_URL) throw new Error(`unexpected ${url}`);
    if ((init.method ?? "GET") === "GET") {
      state.log.push(`get:${state.tree}`);
      opts.onGet?.();
      return { ok: true, status: 200, statusText: "OK", json: async () => ({ treeId: state.tree }) };
    }
    const to = JSON.parse(init.body!).treeId as string;
    state.log.push(`set:${to}`);
    if (to === opts.failSetTo) return { ok: false, status: 400, statusText: "Bad Request", json: async () => ({}) };
    if (to === opts.tooManyOnSetTo) {
      return {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "60" }),
        json: async () => ({}),
        text: async () => "",
      };
    }
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

describe("restoreSwitchedSessionTrees", () => {
  it("restores a switch still in flight", async () => {
    const s = fakeSession("PRIVATE");
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((r) => { entered = r; });
    const call = withSessionTree(LOCAL, "TREE-AAA", () => new Promise<void>((r) => { release = r; entered(); }));
    await inside;
    expect(s.tree).toBe("TREE-AAA");
    await restoreSwitchedSessionTrees();
    expect(s.tree).toBe("PRIVATE");
    release();
    await call;
  });

  it("does nothing once the call has restored", async () => {
    const s = fakeSession("PRIVATE");
    await withSessionTree(LOCAL, "TREE-AAA", async () => null);
    s.log.length = 0;
    await restoreSwitchedSessionTrees();
    expect(s.log).toEqual([]);
  });
});

// The per-user 429 pause (self-hosted beta E4, issue #3999) gates a connector
// user's FamilySearch calls. The switch back is the one call it must never hold
// or refuse: the restore record is already dropped by then, nothing tries it
// again, and the session, which the user's open browser tabs share, would stay
// on the researcher's tree.
describe("the per-user 429 pause never holds or refuses the switch back (#3999)", () => {
  const user = connectorPrincipal({ accessToken: "fs-A", userId: "u_A" });

  afterEach(() => {
    __resetUserLimitsForTests();
  });

  it("a user paused during the call still gets the session switched back", async () => {
    const s = fakeSession("PRIVATE");
    const seen = await withSessionTree(user, "TREE-AAA", async () => {
      // A 429 inside the call paused this user for a minute.
      recordFsPause("u_A", 60_000);
      return s.tree;
    });
    expect(seen).toBe("TREE-AAA");
    expect(s.tree).toBe("PRIVATE");
    expect(s.log).toEqual(["get:PRIVATE", "set:TREE-AAA", "set:PRIVATE"]);
  });

  it("on the error path too, and the call's own error is the one thrown", async () => {
    const s = fakeSession("PRIVATE");
    const err = await withSessionTree(user, "TREE-AAA", async () => {
      recordFsPause("u_A", 60_000);
      throw new Error("boom");
    }).catch((e: unknown) => e as Error);
    expect(err.message).toBe("boom");
    expect(s.tree).toBe("PRIVATE");
  });

  it("a pause short enough to wait out does not hold the switch back", async () => {
    const s = fakeSession("PRIVATE");
    const started = performance.now();
    await withSessionTree(user, "TREE-AAA", async () => {
      recordFsPause("u_A", 3_000);
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(s.tree).toBe("PRIVATE");
  });

  it("restoreSwitchedSessionTrees reaches FamilySearch for a paused user", async () => {
    const s = fakeSession("PRIVATE");
    let release!: () => void;
    let entered!: () => void;
    const inside = new Promise<void>((r) => {
      entered = r;
    });
    const call = withSessionTree(user, "TREE-AAA", () => new Promise<void>((r) => { release = r; entered(); }));
    let restored: string;
    try {
      await inside;
      recordFsPause("u_A", 60_000);
      await restoreSwitchedSessionTrees();
      restored = s.tree;
    } finally {
      // Always let the held call finish, so its lock cannot hold later cases.
      release();
      await call.catch(() => undefined);
    }
    expect(restored).toBe("PRIVATE");
    expect(s.tree).toBe("PRIVATE");
  });

  it("the pause still refuses the switch itself, before anything is read or switched", async () => {
    const s = fakeSession("PRIVATE");
    recordFsPause("u_A", 60_000);
    await expect(withSessionTree(user, "TREE-AAA", async () => "ran")).rejects.toThrow(
      "FamilySearch asked this account to wait",
    );
    expect(s.log).toEqual([]);
    expect(s.tree).toBe("PRIVATE");
  });

  it("a pause that starts between the read and the switch refuses the switch: nothing is switched", async () => {
    const s = fakeSession("PRIVATE", { onGet: () => recordFsPause("u_A", 60_000) });
    await expect(withSessionTree(user, "TREE-AAA", async () => "ran")).rejects.toThrow(
      "FamilySearch asked this account to wait",
    );
    expect(s.log).toEqual(["get:PRIVATE"]);
    expect(s.tree).toBe("PRIVATE");
  });

  it("only the switch back skips the pause: a plain switch is refused before it reaches FamilySearch", async () => {
    const s = fakeSession("PRIVATE");
    recordFsPause("u_A", 60_000);
    await expect(setSessionTree(user, "TREE-AAA")).rejects.toThrow("FamilySearch asked this account to wait");
    expect(s.log).toEqual([]);
    await setSessionTree(user, "TREE-AAA", { restoring: true });
    expect(s.log).toEqual(["set:TREE-AAA"]);
  });

  it("a 429 on the switch back still pauses the user", async () => {
    fakeSession("PRIVATE", { tooManyOnSetTo: "PRIVATE" });
    await expect(withSessionTree(user, "TREE-AAA", async () => "ok")).rejects.toThrow(/Server requested a 60s wait/);
    expect(__userLimitsStateForTests().pausedUsers).toBe(1);
  });
});
