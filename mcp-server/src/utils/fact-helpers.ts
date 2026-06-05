// fact-helpers — TypeScript ports of the date/fact aggregation helpers
// that Java's MobWarnings relies on.
//
// Java's per-check methods (hasEventBeforeBirth, earliestChildBirthToBirth,
// hasEventAfterDeath, etc.) read like:
//
//     Integer diff = factDaysDiffEarliestLatest(mob, null, null,
//                       FsFactType.BIRTHLIKE_FACT_TYPES, null, false, 0);
//     return diff != null && diff > days;
//
// This module gives us the same building blocks so the TS warning checks
// can be written the same way — read like Java, compute like Java.
//
// Two flavors of aggregation appear throughout:
//   - Year-based helpers (earliestYearOfSelfFacts, etc.) for checks that
//     compare on years (W2, hasAgeRangeGreaterThan120, etc.).
//   - Day-based helpers (earliestDayOfSelfFacts, etc.) for checks that
//     compare on day-numbers (W1, W3, hasChristeningBeforeBirth, etc.).
//
// Each helper takes (factTypes, antiFactTypes) selectors that mirror
// Java's signatures:
//   - factTypes:    null = any type; Set = match only those types.
//   - antiFactTypes: null = no exclusion; Set = exclude those types.

import type {
  SimplifiedFact,
  SimplifiedPerson,
} from "../types/gedcomx.js";
import {
  earliestYear,
  getDayRange,
  latestYear,
} from "./date-helpers.js";
import { stdDate } from "./date-standardize.js";
import type { Mob } from "./mob.js";

// ─── Resolving a fact's canonical date ────────────────────────────────────

/**
 * Return the canonical (GEDCOM-form) date string for a fact, or null.
 *
 * Prefers fact.standard_date — the sidecar emitted by the simplified-GedcomX
 * converter for facts that came from FS. Falls back to stdDate(fact.date)
 * for LLM-authored stubs in tree.gedcomx.json that don't carry the sidecar.
 *
 * Returns null when the fact has no parseable date at all.
 */
export function getStandardDate(
  fact: SimplifiedFact | undefined,
): string | null {
  if (!fact) return null;
  if (fact.standard_date) return fact.standard_date;
  if (!fact.date) return null;
  const std = stdDate(fact.date);
  return std || null;
}

// ─── Internal: filter & range helpers ─────────────────────────────────────

/** True when the fact matches the (factTypes, antiFactTypes) selection. */
function matchesFactSelection(
  fact: SimplifiedFact,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null,
): boolean {
  if (fact.type === undefined) return false;
  if (factTypes !== null && !factTypes.has(fact.type)) return false;
  if (antiFactTypes !== null && antiFactTypes.has(fact.type)) return false;
  return true;
}

/** Collect [min, max] day-ranges of all matching facts (skips undated). */
function collectFactDayRanges(
  facts: readonly SimplifiedFact[],
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null,
  imperfectDateFudgeDays = 0,
): Array<{ min: number; max: number }> {
  const out: Array<{ min: number; max: number }> = [];
  for (const f of facts) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    const range = getDayRange(std, imperfectDateFudgeDays);
    if (range !== null) out.push(range);
  }
  return out;
}

// ─── Self-fact (anchor) aggregations ──────────────────────────────────────

/** Earliest possible day across all matching facts on the anchor, or null. */
export function earliestDayOfSelfFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
  imperfectDateFudgeDays = 0,
): number | null {
  const ranges = collectFactDayRanges(
    mob.getFacts(),
    factTypes,
    antiFactTypes,
    imperfectDateFudgeDays,
  );
  if (ranges.length === 0) return null;
  let earliest = ranges[0].min;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].min < earliest) earliest = ranges[i].min;
  }
  return earliest;
}

/** Latest possible day across all matching facts on the anchor, or null. */
export function latestDayOfSelfFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
  imperfectDateFudgeDays = 0,
): number | null {
  const ranges = collectFactDayRanges(
    mob.getFacts(),
    factTypes,
    antiFactTypes,
    imperfectDateFudgeDays,
  );
  if (ranges.length === 0) return null;
  let latest = ranges[0].max;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].max > latest) latest = ranges[i].max;
  }
  return latest;
}

/** Earliest possible year across all matching facts on the anchor, or null. */
export function earliestYearOfSelfFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let earliest: number | null = null;
  for (const f of mob.getFacts()) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    const y = earliestYear(std);
    if (y === null) continue;
    if (earliest === null || y < earliest) earliest = y;
  }
  return earliest;
}

