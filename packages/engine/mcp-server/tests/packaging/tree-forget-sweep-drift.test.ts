import { describe, it, expect } from "vitest";
import { SWEPT_SPOUSE_FACT_TYPES, SWEPT_PARENT_FACT_TYPES } from "../../src/tools/tree-forget.js";
import { EVENT_TREE_TYPES, COUPLE_EVENT_TYPES } from "../../src/tools/materialize-facts.js";

/**
 * GedcomX couple-event types — the events, not the documentary-record types
 * (MarriageRegistration, MarriageLicense, MarriageNotice, etc.) that the
 * 2026-08-20 ruling excludes from sweeping. Owned locally so the guard
 * catches CommonLawMarriage / DomesticPartnership entering EVENT_TREE_TYPES.
 */
const GEDCOMX_COUPLE_EVENTS: ReadonlySet<string> = new Set([
  "Marriage", "Divorce", "Annulment",
  "Engagement", "MarriageBanns", "Separation",
  "CommonLawMarriage", "DomesticPartnership",
  "DivorceFiling",
]);

/**
 * issue #1549: every couple-event type in COUPLE_EVENT_TYPES must appear in
 * EVENT_TREE_TYPES (catches un-spreading the derivation), and `tree-forget.ts`'s
 * SWEPT_SPOUSE_FACT_TYPES must cover every couple-event type (per the
 * 2026-08-24 ruling: sweep all couple events).
 *
 * Any type from GEDCOMX_COUPLE_EVENTS that enters EVENT_TREE_TYPES must also
 * enter COUPLE_EVENT_TYPES, otherwise the sweep silently misses it.
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

  it("every GedcomX couple-event type in EVENT_TREE_TYPES is in COUPLE_EVENT_TYPES", () => {
    const inTreeButNotCouple = [...EVENT_TREE_TYPES]
      .filter((t) => GEDCOMX_COUPLE_EVENTS.has(t))
      .filter((t) => !COUPLE_EVENT_TYPES.has(t));
    expect(
      inTreeButNotCouple,
      `GedcomX couple-event type(s) in EVENT_TREE_TYPES but not in ` +
        `COUPLE_EVENT_TYPES: ${inTreeButNotCouple.join(", ")}. ` +
        `Decide whether spouses-of should sweep this type (add to COUPLE_EVENT_TYPES) ` +
        `or confirm it is a documentary-record type that must not be swept.`,
    ).toEqual([]);
  });

  it("SWEPT_PARENT_FACT_TYPES is exported and importable", () => {
    expect(SWEPT_PARENT_FACT_TYPES).toContain("Parents");
  });
});
