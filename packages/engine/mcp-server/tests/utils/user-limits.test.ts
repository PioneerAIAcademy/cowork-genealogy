import { describe, it, expect, vi, afterEach } from "vitest";
import { LOCAL, bearerPrincipal, connectorPrincipal } from "../../src/auth/principal.js";
import { isFsBudgetExhausted } from "../../src/utils/fs-budget.js";
import { scorePair } from "../../src/utils/match-engine.js";
import { withRetry } from "../../src/utils/place-resolver.js";
import {
  DEFAULT_FS_PAUSE_MS,
  FS_PAUSE_MAX_MS,
  USER_CALL_CAP,
  __resetUserLimitsForTests,
  __userLimitsStateForTests,
  awaitFsPause,
  connectorUserId,
  recordFsPause,
  runWithUserCallSlot,
} from "../../src/utils/user-limits.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

// Per-user limits for connector callers (self-hosted beta E4, per-user half;
// issue #3999). The door and the authenticated fetch that use them are tested
// in tests/http/http-server.test.ts and tests/utils/fs-fetch.test.ts.

afterEach(() => {
  __resetUserLimitsForTests();
  vi.unstubAllGlobals();
});

/** A call body that runs until its `finish()` is called. */
function heldCall() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  let started = false;
  return {
    fn: async () => {
      started = true;
      await done;
    },
    finish: () => finish(),
    started: () => started,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("connectorUserId", () => {
  it("is the user id for a connector caller only", () => {
    expect(connectorUserId(connectorPrincipal({ accessToken: "t", userId: "u_1" }))).toBe("u_1");
    // A worker bearer is never keyed, even one that somehow carries a user id.
    expect(
      connectorUserId({ kind: "bearer", accessToken: "t", config: {}, surface: "worker", userId: "u_1" }),
    ).toBeUndefined();
    expect(connectorUserId(bearerPrincipal("t"))).toBeUndefined();
    expect(connectorUserId(LOCAL)).toBeUndefined();
  });
});

describe("runWithUserCallSlot: at most USER_CALL_CAP calls per user", () => {
  it("runs 4 at once and queues the rest, then runs every one", async () => {
    expect(USER_CALL_CAP).toBe(4);
    const signal = new AbortController().signal;
    const held = Array.from({ length: 6 }, () => heldCall());
    const runs = held.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    await tick();
    expect(held.map((h) => h.started())).toEqual([true, true, true, true, false, false]);
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 2 });

    for (const h of held) h.finish();
    expect(await Promise.all(runs)).toEqual([true, true, true, true, true, true]);
    expect(held.every((h) => h.started())).toBe(true);
    expect(__userLimitsStateForTests()).toMatchObject({ users: 0 });
  });

  it("hands a freed slot to the OLDEST waiter (FIFO)", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 4 }, () => heldCall());
    const holding = holders.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    const order: string[] = [];
    const waiters = ["first", "second", "third"].map((name) => {
      const h = heldCall();
      const run = runWithUserCallSlot("u_1", signal, async () => {
        order.push(name);
        await h.fn();
      });
      return { h, run };
    });
    await tick();
    expect(order).toEqual([]);

    holders[3]!.finish();
    await holding[3];
    await tick();
    expect(order).toEqual(["first"]);
    holders[0]!.finish();
    await tick();
    expect(order).toEqual(["first", "second"]);

    for (const h of holders) h.finish();
    for (const w of waiters) w.h.finish();
    await Promise.all([...holding, ...waiters.map((w) => w.run)]);
    expect(order).toEqual(["first", "second", "third"]);
    expect(__userLimitsStateForTests().users).toBe(0);
  });

  it("releases the slot when the call throws, and the next waiter runs", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 3 }, () => heldCall());
    const holding = holders.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    let fail!: (err: Error) => void;
    const failing = runWithUserCallSlot(
      "u_1",
      signal,
      () => new Promise<void>((_resolve, reject) => (fail = reject)),
    );
    const next = heldCall();
    const waiting = runWithUserCallSlot("u_1", signal, next.fn);
    await tick();
    expect(next.started()).toBe(false);

    fail(new Error("the tool threw"));
    await expect(failing).rejects.toThrow("the tool threw");
    await tick();
    expect(next.started()).toBe(true);
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 0 });

    for (const h of [...holders, next]) h.finish();
    await Promise.all([...holding, waiting]);
    expect(__userLimitsStateForTests().users).toBe(0);
  });

  it("a waiter whose signal aborts leaves the queue and never runs", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 4 }, () => heldCall());
    const holding = holders.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    const client = new AbortController();
    const gone = heldCall();
    const run = runWithUserCallSlot("u_1", client.signal, gone.fn);
    await tick();
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 1 });

    client.abort();
    expect(await run).toBe(false);
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 0 });

    for (const h of holders) h.finish();
    await Promise.all(holding);
    expect(gone.started()).toBe(false);
    expect(__userLimitsStateForTests().users).toBe(0);
  });

  it("tells the call whether it had to wait for its slot", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 4 }, () => heldCall());
    const told: boolean[] = [];
    const holding = holders.map((h) =>
      runWithUserCallSlot("u_1", signal, async (waited) => {
        told.push(waited);
        await h.fn();
      }),
    );
    const late = runWithUserCallSlot("u_1", signal, async (waited) => {
      told.push(waited);
    });
    await tick();
    expect(told).toEqual([false, false, false, false]);
    for (const h of holders) h.finish();
    await Promise.all([...holding, late]);
    expect(told).toEqual([false, false, false, false, true]);
  });

  it("a signal already aborted, with every slot taken, returns at once and is never queued", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 4 }, () => heldCall());
    const holding = holders.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    await tick();
    const client = new AbortController();
    client.abort();
    const gone = heldCall();
    // Settles before any holder finishes: it was never put in the queue.
    expect(await runWithUserCallSlot("u_1", client.signal, gone.fn)).toBe(false);
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 0 });
    for (const h of holders) h.finish();
    await Promise.all(holding);
    expect(gone.started()).toBe(false);
  });

  it("a signal already aborted runs nothing and leaves no entry behind", async () => {
    const client = new AbortController();
    client.abort();
    const h = heldCall();
    expect(await runWithUserCallSlot("u_1", client.signal, h.fn)).toBe(false);
    expect(h.started()).toBe(false);
    expect(__userLimitsStateForTests().users).toBe(0);
  });

  it("a hang-up in the same turn the slot is granted still never runs, and passes the slot on", async () => {
    const signal = new AbortController().signal;
    const holders = Array.from({ length: 4 }, () => heldCall());
    const holding = holders.map((h) => runWithUserCallSlot("u_1", signal, h.fn));
    // The slot is handed over synchronously on release, and the waiter's
    // continuation runs a microtask later, so a hang-up can land in between. A
    // signal that turns aborted as the grant removes its listener stands in for
    // that turn deterministically.
    let granted = false;
    const abortedAtGrant = {
      get aborted() {
        return granted;
      },
      addEventListener: () => undefined,
      removeEventListener: () => {
        granted = true;
      },
    } as unknown as AbortSignal;
    const gone = heldCall();
    const run = runWithUserCallSlot("u_1", abortedAtGrant, gone.fn);
    const after = heldCall();
    const afterRun = runWithUserCallSlot("u_1", signal, after.fn);
    await tick();
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 2 });

    holders[0]!.finish();
    await holding[0];
    expect(await run).toBe(false);
    await tick();
    expect(gone.started()).toBe(false);
    expect(after.started()).toBe(true);
    expect(__userLimitsStateForTests("u_1")).toMatchObject({ running: 4, waiting: 0 });

    for (const h of [...holders, after]) h.finish();
    await Promise.all([...holding, afterRun]);
    expect(__userLimitsStateForTests().users).toBe(0);
  });

  it("one user at the cap never delays another", async () => {
    const signal = new AbortController().signal;
    const held = Array.from({ length: 6 }, () => heldCall());
    const runs = held.map((h) => runWithUserCallSlot("u_busy", signal, h.fn));
    const other = heldCall();
    const otherRun = runWithUserCallSlot("u_other", signal, other.fn);
    await tick();
    expect(other.started()).toBe(true);
    expect(__userLimitsStateForTests("u_busy")).toMatchObject({ running: 4, waiting: 2 });
    for (const h of [...held, other]) h.finish();
    await Promise.all([...runs, otherRun]);
    expect(__userLimitsStateForTests().users).toBe(0);
  });
});

