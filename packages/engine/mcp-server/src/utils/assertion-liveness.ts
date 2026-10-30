/**
 * Whether an assertion is still evidence (#3678).
 *
 * `extraction_append({ reextract: true })` retires a record's old assertions
 * rather than deleting them: each gets `superseded_by` naming the assertion that
 * replaced it, or the literal "retracted" when the re-extraction wrote no
 * counterpart (Richard, 2026-10-27). Any non-null `superseded_by` means retired.
 *
 * Every reader that derives a result from assertions calls this, rather than
 * testing `superseded_by` itself, so the one meaning lives in one place.
 */

/** `superseded_by` on an assertion the re-extraction wrote no counterpart for. */
export const RETRACTED = "retracted";

export function isLiveAssertion(a: unknown): boolean {
  return a != null && typeof a === "object" && (a as { superseded_by?: unknown }).superseded_by == null;
}

/** The live entries of a research document's `assertions`, or none. */
export function liveAssertions(research: any): any[] {
  return (Array.isArray(research?.assertions) ? research.assertions : []).filter(isLiveAssertion);
}
