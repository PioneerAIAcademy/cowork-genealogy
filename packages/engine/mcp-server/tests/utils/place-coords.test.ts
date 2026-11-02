import { afterEach, describe, expect, it } from "vitest";
import { lookupWithin } from "../../src/utils/place-coords.js";
import {
  configureFsBudget,
  consumeFsBudgetSlot,
  isFsBudgetExhausted,
  __resetFsBudgetForTests,
} from "../../src/utils/fs-budget.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lookupWithin onExpired", () => {
  it("is called once when a lookup is still open at the budget, and that name answers null", async () => {
    let calls = 0;
    const answers = await lookupWithin(["a"], () => new Promise<string | null>(() => {}), 20, () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    expect(answers.get("a")).toBeNull();
  });

  for (const budget of [0, 50]) {
    it(`is not called when every lookup answers within a ${budget} ms budget, whatever it answers`, async () => {
      let calls = 0;
      const resolvers: Record<string, () => Promise<string | null>> = {
        value: async () => "found",
        none: async () => null,
        throws: () => {
          throw new Error("sync");
        },
        rejects: () => Promise.reject(new Error("async")),
      };
      const answers = await lookupWithin(Object.keys(resolvers), (n) => resolvers[n](), budget, () => {
        calls += 1;
      });
      await wait(budget + 30);
      expect(calls).toBe(0);
      expect(answers.get("value")).toBe("found");
      expect(answers.get("none")).toBeNull();
    });
  }

  it("is not called for an empty list", async () => {
    let calls = 0;
    await lookupWithin([], async () => "x", 0, () => {
      calls += 1;
    });
    await wait(20);
    expect(calls).toBe(0);
  });
});

// Until the resolvers stopped swallowing the refusal, this rethrow could not
// fire: every production caller passes standardPlaceToCoords or
// resolveStandardPlace, and both answered null before the error got here.
describe("lookupWithin and a spent FamilySearch budget", () => {
  const FS_URL = "https://www.familysearch.org/service/places/search";

  afterEach(() => {
    __resetFsBudgetForTests();
  });

  it("propagates the refusal rather than mapping the name to null", async () => {
    configureFsBudget({ perMinute: 1 });
    consumeFsBudgetSlot(FS_URL);
    const err = await lookupWithin<string>(["Lexington"], () => {
      consumeFsBudgetSlot(FS_URL);
      throw new Error("unreachable");
    }, 1000).then(
      () => null,
      (e) => e,
    );
    expect(isFsBudgetExhausted(err)).toBe(true);
  });

  // A rejection that LOSES the race still needs a handler. Without one it
  // surfaces as an unhandled rejection after lookupWithin has already
  // returned, which crashes the process under Node's default policy.
  //
  // It cannot be turned back into a throw: once the deadline wins, the
  // function has returned. In practice that window is near-unreachable --
  // consumeFsBudgetSlot refuses BEFORE any network I/O, and the worker's
  // first line is `if (expired) return;`, so a worker that would refuse
  // after the deadline never starts. The recorded copy closes the
  // sub-millisecond gap between those two checks.
  it("handles a refusal that loses the race instead of leaving it unhandled", async () => {
    configureFsBudget({ perMinute: 1 });
    consumeFsBudgetSlot(FS_URL);
    let refusal: unknown;
    try {
      consumeFsBudgetSlot(FS_URL);
    } catch (e) {
      refusal = e;
    }
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      const answers = await lookupWithin<string>(
        ["Lexington"],
        () => new Promise((_res, rej) => setTimeout(() => rej(refusal), 40)),
        10,
      );
      expect(answers.get("Lexington")).toBeNull(); // the deadline's answer
      await new Promise((r) => setTimeout(r, 80)); // let the straggler reject
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("still maps an ordinary resolver failure to null", async () => {
    configureFsBudget({ perMinute: 100 });
    const answers = await lookupWithin<string>(["Lexington"], async () => {
      throw new Error("502 Bad Gateway");
    }, 1000);
    expect(answers.get("Lexington")).toBeNull();
  });
});
