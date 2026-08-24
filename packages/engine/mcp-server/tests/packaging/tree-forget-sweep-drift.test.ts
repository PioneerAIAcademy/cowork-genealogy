import { describe, it, expect } from "vitest";
import { SWEPT_SPOUSE_FACT_TYPES, COUPLE_TYPES_CONFIRMED_NOT_ECHOED } from "../../src/tools/tree-forget.js";
import { EVENT_TREE_TYPES } from "../../src/tools/materialize-facts.js";

/**
 * issue #1549: every couple-event type `materialize-facts.ts` recognizes must
 * be accounted for by `tree-forget.ts`'s redundant-fact sweep — either
 * confirmed swept (SWEPT_SPOUSE_FACT_TYPES) or confirmed NOT to echo
 * person-level (COUPLE_TYPES_CONFIRMED_NOT_ECHOED) — so a future couple-event
 * type added to EVENT_TREE_TYPES can't be silently missed by both.
 *
 * EVENT_TREE_TYPES has no couple/individual distinction of its own (it also
 * holds Birth, Death, Residence, …), so the couple-relationship subset is
 * hand-classified here per #1549's own analysis. Extend COUPLE_EVENT_TYPES
 * alongside EVENT_TREE_TYPES when a new couple-event type is recognized.
 */
const COUPLE_EVENT_TYPES = ["Marriage", "Divorce", "Annulment", "Engagement", "MarriageBanns"];

describe("tree_forget sweep drift guard (#1549)", () => {
  it("COUPLE_EVENT_TYPES stays a subset of EVENT_TREE_TYPES (catches a typo or rename)", () => {
    const missing = COUPLE_EVENT_TYPES.filter((t) => !EVENT_TREE_TYPES.has(t));
    expect(
      missing,
      `listed here as a couple-event type but absent from EVENT_TREE_TYPES: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every couple-event type is either swept or confirmed not to echo person-level", () => {
    const accounted = new Set<string>([...SWEPT_SPOUSE_FACT_TYPES, ...COUPLE_TYPES_CONFIRMED_NOT_ECHOED]);
    const unaccounted = COUPLE_EVENT_TYPES.filter((t) => !accounted.has(t));
    expect(
      unaccounted,
      `couple-event type(s) with no sweep/no-echo evidence on record: ${unaccounted.join(", ")}. ` +
        `Measure whether FamilySearch echoes it person-level (issue #1549's method) before adding it ` +
        `to either SWEPT_SPOUSE_FACT_TYPES or COUPLE_TYPES_CONFIRMED_NOT_ECHOED.`,
    ).toEqual([]);
  });
});
