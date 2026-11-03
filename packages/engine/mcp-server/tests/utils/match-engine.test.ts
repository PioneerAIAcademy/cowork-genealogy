import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { scorePair } from "../../src/utils/match-engine.js";
import {
  configureFsBudget,
  isFsBudgetExhausted,
  __resetFsBudgetForTests,
} from "../../src/utils/fs-budget.js";
import { bearerPrincipal } from "../../src/auth/principal.js";
import type { SimplifiedGedcomX } from "../../src/types/gedcomx.js";

// scorePair is the ONLY route from same_person / rank_search_matches to
// FamilySearch's matchTwoExamples, and matcher.ts wraps it in place-resolver's
// `withRetry` when `retry: true`. Its catch wraps every throw in a plain Error
// -- which would destroy the budget marker before withRetry could test it, so
// one local refusal would become three attempts with two backoff sleeps,
// reported to the LLM as "could not reach FamilySearch".
//
// This file exists because matcher.test.ts and rank-search-matches.test.ts
// both `vi.mock` this module out entirely, so neither can reach the catch.

const PERSON: SimplifiedGedcomX = {
  persons: [{ id: "P1", names: [{ full_text: "Ann Lee" }] }],
} as unknown as SimplifiedGedcomX;

// A bearer, not LOCAL: getValidToken returns its token directly, so the call
// reaches fetchWithTimeout. LOCAL would throw "call the login tool" first and
// never spend a budget slot.
const P = bearerPrincipal("tok");

beforeEach(() => {
  mockFetch.mockReset();
  __resetFsBudgetForTests();
});

afterEach(() => {
  __resetFsBudgetForTests();
});

describe("scorePair and the FamilySearch budget", () => {
  it("rethrows a budget refusal UNCHANGED, so the marker survives", async () => {
    // matchTwoExamples is on www.familysearch.org, so it is budgeted.
    configureFsBudget({ perMinute: 1 });
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ matches: [] }),
      text: async () => "{}",
      headers: new Headers(),
    });

    // Spend the single slot on the first pair.
    await scorePair(PERSON, "P1", PERSON, "P2", P).catch(() => undefined);

    const err = await scorePair(PERSON, "P1", PERSON, "P2", P).catch((e) => e);

    expect(isFsBudgetExhausted(err)).toBe(true);
    expect(String(err)).toMatch(/budget is spent/);
    // The wrapping message must NOT have replaced it.
    expect(String(err)).not.toMatch(/Could not reach FamilySearch matchTwoExamples/);
  });

  it("still wraps an ordinary transport failure in its own message", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const err = await scorePair(PERSON, "P1", PERSON, "P2", P).catch((e) => e);

    expect(isFsBudgetExhausted(err)).toBe(false);
    expect(String(err)).toMatch(/Could not reach FamilySearch matchTwoExamples API/);
  });

  it("does not refuse when the budget is off", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ matches: [] }),
      text: async () => "{}",
      headers: new Headers(),
    });

    for (let i = 0; i < 10; i++) {
      const err = await scorePair(PERSON, "P1", PERSON, "P2", P).catch((e) => e);
      expect(isFsBudgetExhausted(err)).toBe(false);
    }
  });
});
