// Cross-person date comparison helpers.
//
// Java parity ports of MobWarnings.hasOverlappingDates (line 1212),
// hasConflictingDates (line 1296), sameYear (line 1371), compatibleDate
// (line 1385), getPersonEventDayRanges (line 1538), getDateRange
// (line 1564). Used by the similar-children / similar-spouses /
// close-child-events / dissimilar-spouses warnings.
//
// The "day-range" model: every fact date contributes a [min, max] pair of
// Julian day numbers. Perfect (DMY) dates have min == max (one exact
// day). Imperfect dates (year-only or year+month) have a wider range,
// optionally further widened by `imperfectDateFudgeDays` to express
// "we're not sure exactly when within this period."
//
// The helpers below interleave the min and max as a flat list of
// integers, then run `getEarliest` (Math.min) and `getLatest` (Math.max)
// over it. This matches Java's `getEarliest(getPersonEventDayRanges(...))`
// pattern.

import type { SimplifiedFact, SimplifiedPerson } from "../types/gedcomx.js";
import { earliestYear, getDayRange } from "./date-helpers.js";
import { getStandardDate, isPerfectStandardDate } from "./fact-helpers.js";
import { BIRTHLIKE_FACT_TYPES, DEATHLIKE_FACT_TYPES } from "./mob.js";
import { normalizeString } from "./string-similarity.js";

/** Java fudge-days constant used by most overlapping/conflicting checks. */
const DEFAULT_IMPERFECT_FUDGE_DAYS = 365;

/**
 * Collect every standardized date string from the person's facts that
 * match the given selection.
 */
function getPersonEventStandardDates(
  person: SimplifiedPerson,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null,
): string[] {
  const out: string[] = [];
  for (const f of person.facts ?? []) {
    if (!matchesFactSelection(f, factTypes, antiFactTypes)) continue;
    const std = getStandardDate(f);
    if (std === null) continue;
    out.push(std);
  }
  return out;
}

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

/**
 * Java parity for `getPersonEventDayRanges(person, factTypes, antiFactTypes,
 * onlyPerfect, imperfectDateFudgeDays)`. Returns a flat list of day
 * numbers — for each fact's date, the min day and max day of its range
 * are both appended. The min and max are equal for perfect (DMY) dates.
 *
 * Use `getEarliest` / `getLatest` to extract bounds.
 */
export function getPersonEventDayRanges(
  person: SimplifiedPerson,
  factTypes: ReadonlySet<string> | null,
  antiFactTypes: ReadonlySet<string> | null,
  onlyPerfect: boolean,
  imperfectDateFudgeDays: number,
): number[] {
  const stdDates = getPersonEventStandardDates(person, factTypes, antiFactTypes);
  const out: number[] = [];
  for (const std of stdDates) {
    if (onlyPerfect && !isPerfectStandardDate(std)) continue;
    const range = getDayRange(std, imperfectDateFudgeDays);
    if (range === null) continue;
    out.push(range.min, range.max);
  }
  return out;
}

export function getEarliest(days: readonly number[]): number | null {
  if (days.length === 0) return null;
  return Math.min(...days);
}

export function getLatest(days: readonly number[]): number | null {
  if (days.length === 0) return null;
  return Math.max(...days);
}

/**
 * Java parity for `hasOverlappingDates(person1, person2)` (warning-java.txt:1212).
 *
 * Returns true if the two persons' lifespans suggest they ARE alive at
 * incompatible moments — used in the similar-children pipeline as a
 * filter: two children whose dates overlap can't actually be the same
 * individual, so the similar-name signal is suppressed.
 *
 * The Java implementation checks five conditions; any one triggers:
 *   1. Exact birth days are 1–6 months apart
 *   2. Exact death days are 1–6 months apart
 *   3. One person's lifespan brackets the other person's birth (with > 30 day gap)
 *   4. One person's lifespan brackets the other person's death (with > 30 day gap)
 *   5. Same as #4 but mirrored
 */
