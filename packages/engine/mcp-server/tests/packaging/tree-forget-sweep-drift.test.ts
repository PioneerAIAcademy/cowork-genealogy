import { describe, it, expect } from "vitest";
import { SWEPT_SPOUSE_FACT_TYPES } from "../../src/tools/tree-forget.js";
import { EVENT_TREE_TYPES, COUPLE_EVENT_TYPES } from "../../src/tools/materialize-facts.js";

/**
 * issue #1549: every couple-event type in COUPLE_EVENT_TYPES must appear in
 * EVENT_TREE_TYPES (catches un-spreading the derivation), and `tree-forget.ts`'s
 * SWEPT_SPOUSE_FACT_TYPES must cover every couple-event type (per the
 * 2026-08-24 ruling: sweep all couple events).
 *
 * This does NOT catch a new couple-event type added to EVENT_TREE_TYPES but
 * not added to COUPLE_EVENT_TYPES — that gap is unguarded.
 */
describe("tree_forget sweep drift guard (#1549)", () => {
  it("COUPLE_EVENT_TYPES stays a subset of EVENT_TREE_TYPES (catches un-spreading the derivation)", () => {
    const missing = [...COUPLE_EVENT_TYPES].filter((t) => !EVENT_TREE_TYPES.has(t));
    expect(
      missing,
      `listed as a couple-event type but absent from EVENT_TREE_TYPES: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every couple-event type is swept by spouses-of", () => {
    const sweptSet = new Set(SWEPT_SPOUSE_FACT_TYPES);
    const unswept = [...COUPLE_EVENT_TYPES].filter((t) => !sweptSet.has(t));
    expect(
      unswept,
      `couple-event type(s) not in SWEPT_SPOUSE_FACT_TYPES: ${unswept.join(", ")}. ` +
        `Per the 2026-08-24 ruling, all couple events are swept.`,
    ).toEqual([]);
  });
});
