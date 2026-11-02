import { describe, it, expect, afterEach } from "vitest";
import {
  configureFsBudget,
  consumeFsBudgetSlot,
  countsAgainstFsBudget,
  isFsBudgetExhausted,
  __resetFsBudgetForTests,
  FS_BUDGET_WINDOW_MS,
} from "../../src/utils/fs-budget.js";

// The process-wide FamilySearch budget (self-hosted beta E4). Off unless the
// hosted entrypoint configured it; `src/index.ts` never does.

const FS = "https://www.familysearch.org/service/tree/tree-data/persons/X";

afterEach(() => {
  __resetFsBudgetForTests();
});

describe("countsAgainstFsBudget", () => {
  it.each([
    "https://familysearch.org/x",
    "https://www.familysearch.org/x",
    "https://ident.familysearch.org/cis-web/oauth2/v3/token",
    "https://sg30p0.familysearch.org/x",
    "HTTPS://WWW.FAMILYSEARCH.ORG/x",
  ])("counts %s", (url) => {
    expect(countsAgainstFsBudget(url)).toBe(true);
  });

  it.each([
    "https://openrouter.ai/api/v1/chat/completions",
    "https://wiki.example.ts.net/search",
    "https://notfamilysearch.org/x",
    // The suffix check must be on a dot boundary, or this would count.
    "https://evilfamilysearch.org/x",
    "not a url",
  ])("does not count %s", (url) => {
    expect(countsAgainstFsBudget(url)).toBe(false);
  });
});

describe("consumeFsBudgetSlot", () => {
  it("does nothing at all when unconfigured", () => {
    for (let i = 0; i < 1000; i++) expect(() => consumeFsBudgetSlot(FS)).not.toThrow();
  });

  it("admits calls up to the limit and refuses the next", () => {
    configureFsBudget({ perMinute: 3 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    consumeFsBudgetSlot(FS, t + 1);
    consumeFsBudgetSlot(FS, t + 2);
    expect(() => consumeFsBudgetSlot(FS, t + 3)).toThrow(/budget is spent/);
  });

  it("never counts a non-FamilySearch host, even at a limit of 1", () => {
    configureFsBudget({ perMinute: 1 });
    const t = 1_000_000;
    for (let i = 0; i < 50; i++) {
      consumeFsBudgetSlot("https://openrouter.ai/api/v1/chat/completions", t + i);
    }
    // The one FamilySearch slot is still free.
    expect(() => consumeFsBudgetSlot(FS, t + 100)).not.toThrow();
  });

  it("slides: a call leaving the window frees its slot", () => {
    configureFsBudget({ perMinute: 2 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    consumeFsBudgetSlot(FS, t + 10);
    expect(() => consumeFsBudgetSlot(FS, t + 20)).toThrow();
    // Once the first call is older than the window, it stops counting.
    expect(() => consumeFsBudgetSlot(FS, t + FS_BUDGET_WINDOW_MS + 1)).not.toThrow();
  });

  it("marks the refusal so both retry loops can rethrow it", () => {
    configureFsBudget({ perMinute: 1 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    const err = (() => {
      try {
        consumeFsBudgetSlot(FS, t + 1);
      } catch (e) {
        return e;
      }
    })();
    expect(isFsBudgetExhausted(err)).toBe(true);
    // Not every Error is one -- the marker has to discriminate.
    expect(isFsBudgetExhausted(new Error("budget is spent"))).toBe(false);
    expect(isFsBudgetExhausted(undefined)).toBe(false);
    expect(isFsBudgetExhausted(null)).toBe(false);
  });

  // The card requires the refusal to NAME THE WAIT. That is why the window
  // holds timestamps rather than a count: N comes from when the oldest call
  // falls out of it.
  it("names how long to wait, derived from the oldest call in the window", () => {
    configureFsBudget({ perMinute: 1 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    // 20s into a 60s window: the slot frees in 40s.
    expect(() => consumeFsBudgetSlot(FS, t + 20_000)).toThrow(/try again in about 40 seconds/);
    // 59.5s in: rounds up to 1, never "about 0 seconds".
    expect(() => consumeFsBudgetSlot(FS, t + 59_500)).toThrow(/try again in about 1 seconds/);
  });

  it("counts every attempt, so a retried call spends the budget twice", () => {
    configureFsBudget({ perMinute: 2 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    consumeFsBudgetSlot(FS, t + 1);
    expect(() => consumeFsBudgetSlot(FS, t + 2)).toThrow();
  });

  it("configure resets the window, so a reconfigure is not a free pass", () => {
    configureFsBudget({ perMinute: 1 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    expect(() => consumeFsBudgetSlot(FS, t + 1)).toThrow();
    configureFsBudget({ perMinute: 1 });
    expect(() => consumeFsBudgetSlot(FS, t + 2)).not.toThrow();
  });

  it("turns off when reconfigured with undefined", () => {
    configureFsBudget({ perMinute: 1 });
    const t = 1_000_000;
    consumeFsBudgetSlot(FS, t);
    expect(() => consumeFsBudgetSlot(FS, t + 1)).toThrow();
    configureFsBudget({ perMinute: undefined });
    for (let i = 0; i < 100; i++) {
      expect(() => consumeFsBudgetSlot(FS, t + 2 + i)).not.toThrow();
    }
  });
});