describe("the 429 pause", () => {
  it("a 429 with no usable Retry-After pauses for 30 s", async () => {
    expect(DEFAULT_FS_PAUSE_MS).toBe(30_000);
    recordFsPause("u_1", null, 1_000);
    const err = await awaitFsPause("u_1", 10_000, () => 1_000).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "FamilySearch asked this account to wait; try again in about 30 seconds.",
    );
    // Marked like the process-wide budget's refusal, so both retry loops rethrow it.
    expect(isFsBudgetExhausted(err)).toBe(true);
  });

  it("names one second in the singular, and never 0 seconds", async () => {
    recordFsPause("u_1", 400, 0);
    const err = await awaitFsPause("u_1", 100, () => 0).catch((e: unknown) => e);
    expect((err as Error).message).toBe("FamilySearch asked this account to wait; try again in about 1 second.");
  });

  it("a shorter pause never cuts a longer one short", async () => {
    recordFsPause("u_1", 60_000, 0);
    recordFsPause("u_1", 5_000, 0);
    await expect(awaitFsPause("u_1", 10_000, () => 0)).rejects.toThrow("about 60 seconds");
  });

  it("a pause is capped at 15 minutes, whatever Retry-After asked for", async () => {
    expect(FS_PAUSE_MAX_MS).toBe(15 * 60_000);
    // "99999999999" parses to this; a 400-digit header parses to Infinity.
    for (const asked of [99_999_999_999_000, Number.POSITIVE_INFINITY]) {
      __resetUserLimitsForTests();
      recordFsPause("u_1", asked, 0);
      await expect(awaitFsPause("u_1", 10_000, () => 0)).rejects.toThrow("about 900 seconds");
      // And it ends: at the cap the call goes again.
      await awaitFsPause("u_1", 10_000, () => FS_PAUSE_MAX_MS);
      expect(__userLimitsStateForTests().pausedUsers).toBe(0);
    }
  });

  it("a Retry-After that is not a number falls back to 30 s instead of a pause that never ends", async () => {
    recordFsPause("u_1", Number.NaN, 0);
    await expect(awaitFsPause("u_1", 10_000, () => 0)).rejects.toThrow("about 30 seconds");
    await awaitFsPause("u_1", 10_000, () => 30_000);
  });

  it("a negative Retry-After pauses nobody", () => {
    recordFsPause("u_1", -5_000, 0);
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
  });

  it("Retry-After: 0 pauses nobody", async () => {
    recordFsPause("u_1", 0, 0);
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
  });

  it("an expired pause lets the call go at once and is forgotten", async () => {
    recordFsPause("u_1", 100, 0);
    const sleep = vi.fn(async () => undefined);
    await awaitFsPause("u_1", 10_000, () => 200, sleep);
    expect(sleep).not.toHaveBeenCalled();
    expect(__userLimitsStateForTests().pausedUsers).toBe(0);
  });

  it("recording a pause sweeps other users' expired ones", () => {
    recordFsPause("u_old", 100, 0);
    recordFsPause("u_new", 1_000, 500);
    expect(__userLimitsStateForTests().pausedUsers).toBe(1);
  });

  it("a pause that ends within the budget is waited out, then the call goes", async () => {
    let now = 0;
    const slept: number[] = [];
    recordFsPause("u_1", 4_000, 0);
    await awaitFsPause("u_1", 10_000, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });
    expect(slept).toEqual([4_000]);
  });

  it("a pause that ends exactly at the deadline is waited out", async () => {
    let now = 0;
    const slept: number[] = [];
    recordFsPause("u_1", 10_000, 0);
    await awaitFsPause("u_1", 10_000, () => now, async (ms) => {
      slept.push(ms);
      now += ms;
    });
    expect(slept).toEqual([10_000]);
  });

  it("a pause another call extends past the deadline during the wait refuses, not a second full wait", async () => {
    let now = 0;
    const slept: number[] = [];
    recordFsPause("u_1", 6_000, 0);
    const err = await awaitFsPause("u_1", 10_000, () => now, async (ms) => {
      slept.push(ms);
      // Another call's 429 lands mid-wait: the pause now ends at 12 s, past
      // the 10 s deadline, though only 6 s past the end of this sleep.
      recordFsPause("u_1", 12_000, 0);
      now += ms;
    }).catch((e: unknown) => e);
    expect(slept).toEqual([6_000]);
    expect((err as Error).message).toBe("FamilySearch asked this account to wait; try again in about 6 seconds.");
    expect(isFsBudgetExhausted(err)).toBe(true);
  });

  it("only the paused user waits", async () => {
    recordFsPause("u_1", 60_000);
    const sleep = vi.fn(async () => undefined);
    await awaitFsPause("u_2", 10_000, undefined, sleep);
    expect(sleep).not.toHaveBeenCalled();
    await expect(awaitFsPause("u_1", 10_000)).rejects.toThrow("about 60 seconds");
  });

  // matcher.ts wraps scorePair in withRetry, and scorePair calls
  // fsFetchWithTimeout. A paused user's call must reach neither FamilySearch
  // nor a second attempt.
  it("withRetry around scorePair refuses a paused connector user once, with no fetch", async () => {
    const wire = vi.fn();
    vi.stubGlobal("fetch", wire);
    const principal = connectorPrincipal({ accessToken: "fs-token", userId: "u_1" });
    const tree: SimplifiedGedcomX = { persons: [{ id: "S", names: [{ given: "Ann", surname: "Lee" }] }] };
    const rec: SimplifiedGedcomX = { persons: [{ id: "r1", names: [{ given: "Ann", surname: "Lee" }] }] };
    recordFsPause("u_1", 60_000);

    let tries = 0;
    const err = await withRetry(() => {
      tries++;
      return scorePair(tree, "S", rec, "r1", principal);
    }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/^FamilySearch asked this account to wait; try again in about 60 seconds\.$/);
    expect(tries).toBe(1);
    expect(wire).not.toHaveBeenCalled();
  });
});
