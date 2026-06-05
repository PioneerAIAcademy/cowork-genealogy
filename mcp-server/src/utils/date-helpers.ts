/**
 * Helper functions for analyzing standardized genealogical dates.
 * These functions parse only the output of stdDate(), not raw date strings.
 */

import { MONTH_NUM, DAYS_IN_MONTH as RAW_DAYS_IN_MONTH } from "./date-constants.js";

// Adjusted for a true 365-day year (Feb = 28, not 29)
const DAYS_IN_MONTH = [...RAW_DAYS_IN_MONTH];
DAYS_IN_MONTH[2] = 28;

// Recalculate offsets with Feb=28 for a consistent 365-day year
const MONTH_DAY_OFFSETS = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// Fudge factors: [earliestYearOffset, latestYearOffset, minDayOffset, maxDayOffset]
const FUDGE: Record<string, [number, number, number, number]> = {
  Abt: [-1, 1, -365, 365],
  Cal: [0, 0, 0, 0],
  Est: [-10, 10, -3650, 3650],
  Bef: [-10, 0, -3650, 0],
  Aft: [0, 10, 0, 3650],
};

const MONTH_ABBRS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

// Quarter start/end months
const QUARTER_START: Record<number, number> = { 1: 1, 2: 4, 3: 7, 4: 10 };
const QUARTER_END: Record<number, number> = { 1: 3, 2: 6, 3: 9, 4: 12 };

interface ParsedDate {
  modifier: string | null;
  day: number | null;
  month: number | null;  // 1-12
  year: number;
  quarter: number | null; // 1-4
}

/**
 * Strip trailing parenthetical text and uncertainty markers.
 */
function cleanInput(std: string): string {
  // Strip trailing (?), (SOME TEXT), and standalone ?
  let s = std.replace(/\s*\([^)]*\)\s*$/, '').trim();
  s = s.replace(/\s*\?\s*$/, '').trim();
  return s;
}

/**
 * Parse a single standardized date component (not a range or "or").
 * Returns null if no year can be extracted.
 */