export function hasOverlappingDates(
  person1: SimplifiedPerson,
  person2: SimplifiedPerson,
): boolean {
  const fudge = DEFAULT_IMPERFECT_FUDGE_DAYS;

  const p1Birthlike = getPersonEventDayRanges(person1, BIRTHLIKE_FACT_TYPES, null, false, fudge);
  const p2Birthlike = getPersonEventDayRanges(person2, BIRTHLIKE_FACT_TYPES, null, false, fudge);
  const p1Deathlike = getPersonEventDayRanges(person1, DEATHLIKE_FACT_TYPES, null, false, fudge);
  const p2Deathlike = getPersonEventDayRanges(person2, DEATHLIKE_FACT_TYPES, null, false, fudge);

  const birthOnly: ReadonlySet<string> = new Set(["Birth"]);
  const deathOnly: ReadonlySet<string> = new Set(["Death"]);
  const p1Birth = getPersonEventDayRanges(person1, birthOnly, null, true, fudge);
  const p2Birth = getPersonEventDayRanges(person2, birthOnly, null, true, fudge);
  const p1Death = getPersonEventDayRanges(person1, deathOnly, null, true, fudge);
  const p2Death = getPersonEventDayRanges(person2, deathOnly, null, true, fudge);

  const p1LatestBirthlike = getLatest(p1Birthlike);
  const p2LatestBirthlike = getLatest(p2Birthlike);
  const p1EarliestBirthlike = getEarliest(p1Birthlike);
  const p2EarliestBirthlike = getEarliest(p2Birthlike);
  const p1EarliestBirth = getEarliest(p1Birth);
  const p2EarliestBirth = getEarliest(p2Birth);
  const p1EarliestDeathlike = getEarliest(p1Deathlike);
  const p2EarliestDeathlike = getEarliest(p2Deathlike);
  const p1EarliestDeath = getEarliest(p1Death);
  const p2EarliestDeath = getEarliest(p2Death);
  const p1LatestDeathlike = getLatest(p1Deathlike);
  const p2LatestDeathlike = getLatest(p2Deathlike);

  // (1) two people born 1–6 months apart → conflict
  if (p1EarliestBirth !== null && p2EarliestBirth !== null) {
    const diff = Math.abs(p1EarliestBirth - p2EarliestBirth);
    if (diff > 30 && diff < 30 * 6) return true;
  }

  // (2) two people die 1–6 months apart → conflict
  if (p1EarliestDeath !== null && p2EarliestDeath !== null) {
    const diff = Math.abs(p1EarliestDeath - p2EarliestDeath);
    if (diff > 30 && diff < 30 * 6) return true;
  }

  // (3) p1 alive when p2 born
  if (
    p1LatestBirthlike !== null && p1EarliestDeathlike !== null &&
    p2EarliestBirthlike !== null && p2LatestBirthlike !== null &&
    p2EarliestBirthlike - p1LatestBirthlike > 30 &&
    p1EarliestDeathlike - p2LatestBirthlike > 30
  ) {
    return true;
  }
  if (
    p2LatestBirthlike !== null && p2EarliestDeathlike !== null &&
    p1EarliestBirthlike !== null && p1LatestBirthlike !== null &&
    p1EarliestBirthlike - p2LatestBirthlike > 30 &&
    p2EarliestDeathlike - p1LatestBirthlike > 30
  ) {
    return true;
  }

  // (4) p1 alive when p2 died, or vice versa
  if (
    p1LatestBirthlike !== null && p1EarliestDeathlike !== null &&
    p2EarliestDeathlike !== null && p2LatestDeathlike !== null &&
    p2EarliestDeathlike - p1LatestBirthlike > 30 &&
    p1EarliestDeathlike - p2LatestDeathlike > 30
  ) {
    return true;
  }
  return (
    p2LatestBirthlike !== null && p2EarliestDeathlike !== null &&
    p1EarliestDeathlike !== null && p1LatestDeathlike !== null &&
    p1EarliestDeathlike - p2LatestBirthlike > 30 &&
    p2EarliestDeathlike - p1LatestDeathlike > 30
  );
}

/**
 * Java parity for `hasConflictingDates(person1, person2)` (warning-java.txt:1296).
 *
 * Returns true if the two persons' dates can't both belong to the same
 * individual — they could still be siblings, but they can't be merged.
 *
 * The Java implementation checks:
 *   - Birthlike windows don't overlap (with 30-day tolerance)
 *   - Deathlike windows don't overlap (30-day tolerance)
 *   - Exact birth/christening/death/burial dates differ by > 30 days
 */
