import { describe, expect, it } from "vitest";
import { lookupWithin } from "../../src/utils/place-coords.js";

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
