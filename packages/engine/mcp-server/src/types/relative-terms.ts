// `relativeTerms` — per-result visibility for relative-anchored searches.
//
// FamilySearch treats a relative-name term (`q.fatherGivenName`, …) as
// "must not contradict", not "must carry": a record that names no father at all
// survives a father-anchored search, because absence in an index is not
// disconfirming. That is correct, but it leaves the caller unable to tell a hit
// that CONFIRMS the father from one that is merely CONSISTENT with him — and a
// write-up then says "confirming her father William" about a record that never
// mentions him. Issue #1324; spec: `docs/specs/record-search-tool-spec-v2.md`.
//
// This module is a third home rather than either tool's own types file:
// `types/record-search.ts` already imports from `types/rank-search-matches.ts`,
// which imports nothing. Declaring these in either and importing from the other
// would make the two mutually importing. It would compile — type-only imports
// are erased — which is exactly why it is worth avoiding.

/** The five relative-name groups `record_search` accepts (`KIN_GROUPS`). */
export type KinPrefix = "spouse" | "father" | "mother" | "parent" | "other";

/**
 * A relative term the caller actually supplied, with the names they gave.
 *
 * `other` needs the names, not just the prefix: it has no relationship role to
 * resolve against, so the only way to answer it is to compare co-person names
 * to the query. The four role-based prefixes ignore the names entirely.
 */
export interface KinTerm {
  prefix: KinPrefix;
  given?: string;
  surname?: string;
}

/**
 * Whether the relative the caller anchored on is actually on the record.
 *
 * - `present` — the record names a relative in this role; `name` carries theirs.
 *   For the four role-based prefixes this is NOT a match verdict: the tool does
 *   not re-run FamilySearch's fuzzy matcher and must not claim to have. `Wm.`
 *   against a query of `William` is reported as-is so the caller can judge it.
 * - `absent` — the record names no such relative. The case #1324 is about.
 * - `unknown` — could not be determined. Never guessed, because a wrongly
 *   denied relative reads as *disconfirming*, which is worse than silence.
 */
export type RelativeTermStatus = "present" | "absent" | "unknown";

export interface RelativeTermFinding {
  status: RelativeTermStatus;
  /**
   * The relative's name, when one could be built. Only ever set on `present`,
   * and omitted rather than blank when the record names the person but carries
   * no usable name parts — presence is established by the relationship, not by
   * the name.
   */
  name?: string;
}

/**
 * Emitted only for prefixes the caller actually supplied a *name* for, and
 * omitted entirely when none were. The `*Exact` booleans do not count:
 * `fatherGivenNameExact` with no `fatherGivenName` sends no father constraint,
 * so there is nothing to report on.
 */
export type RelativeTerms = Partial<Record<KinPrefix, RelativeTermFinding>>;