function parseSingle(s: string): ParsedDate | null {
  s = s.trim();
  if (!s) return null;

  let modifier: string | null = null;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let quarter: number | null = null;

  // Check for modifier
  const modMatch = s.match(/^(Abt|Cal|Est|Bef|Aft)\s+/);
  if (modMatch) {
    modifier = modMatch[1];
    s = s.slice(modMatch[0].length);
  }

  // Check for quarter
  const qMatch = s.match(/^Q([1-4])\s+(\d+)$/);
  if (qMatch) {
    quarter = parseInt(qMatch[1]);
    year = parseInt(qMatch[2]);
    return { modifier, day, month, year, quarter };
  }

  // Check for BC
  let bc = false;
  if (s.match(/\s+BC$/)) {
    bc = true;
    s = s.replace(/\s+BC$/, '');
  }

  // Check for split year (e.g., 1623/24)
  const splitMatch = s.match(/(\d+)\/(\d{1,2})$/);
  if (splitMatch) {
    const baseYear = parseInt(splitMatch[1]);
    // Effective year for a split year is always baseYear + 1
    year = baseYear + 1;
    // Remove the split year part and parse rest
    s = s.replace(/\d+\/\d{1,2}$/, '').trim();
  }

  // Parse: optional day, optional month, year
  // Patterns: "28 Sep 1974", "Sep 1974", "1974", "28 Sep" (year already extracted from split)
  const fullMatch = s.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_ABBRS})(?:\\s+(\\d+))?$`));
  if (fullMatch) {
    day = parseInt(fullMatch[1]);
    month = MONTH_NUM.get(fullMatch[2])!;
    if (fullMatch[3] && year === null) year = parseInt(fullMatch[3]);
  } else {
    const monthYearMatch = s.match(new RegExp(`^(${MONTH_ABBRS})(?:\\s+(\\d+))?$`));
    if (monthYearMatch) {
      month = MONTH_NUM.get(monthYearMatch[1])!;
      if (monthYearMatch[2] && year === null) year = parseInt(monthYearMatch[2]);
    } else {
      const yearOnlyMatch = s.match(/^(\d+)$/);
      if (yearOnlyMatch && year === null) {
        year = parseInt(yearOnlyMatch[1]);
      }
    }
  }

  if (year === null) return null;
  if (bc) year = -year;

  return { modifier, day, month, year, quarter };
}

function getEarliestYear(p: ParsedDate): number {
  const fudge = p.modifier ? FUDGE[p.modifier] : null;
  const offset = fudge ? fudge[0] : 0;
  return p.year + offset;
}

function getLatestYear(p: ParsedDate): number {
  const fudge = p.modifier ? FUDGE[p.modifier] : null;
  const offset = fudge ? fudge[1] : 0;
  return p.year + offset;
}

/**
 * Calculate the minimum day number for a parsed date.
 */
function minDayNum(p: ParsedDate): number {
  const fudge = p.modifier ? FUDGE[p.modifier] : null;
  const dayOffset = fudge ? fudge[2] : 0;

  let minMonth: number;
  let minDay: number;

  if (p.quarter !== null) {
    minMonth = QUARTER_START[p.quarter];
    minDay = 1;
  } else {
    minMonth = p.month ?? 1;
    minDay = p.day ?? 1;
  }

  return p.year * 365 + MONTH_DAY_OFFSETS[minMonth] + minDay + dayOffset;
}

/**
 * Calculate the maximum day number for a parsed date.
 */
function maxDayNum(p: ParsedDate): number {
  const fudge = p.modifier ? FUDGE[p.modifier] : null;
  const dayOffset = fudge ? fudge[3] : 0;

  let maxMonth: number;
  let maxDay: number;

  if (p.quarter !== null) {
    maxMonth = QUARTER_END[p.quarter];
    maxDay = DAYS_IN_MONTH[maxMonth];
  } else {
    maxMonth = p.month ?? 12;
    maxDay = p.day ?? DAYS_IN_MONTH[maxMonth];
  }

  return p.year * 365 + MONTH_DAY_OFFSETS[maxMonth] + maxDay + dayOffset;
}

interface DateRange {
  min: number;
  max: number;
}

/**
 * Get the full day range [min, max] for a standardized date string.
 * Returns null if no year can be extracted.
 */
export function getDayRange(std: string): DateRange | null {
  const cleaned = cleanInput(std);
  if (!cleaned) return null;

  // Check for range: "Bet X and Y"
  const rangeMatch = cleaned.match(/^Bet\s+(.+?)\s+and\s+(.+)$/);
  if (rangeMatch) {
    const start = parseSingle(rangeMatch[1]);
    const end = parseSingle(rangeMatch[2]);
    if (!start || !end) return null;
    return { min: minDayNum(start), max: maxDayNum(end) };
  }

  // Check for "or": "X or Y"
  const orMatch = cleaned.match(/^(.+?)\s+or\s+(.+)$/);
  if (orMatch) {
    const a = parseSingle(orMatch[1]);
    const b = parseSingle(orMatch[2]);
    if (!a || !b) return null;
    return {
      min: Math.min(minDayNum(a), minDayNum(b)),
      max: Math.max(maxDayNum(a), maxDayNum(b)),
    };
  }

  // Single date
  const p = parseSingle(cleaned);
  if (!p) return null;
  return { min: minDayNum(p), max: maxDayNum(p) };
}

/**
 * Returns the earliest possible year for a standardized date string.
 */
export function earliestYear(std: string): number | null {
  const cleaned = cleanInput(std);
  if (!cleaned) return null;

  // Check for range: "Bet X and Y" — use start
  const rangeMatch = cleaned.match(/^Bet\s+(.+?)\s+and\s+(.+)$/);
  if (rangeMatch) {
    const start = parseSingle(rangeMatch[1]);
    if (!start) return null;
    return getEarliestYear(start);
  }

  // Check for "or": minimum earliest
  const orMatch = cleaned.match(/^(.+?)\s+or\s+(.+)$/);
  if (orMatch) {
    const a = parseSingle(orMatch[1]);
    const b = parseSingle(orMatch[2]);
    if (!a || !b) return null;
    return Math.min(getEarliestYear(a), getEarliestYear(b));
  }

  const p = parseSingle(cleaned);
  if (!p) return null;
  return getEarliestYear(p);
}

/**
 * Returns the latest possible year for a standardized date string.
 */
export function latestYear(std: string): number | null {
  const cleaned = cleanInput(std);
  if (!cleaned) return null;

  // Check for range: "Bet X and Y" — use end
  const rangeMatch = cleaned.match(/^Bet\s+(.+?)\s+and\s+(.+)$/);
  if (rangeMatch) {
    const end = parseSingle(rangeMatch[2]);
    if (!end) return null;
    return getLatestYear(end);
  }

  // Check for "or": maximum latest
  const orMatch = cleaned.match(/^(.+?)\s+or\s+(.+)$/);
  if (orMatch) {
    const a = parseSingle(orMatch[1]);
    const b = parseSingle(orMatch[2]);
    if (!a || !b) return null;
    return Math.max(getLatestYear(a), getLatestYear(b));
  }

  const p = parseSingle(cleaned);
  if (!p) return null;
  return getLatestYear(p);
}

/**
 * Returns the smallest possible gap in days between two standardized dates.
 * Returns 0 if the ranges overlap.
 * Returns null if either date has no year.
 */
export function minDaysDiff(std1: string, std2: string): number | null {
  const r1 = getDayRange(std1);
  const r2 = getDayRange(std2);
  if (!r1 || !r2) return null;

  // Check if ranges overlap
  if (r1.max >= r2.min && r2.max >= r1.min) return 0;

  // Return distance between closest edges
  if (r1.max < r2.min) return r2.min - r1.max;
  return r1.min - r2.max;
}

/**
 * Returns the largest possible gap in days between two standardized dates.
 * Returns null if either date has no year.
 */
export function maxDaysDiff(std1: string, std2: string): number | null {
  const r1 = getDayRange(std1);
  const r2 = getDayRange(std2);
  if (!r1 || !r2) return null;

  // Return distance between farthest edges
  return Math.max(
    Math.abs(r2.max - r1.min),
    Math.abs(r1.max - r2.min),
  );
}

/**
 * Returns true if std1 is definitely before std2 at day-level precision —
 * std1's latest possible day is earlier than std2's earliest possible day.
 *
 * Returns false if std1 is definitely on-or-after std2.
 * Returns null when the day-level ranges overlap (cannot say which is earlier)
 *   or when either date is unparseable.
 */
export function isABeforeB(std1: string, std2: string): boolean | null {
  const r1 = getDayRange(std1);
  const r2 = getDayRange(std2);
  if (!r1 || !r2) return null;

  if (r1.max < r2.min) return true;
  if (r1.min > r2.max) return false;
  return null;
}
