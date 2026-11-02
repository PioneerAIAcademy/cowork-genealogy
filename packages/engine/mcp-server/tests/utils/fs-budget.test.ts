import { describe, it, expect, afterEach } from "vitest";
import {
  configureFsBudget,
  consumeFsBudgetSlot,
  countsAgainstFsBudget,
  isFsBudgetExhausted,
  __resetFsBudgetForTests,
  FS_BUDGET_WINDOW_MS,
  FS_BUDGET_MAX_PER_MINUTE,
  monotonicNow,
} from "../../src/utils/fs-budget.js";
import { readLimitsEnv } from "../../src/store/limits-env.js";

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
    // ident.familysearch.org itself counts -- only the OAuth paths are exempt.
    "https://ident.familysearch.org/something-else",
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

  // The OAuth endpoints are a deliberate undercount, and this pins it so the
  // exemption cannot be deleted as an oversight. getValidToken turns ANY
  // refresh failure into "FamilySearch session has expired... Call the login
  // tool to re-authenticate" (auth/refresh.ts), so a budget-refused refresh
  // tells the user to re-authenticate over a transient rate limit -- and every
  // tool needing a token then fails the same way, so one spent budget reads as
  // a dead session instead of a wait. The cost is about one uncounted call per
  // token expiry per user, against a per-minute budget.
  it.each([
    "https://ident.familysearch.org/cis-web/oauth2/v3/token",
    "https://ident.familysearch.org/cis-web/oauth2/v3/authorization",
    "https://IDENT.FAMILYSEARCH.ORG/CIS-WEB/OAUTH2/v3/token",
  ])("exempts the OAuth endpoint %s, so a refresh is never refused", (url) => {
    expect(countsAgainstFsBudget(url)).toBe(false);
  });

  it("exempts only the OAuth prefix, not the whole ident host", () => {
    expect(countsAgainstFsBudget("https://ident.familysearch.org/cis-web/other")).toBe(true);
    expect(countsAgainstFsBudget("https://ident.familysearch.org/")).toBe(true);
  });
});

describe("consumeFsBudgetSlot", () => {
  it("defaults to a monotonic clock, which cannot step backwards", () => {
    // With Date.now(), a backwards NTP step or a host resume leaves every
    // stored timestamp ahead of the cutoff: nothing is pruned, and every
    // FamilySearch call in the process is refused for the size of the step.
    const a = monotonicNow();
    const b = monotonicNow();
    expect(b).toBeGreaterThanOrEqual(a);
  });

  // The window holds one timestamp per admitted call, so an absurd rate would
  // grow an array of that many numbers with shift() going O(n). The ceiling is
  // what bounds it -- but the constant lives here and the ENFORCEMENT lives in
  // readLimitsEnv, so this pins the two to each other. (The previous version
  // of this test configured the budget AT the ceiling and asserted nothing
  // threw, which passes however readLimitsEnv is written -- it could not fail
  // for the reason it named.)
  it("is the ceiling readLimitsEnv actually enforces", () => {
    expect(FS_BUDGET_MAX_PER_MINUTE).toBeGreaterThan(0);
    expect(
      readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: String(FS_BUDGET_MAX_PER_MINUTE) })
        .fsCallsPerMinute,
    ).toBe(FS_BUDGET_MAX_PER_MINUTE);
    expect(
      readLimitsEnv({ GENEALOGY_FS_CALLS_PER_MINUTE: String(FS_BUDGET_MAX_PER_MINUTE + 1) })
        .invalid,
    ).toEqual(["GENEALOGY_FS_CALLS_PER_MINUTE"]);
  });

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
    expect(() => consumeFsBudgetSlot(FS, t + 59_500)).toThrow(/try again in about 1 second\./);
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