/** Latest possible year across all matching facts on the anchor, or null. */
export function latestYearOfSelfFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let latest: number | null = null;
  for (const f of mob.getFacts()) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    const y = latestYear(std);
    if (y === null) continue;
    if (latest === null || y > latest) latest = y;
  }
  return latest;
}

// ─── Child-fact aggregations (Java's getChildEvent* helpers) ──────────────

/**
 * Earliest possible year across all matching facts on every CHILD of the
 * anchor. Equivalent to Java's
 *   getEarliest(getChildEventYears(mob, factTypes))
 */
export function earliestYearOfChildFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let earliest: number | null = null;
  for (const child of mob.getChildren()) {
    for (const f of child.facts ?? []) {
      if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
      const std = getStandardDate(f);
      if (std === null) continue;
      const y = earliestYear(std);
      if (y === null) continue;
      if (earliest === null || y < earliest) earliest = y;
    }
  }
  return earliest;
}

/**
 * Latest possible year across all matching facts on every CHILD of the
 * anchor. Equivalent to Java's
 *   getLatest(getChildEventYears(mob, factTypes))
 */
export function latestYearOfChildFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let latest: number | null = null;
  for (const child of mob.getChildren()) {
    for (const f of child.facts ?? []) {
      if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
      const std = getStandardDate(f);
      if (std === null) continue;
      const y = latestYear(std);
      if (y === null) continue;
      if (latest === null || y > latest) latest = y;
    }
  }
  return latest;
}

/**
 * Earliest possible year across all matching facts on a single SimplifiedPerson.
 * Used by checks that aggregate over a relative directly (e.g. hasYoungSpouse
 * scans each spouse's own birth-like and death-like facts to compute lifespan).
 */
export function earliestYearOfPersonFacts(
  person: SimplifiedPerson,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let earliest: number | null = null;
  for (const f of person.facts ?? []) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    const y = earliestYear(std);
    if (y === null) continue;
    if (earliest === null || y < earliest) earliest = y;
  }
  return earliest;
}

/** Latest possible year across all matching facts on a single SimplifiedPerson. */
export function latestYearOfPersonFacts(
  person: SimplifiedPerson,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let latest: number | null = null;
  for (const f of person.facts ?? []) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    const y = latestYear(std);
    if (y === null) continue;
    if (latest === null || y > latest) latest = y;
  }
  return latest;
}

/**
 * Earliest possible year across all matching facts on every PARENT of the
 * anchor. Equivalent to Java's
 *   getEarliest(getParentEventYears(mob, factTypes))
 */
export function earliestYearOfParentFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null = null,
): number | null {
  let earliest: number | null = null;
  for (const parent of mob.getParents()) {
    for (const f of parent.facts ?? []) {
      if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
      const std = getStandardDate(f);
      if (std === null) continue;
      const y = earliestYear(std);
      if (y === null) continue;
      if (earliest === null || y < earliest) earliest = y;
    }
  }
  return earliest;
}

// ─── Java's day-diff aggregators ──────────────────────────────────────────
// All four (Earliest-Latest, Latest-Earliest, Earliest-Earliest, Latest-
// Latest) are direct ports of warnings.java:975-997.
//
// Convention matches Java: the diff is always (side-2 quantity) − (side-1
// quantity). null when either side has no matching dated fact.

/** = latest(set 2) − earliest(set 1). Java warnings.java:975. Used by W1. */
export function factDaysDiffEarliestLatest(
  mob: Mob,
  factTypes1: ReadonlySet<string> | null,
  antiFactTypes1: ReadonlySet<string> | null,
  factTypes2: ReadonlySet<string> | null,
  antiFactTypes2: ReadonlySet<string> | null,
  imperfectDateFudgeDays = 0,
): number | null {
  const earliest1 = earliestDayOfSelfFacts(
    mob,
    factTypes1,
    antiFactTypes1,
    imperfectDateFudgeDays,
  );
  const latest2 = latestDayOfSelfFacts(
    mob,
    factTypes2,
    antiFactTypes2,
    imperfectDateFudgeDays,
  );
  if (earliest1 === null || latest2 === null) return null;
  return latest2 - earliest1;
}

