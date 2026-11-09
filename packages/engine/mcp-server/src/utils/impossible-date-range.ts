// Date reading for the impossibility checks added by issue #4287.
//
// These checks fire only when the dates cannot be right on ANY reading of
// them, so they read each date more generously than `getDayRange` does:
//
//   - `Bef X` has no earliest day and `Aft X` no latest day.
//   - Before 1752 a date from 1 January to 24 March can belong to the
//     following year as we count it, because the English year began on 25
//     March. Only the LATEST bound moves: an Old Style date is never earlier
//     than the same day read New Style.
//   - A Will does not show a death, though the death-like family holds it.
//   - With no Birth fact, a christening stands in for the birth, which is
//     taken to be 0 to 2 years before it (lead's ruling, 2026-11-05). A
//     caller that used it says so, through `estimated`.
//
// Deliberately NOT folded into `getDayRange` / `date-helpers.ts`: every one of
// the 83 tags that predate #4287 reads dates through that function, and
// changing it would change all of them silently.

import type { SimplifiedFact, SimplifiedPerson } from "../types/gedcomx.js";
import { getDayRange, earliestIsUnbounded, latestIsUnbounded } from "./date-helpers.js";
import { getStandardDate } from "./fact-helpers.js";
import { DEATHLIKE_FACT_TYPES } from "./mob.js";

export interface GenerousRange {
  min: number;
  max: number;
}

/** Day number of 24 March within a 365-day year, as `getDayRange` counts. */
const LAST_OLD_STYLE_DAY_OF_YEAR = 31 + 28 + 24;
const FIRST_NEW_STYLE_YEAR = 1752;
const DAYS_PER_YEAR = 365;
const SPLIT_YEAR = /\d+\/\d{1,2}\b/;

/** The christening-like facts that stand in for a missing Birth. */
export const CHRISTENING_LIKE_TYPES: ReadonlySet<string> = new Set([
  "Christening",
  "Baptism",
  "BaptismRegistration",
]);

/** The death-like family, less `Will`: a will is written by the living. */
export const DEATH_SHOWING_TYPES: ReadonlySet<string> = new Set(
  [...DEATHLIKE_FACT_TYPES].filter((t) => t !== "Will"),
);

function yearOfDay(day: number): number {
  return Math.floor((day - 1) / DAYS_PER_YEAR);
}

/**
 * The latest day in `range` that falls on 1 Jan–24 Mar of a year before 1752,
 * or null when the range holds no such day.
 */
function lastOldStyleDay(range: GenerousRange): number | null {
  if (!Number.isFinite(range.max)) return null;
  const maxYear = yearOfDay(range.max);
  const year = Math.min(maxYear, FIRST_NEW_STYLE_YEAR - 1);
  let candidate = year * DAYS_PER_YEAR + LAST_OLD_STYLE_DAY_OF_YEAR;
  if (candidate > range.max) {
    // Only possible when `year === maxYear` and the range ends before 24 Mar.
    candidate = range.max;
  }
  return candidate >= range.min ? candidate : null;
}

/** A standardized date's day range, read as generously as the date allows. */
export function generousRange(std: string): GenerousRange | null {
  const base = getDayRange(std, 0);
  if (base === null) return null;
  const range: GenerousRange = { min: base.min, max: base.max };
  if (earliestIsUnbounded(std)) range.min = -Infinity;
  if (latestIsUnbounded(std)) range.max = Infinity;
  // A split year (`Feb 1700/01`) is already read as the later year.
  if (!SPLIT_YEAR.test(std)) {
    const oldStyle = lastOldStyleDay(range);
    if (oldStyle !== null) {
      range.max = Math.max(range.max, oldStyle + DAYS_PER_YEAR);
    }
  }
  return range;
}

/** The generous range of one fact, or null when it carries no readable date. */
export function factRange(fact: SimplifiedFact): GenerousRange | null {
  const std = getStandardDate(fact);
  return std === null ? null : generousRange(std);
}

function rangesOf(
  facts: readonly SimplifiedFact[],
  types: ReadonlySet<string>,
): Array<{ fact: SimplifiedFact; range: GenerousRange }> {
  const out: Array<{ fact: SimplifiedFact; range: GenerousRange }> = [];
  for (const f of facts) {
    if (f.type === undefined || !types.has(f.type)) continue;
    const range = factRange(f);
    if (range !== null) out.push({ fact: f, range });
  }
  return out;
}

function union(ranges: readonly GenerousRange[]): GenerousRange {
  return {
    min: Math.min(...ranges.map((r) => r.min)),
    max: Math.max(...ranges.map((r) => r.max)),
  };
}

export interface BirthReading {
  range: GenerousRange;
  /** True when the birth was estimated from a christening. */
  estimated: boolean;
  /** The facts the reading rests on, for `PersonWarning.facts`. */
  facts: SimplifiedFact[];
}

const BIRTH_ONLY: ReadonlySet<string> = new Set(["Birth"]);
const PROXY_LEAD_DAYS = 2 * DAYS_PER_YEAR;

/**
 * When the person could have been born: the union of their dated Birth facts,
 * or — with none — their christening-like facts moved up to 2 years earlier.
 * A Birth with no readable date counts as no Birth.
 */
export function birthReading(person: SimplifiedPerson): BirthReading | null {
  const facts = person.facts ?? [];
  const births = rangesOf(facts, BIRTH_ONLY);
  if (births.length > 0) {
    return {
      range: union(births.map((b) => b.range)),
      estimated: false,
      facts: births.map((b) => b.fact),
    };
  }
  const christenings = rangesOf(facts, CHRISTENING_LIKE_TYPES);
  if (christenings.length === 0) return null;
  const u = union(christenings.map((c) => c.range));
  return {
    range: { min: u.min - PROXY_LEAD_DAYS, max: u.max },
    estimated: true,
    facts: christenings.map((c) => c.fact),
  };
}

export interface DeathReading {
  /** The latest day the death can have happened. */
  upper: number;
  facts: SimplifiedFact[];
}

/**
 * The latest the person can have died: the earliest upper bound over the
 * death-showing facts, since the death falls on or before every one of them.
 */
export function deathReading(person: SimplifiedPerson): DeathReading | null {
  const deaths = rangesOf(person.facts ?? [], DEATH_SHOWING_TYPES);
  if (deaths.length === 0) return null;
  let upper = Infinity;
  for (const d of deaths) upper = Math.min(upper, d.range.max);
  return { upper, facts: deaths.map((d) => d.fact) };
}

/** Day ranges of the given fact types in `facts`, skipping undated ones. */
export function datedFacts(
  facts: readonly SimplifiedFact[],
  types: ReadonlySet<string> | null,
): Array<{ fact: SimplifiedFact; range: GenerousRange }> {
  const out: Array<{ fact: SimplifiedFact; range: GenerousRange }> = [];
  for (const f of facts) {
    if (types !== null && (f.type === undefined || !types.has(f.type))) continue;
    const range = factRange(f);
    if (range !== null) out.push({ fact: f, range });
  }
  return out;
}

export const DAYS_IN_YEARS = (years: number): number => years * DAYS_PER_YEAR;