export function hasConflictingDates(
  person1: SimplifiedPerson,
  person2: SimplifiedPerson,
): boolean {
  const fudge = DEFAULT_IMPERFECT_FUDGE_DAYS;

  const p1Birthlike = getPersonEventDayRanges(person1, BIRTHLIKE_FACT_TYPES, null, false, fudge);
  const p2Birthlike = getPersonEventDayRanges(person2, BIRTHLIKE_FACT_TYPES, null, false, fudge);
  const p1Deathlike = getPersonEventDayRanges(person1, DEATHLIKE_FACT_TYPES, null, false, fudge);
  const p2Deathlike = getPersonEventDayRanges(person2, DEATHLIKE_FACT_TYPES, null, false, fudge);

  const p1LatestBirthlike = getLatest(p1Birthlike);
  const p2LatestBirthlike = getLatest(p2Birthlike);
  const p1EarliestBirthlike = getEarliest(p1Birthlike);
  const p2EarliestBirthlike = getEarliest(p2Birthlike);
  const p1EarliestDeathlike = getEarliest(p1Deathlike);
  const p2EarliestDeathlike = getEarliest(p2Deathlike);
  const p1LatestDeathlike = getLatest(p1Deathlike);
  const p2LatestDeathlike = getLatest(p2Deathlike);

  // Birthlike windows don't overlap
  if (
    p1LatestBirthlike !== null && p2EarliestBirthlike !== null &&
    p2EarliestBirthlike - p1LatestBirthlike > 30
  ) {
    return true;
  }
  if (
    p2LatestBirthlike !== null && p1EarliestBirthlike !== null &&
    p1EarliestBirthlike - p2LatestBirthlike > 30
  ) {
    return true;
  }

  // Deathlike windows don't overlap
  if (
    p1LatestDeathlike !== null && p2EarliestDeathlike !== null &&
    p2EarliestDeathlike - p1LatestDeathlike > 30
  ) {
    return true;
  }
  if (
    p2LatestDeathlike !== null && p1EarliestDeathlike !== null &&
    p1EarliestDeathlike - p2LatestDeathlike > 30
  ) {
    return true;
  }

  // Exact-DMY pairwise differences
  const factPairs: Array<readonly [string]> = [
    ["Birth"],
    ["Christening"],
    ["Death"],
    ["Burial"],
  ];
  for (const [type] of factPairs) {
    const typeSet: ReadonlySet<string> = new Set([type]);
    const p1Days = getPersonEventDayRanges(person1, typeSet, null, true, fudge);
    const p2Days = getPersonEventDayRanges(person2, typeSet, null, true, fudge);
    const p1Day = getEarliest(p1Days);
    const p2Day = getEarliest(p2Days);
    if (p1Day !== null && p2Day !== null && Math.abs(p1Day - p2Day) > 30) {
      return true;
    }
  }

  return false;
}

/**
 * Java parity for `sameYear(date1, date2)` (warning-java.txt:1371).
 * Returns true iff the two standardized dates share at least one year
 * in their possible-year set.
 */
export function sameYear(std1: string | null, std2: string | null): boolean {
  if (std1 === null || std2 === null) return false;
  const y1 = earliestYear(std1);
  const y2 = earliestYear(std2);
  if (y1 === null || y2 === null) return false;
  return y1 === y2;
}

/**
 * Java parity for `compatibleDate(date1, date2)` (warning-java.txt:1385).
 * Returns true iff the two standardized dates' ranges overlap at all
 * (any uncertainty window in common). Used by the similar-children
 * pipeline to detect "births recorded close enough to be the same person."
 */
export function compatibleDate(
  std1: string | null,
  std2: string | null,
): boolean {
  if (std1 === null || std2 === null) return false;
  const r1 = getDayRange(std1, DEFAULT_IMPERFECT_FUDGE_DAYS);
  const r2 = getDayRange(std2, DEFAULT_IMPERFECT_FUDGE_DAYS);
  if (r1 === null || r2 === null) return false;
  // Ranges overlap iff max1 >= min2 AND max2 >= min1.
  return r1.max >= r2.min && r2.max >= r1.min;
}

/**
 * Java parity for `compatiblePlace(place1, place2)` (warning-java.txt:1409).
 *
 * Java compares hierarchical placeId lists. Our SimplifiedGedcomX carries
 * places as text strings (e.g. "County Cork, Ireland"), so we approximate
 * the same idea on textual hierarchy.
 *
 * Place strings in our format are written most-specific-first, comma-
 * delimited: "city, region, country". We reverse the parts (so the
 * comparison is country-first), then verify that every level both places
 * specify agrees. Two places are compatible iff:
 *   - Both are non-empty, AND
 *   - They agree on every hierarchy level they both name
 *
 * Examples (compatible):
 *   "Ireland"                    vs "County Cork, Ireland"  -> true
 *   "County Cork, Ireland"       vs "County Cork, Ireland"  -> true
 * Examples (incompatible):
 *   "Pennsylvania, USA"          vs "County Cork, Ireland"  -> false
 *   ""                           vs "Ireland"               -> false
 */
export function compatiblePlace(
  place1: string | undefined,
  place2: string | undefined,
): boolean {
  if (!place1 || !place2) return false;
  const parts1 = splitPlace(place1);
  const parts2 = splitPlace(place2);
  if (parts1.length === 0 || parts2.length === 0) return false;
  const minLen = Math.min(parts1.length, parts2.length);
  for (let i = 0; i < minLen; i++) {
    if (parts1[i] !== parts2[i]) return false;
  }
  return true;
}

function splitPlace(s: string): string[] {
  // Split on commas, normalize each part, then reverse so country comes
  // first (matches the "least-specific-first" direction for prefix
  // comparison).
  return s
    .split(",")
    .map((p) => normalizeString(p))
    .filter((p) => p.length > 0)
    .reverse();
}