/** = latest(set 2) − latest(set 1). Java warnings.java:993. Used by W3. */
export function factDaysDiffLatestLatest(
  mob: Mob,
  factTypes1: ReadonlySet<string> | null,
  antiFactTypes1: ReadonlySet<string> | null,
  factTypes2: ReadonlySet<string> | null,
  antiFactTypes2: ReadonlySet<string> | null,
  imperfectDateFudgeDays = 0,
): number | null {
  const latest1 = latestDayOfSelfFacts(
    mob,
    factTypes1,
    antiFactTypes1,
    imperfectDateFudgeDays,
  );
  const latest2 = latestDayOfSelfFacts(
    mob,
    factTypes2,
    antiFactTypes2,
    imperfectDateFudgeDays,
  );
  if (latest1 === null || latest2 === null) return null;
  return latest2 - latest1;
}

// ─── Java's year-diff aggregators ─────────────────────────────────────────
// Year-level analogs of the day-diff helpers above. Several Java checks
// (deathRangeGreaterThan, hasLateMarriage, etc.) use these.

/** = latest(set 2) − earliest(set 1) in years. Java warnings.java:850. */
export function factYearsDiffEarliestLatest(
  mob: Mob,
  factTypes1: ReadonlySet<string> | null,
  antiFactTypes1: ReadonlySet<string> | null,
  factTypes2: ReadonlySet<string> | null,
  antiFactTypes2: ReadonlySet<string> | null,
): number | null {
  const earliest1 = earliestYearOfSelfFacts(mob, factTypes1, antiFactTypes1);
  const latest2 = latestYearOfSelfFacts(mob, factTypes2, antiFactTypes2);
  if (earliest1 === null || latest2 === null) return null;
  return latest2 - earliest1;
}

/**
 * True when the standardized date string is a full day-month-year date
 * (e.g. "21 May 1955") rather than month-year ("May 1955") or year-only
 * ("1955"). Used by checks (tooManyBirthDates, hasBurialBeforeDeath, etc.)
 * that filter to "perfect" dates per Java MDate.isPerfect.
 */
export function isPerfectStandardDate(std: string): boolean {
  return /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+$/.test(
    std.trim(),
  );
}

/**
 * Day numbers for all matching facts on the anchor whose date is perfect
 * (full DMY). Java's MobWarnings.toJDays equivalent. Used by tooManyBirthDates
 * and hasBurialBeforeDeath.
 */
export function perfectDaysOfSelfFacts(
  mob: Mob,
  factTypes: ReadonlySet<string> | null,
): number[] {
  const out: number[] = [];
  for (const f of mob.getFacts()) {
    if (!matchesFactSelection(f, factTypes, null)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    if (!isPerfectStandardDate(std)) continue;
    const range = getDayRange(std);
    if (range === null) continue;
    // For perfect (DMY) dates, range.min === range.max.
    out.push(range.min);
  }
  return out;
}

/**
 * Java MobWarnings.factDaysCount (warnings.java:1913).
 *
 * Counts distinct perfect-DMY days for a single fact type, where two days
 * are considered the "same" if they're within `compareDays` of each other.
 *
 * Algorithm: collect all perfect day numbers; if 0 or 1, return that size;
 * otherwise, sort and return (1 + number of days more than `compareDays`
 * after the earliest).
 *
 * Used by tooManyBirthDates (Birth at 30 days) and tooManyDeathDates
 * (Death at 14 days).
 */
export function factDaysCount(
  mob: Mob,
  factType: string,
  compareDays: number,
): number {
  const days = perfectDaysOfSelfFacts(mob, new Set([factType]));
  if (days.length <= 1) return days.length;
  days.sort((a, b) => a - b);
  const earliest = days[0];
  return days.filter((d) => d - earliest > compareDays).length + 1;
}

/** = earliest(set 2) − earliest(set 1) in years. Java warnings.java:856. */
export function factYearsDiffEarliestEarliest(
  mob: Mob,
  factTypes1: ReadonlySet<string> | null,
  antiFactTypes1: ReadonlySet<string> | null,
  factTypes2: ReadonlySet<string> | null,
  antiFactTypes2: ReadonlySet<string> | null,
): number | null {
  const earliest1 = earliestYearOfSelfFacts(mob, factTypes1, antiFactTypes1);
  const earliest2 = earliestYearOfSelfFacts(mob, factTypes2, antiFactTypes2);
  if (earliest1 === null || earliest2 === null) return null;
  return earliest2 - earliest1;
}
