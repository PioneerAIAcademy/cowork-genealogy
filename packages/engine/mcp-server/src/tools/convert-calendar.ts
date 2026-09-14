// convert_calendar — deterministic calendar-conversion arithmetic.
//
// Migrates the in-context arithmetic the `convert-dates` skill does by hand into
// tested code. The LLM keeps every judgment (jurisdiction/era, whether conversion
// is needed, which correction was asked for); the tool applies only the requested
// corrections. Spec: docs/specs/convert-calendar-tool-spec.md.
//
// The three corrections are independent and applied in a fixed order:
//   doubleDatedYear → osNsYear → quakerMonth → julianToGregorianDay
// so a year fix lands before the Quaker roll-over and the day offset operate on it.

export interface ConvertCalendarDate {
  year: number;
  month?: number; // 1–12 calendar month, OR the Quaker ordinal when quakerMonth is requested
  day?: number; // 1–31
  doubleYear?: number; // the "/N" of a double-dated year, e.g. 1 for "1750/1"
}

export interface ConvertCalendarCorrections {
  doubleDatedYear?: boolean;
  osNsYear?: boolean;
  quakerMonth?: { era: "pre_1752" | "post_1752" };
  julianToGregorianDay?: boolean;
}

export interface ConvertCalendarInput {
  date: ConvertCalendarDate;
  corrections: ConvertCalendarCorrections;
  /**
   * Optional place whose calendar regime governs the date. Offline matched
   * lookup against the table below — deliberately NOT a `standardPlace`:
   * resolving one would pull `place-resolver.ts` and the FamilySearch Places
   * API into a tool this spec declares "not a network tool", and would break
   * its live handler in eval/harness/harness/mock_mcp.py.
   */
  jurisdiction?: string;
}

interface AppliedCorrection {
  correction: "doubleDatedYear" | "osNsYear" | "quakerMonth" | "julianToGregorianDay";
  rule: string;
  offsetDays?: number;
  monthShift?: number;
  yearAdjusted?: boolean;
}

export type ConvertCalendarResult =
  | {
      ok: true;
      original: ConvertCalendarDate;
      converted: { year: number; month?: number; day?: number };
      applied: AppliedCorrection[];
      notes: string[];
    }
  | { ok: false; errors: string[] };

// ─── Julian Day Number conversions (Fliegel/Van Flandern) ───────────────────
// JDN is the rigorous form of the spec's offset table: converting a Julian-
// calendar date to its JDN and reading it back as a Gregorian date yields the
// era-correct offset (10/11/12/13) automatically, including the 1700/1800/1900
// skipped-leap thresholds.

function gregorianToJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function julianToJDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - 32083;
}

function gregorianFromJDN(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

// ─── Tool ────────────────────────────────────────────────────────────────────

// ─── Jurisdiction regimes (issue #2260) ─────────────────────────────────────
// The adoption table moved here from `convert-dates/SKILL.md` by lead ruling
// 2026-09-07. The wiki route was the alternative and lost on measurement:
// `Julian_and_Gregorian_Calendars` gives the Dutch provinces as a bare year,
// with no month and no offset, which cannot decide a Gelderland date in
// Jan–Jun 1700.
//
// SCOPE, narrowed from the ruling's wording by review (2026-09-09). The tool
// identifies the REGIME; the caller still names the QUESTION. `corrections`
// stays required. Full auto-selection was rejected because it over-converts
// `ut_convert_dates_007` (a slash-notation question would also get an OS/NS
// year and a day shift) and forces a call on `ut_convert_dates_008`, whose
// validator fails the run if `convert_calendar` is called at all.
//
// The offset itself is NOT in this table and never was — `julianToGregorianDay`
// derives it from Julian Day Numbers, which gets the 1700/1800/1900 thresholds
// right for free. What a jurisdiction adds is which calendar was in force at
// that moment, and where the civil year began.

interface Ymd {
  year: number;
  month: number;
  day: number;
}

type DayReckoning = "julian" | "gregorian" | "swedish";

interface RegimeSpan {
  /** First date, AS WRITTEN, governed by `calendar`. `null` = from the start. */
  from: Ymd | null;
  calendar: DayReckoning;
}

interface Jurisdiction {
  key: string;
  /** Match keys, compared after `normalizeJurisdiction`. */
  aliases: string[];
  /**
   * Ordered spans. `regimeAt` takes the LAST span whose `from` is on or before
   * the date, so a non-monotone history (Groningen) is expressible.
   */
  spans: RegimeSpan[];
  /** Year the civil year began on 1 January. `null` = not modelled here. */
  yearStartJan1From: number | null;
  note?: string;
}

/**
 * Comparison is on the date AS WRITTEN, which is what a genealogist has: the
 * record says "30 June 1700" and the question is which calendar that was. At a
 * changeover the written date is genuinely ambiguous for the few days that were
 * skipped; `regimeAt` resolves to the later span and `convertCalendar` notes it.
 */
function cmpYmd(a: Ymd, b: Ymd): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

// Every jurisdiction row from convert-dates/SKILL.md:107–124, plus the three
// rows review flagged as not being plain adoption dates. Each row carries a
// unit test in tests/tools/convert-calendar.test.ts.
const JURISDICTIONS: Jurisdiction[] = [
  {
    key: "Catholic Europe",
    aliases: ["catholic europe", "spain", "portugal", "italy", "poland", "papal states"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1582, month: 10, day: 15 }, calendar: "gregorian" }],
    yearStartJan1From: 1582,
    note: "Adopted at the Gregorian introduction: 4 Oct 1582 was followed by 15 Oct 1582.",
  },
  {
    key: "France",
    aliases: ["france", "french"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1582, month: 12, day: 20 }, calendar: "gregorian" }],
    yearStartJan1From: 1582,
    note: "9 Dec 1582 was followed by 20 Dec 1582.",
  },
  {
    key: "Catholic German states",
    aliases: ["catholic german states", "catholic germany", "bavaria", "austria"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1583, month: 1, day: 1 }, calendar: "gregorian" }],
    yearStartJan1From: 1583,
    note: "Adoption varied by state across 1583–1585; a date in that window needs the specific state, not this row.",
  },
  {
    key: "Protestant German states",
    aliases: ["protestant german states", "protestant germany", "wurttemberg", "württemberg", "prussia", "saxony"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1700, month: 3, day: 1 }, calendar: "gregorian" }],
    yearStartJan1From: 1700,
    note: "18 Feb 1700 was followed by 1 Mar 1700.",
  },
  {
    key: "Zeeland",
    aliases: ["zeeland", "brabant", "zeeland and brabant"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1582, month: 12, day: 25 }, calendar: "gregorian" }],
    yearStartJan1From: 1583,
    note: "14 Dec 1582 was followed by 25 Dec 1582.",
  },
  {
    key: "Holland",
    aliases: ["holland", "north holland", "south holland"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1583, month: 1, day: 12 }, calendar: "gregorian" }],
    yearStartJan1From: 1583,
    note: "Adopted at the turn of the year, after Zeeland and Brabant.",
  },
  {
    key: "Gelderland",
    aliases: ["gelderland", "guelders"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1700, month: 7, day: 12 }, calendar: "gregorian" }],
    yearStartJan1From: 1700,
    note: "30 Jun 1700 was followed by 12 Jul 1700, so a 1700 date up to 30 Jun is still Old Style.",
  },
  {
    key: "Utrecht",
    aliases: ["utrecht", "overijssel", "utrecht and overijssel"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1700, month: 12, day: 12 }, calendar: "gregorian" }],
    yearStartJan1From: 1700,
    note: "30 Nov 1700 was followed by 12 Dec 1700, so a 1700 date up to 30 Nov is still Old Style.",
  },
  {
    key: "Friesland",
    aliases: ["friesland", "frisia"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1701, month: 1, day: 12 }, calendar: "gregorian" }],
    yearStartJan1From: 1701,
    note: "31 Dec 1700 was followed by 12 Jan 1701.",
  },
  {
    // Non-monotone, and the reason `spans` is a list rather than one date.
    key: "Groningen",
    aliases: ["groningen"],
    spans: [
      { from: null, calendar: "julian" },
      { from: { year: 1583, month: 1, day: 1 }, calendar: "gregorian" },
      { from: { year: 1594, month: 1, day: 1 }, calendar: "julian" },
      { from: { year: 1701, month: 1, day: 12 }, calendar: "gregorian" },
    ],
    yearStartJan1From: 1701,
    note: "Groningen used Gregorian 1583–1594, REVERTED to Julian, then adopted again with Friesland. A 1590 Groningen date is Gregorian; a 1600 one is not.",
  },
  {
    key: "Drenthe",
    aliases: ["drenthe"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1701, month: 5, day: 12 }, calendar: "gregorian" }],
    yearStartJan1From: 1701,
    note: "30 Apr 1701 was followed by 12 May 1701, so a 1701 date up to 30 Apr is still Old Style.",
  },
  {
    key: "Denmark",
    aliases: ["denmark", "norway", "denmark-norway", "denmark and norway"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1700, month: 3, day: 1 }, calendar: "gregorian" }],
    yearStartJan1From: 1700,
    note: "18 Feb 1700 was followed by 1 Mar 1700.",
  },
  {
    key: "England",
    aliases: ["england", "great britain", "britain", "wales", "ireland", "british colonies", "american colonies", "colonial america"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1752, month: 9, day: 14 }, calendar: "gregorian" }],
    yearStartJan1From: 1752,
    note: "2 Sep 1752 was followed by 14 Sep 1752. Before 1752 the civil year began 25 March, which is what osNsYear and double dating are about.",
  },
  {
    // Year-start and day-reckoning move INDEPENDENTLY here — the row review
    // flagged. Scotland moved its year start in 1600 but kept Julian days
    // until the 1752 British correction, so a 14 Feb 1730 Edinburgh date is
    // already year-1730 (no OS/NS shift) yet still needs the day offset.
    key: "Scotland",
    aliases: ["scotland", "scottish"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1752, month: 9, day: 14 }, calendar: "gregorian" }],
    yearStartJan1From: 1600,
    note: "Year start moved to 1 January in 1600, but day reckoning stayed Julian until the 1752 British correction. The two dates are not the same event.",
  },
  {
    // A THIRD day-reckoning, not a late adoption. Sweden omitted leap days
    // from 1700 to run 1 day ahead of Julian, then reverted by inserting
    // 30 February 1712 — a real date in real registers.
    key: "Sweden",
    aliases: ["sweden", "swedish", "finland"],
    spans: [
      { from: null, calendar: "julian" },
      { from: { year: 1700, month: 3, day: 1 }, calendar: "swedish" },
      { from: { year: 1712, month: 3, day: 1 }, calendar: "julian" },
      { from: { year: 1753, month: 3, day: 1 }, calendar: "gregorian" },
    ],
    yearStartJan1From: 1700,
    note: "1 Mar 1700–30 Feb 1712 Sweden ran its own calendar, 1 day ahead of Julian and 10 behind Gregorian. 30 Feb 1712 is a REAL Swedish date, inserted to revert to Julian: Swedish 30 Feb 1712 = Julian 29 Feb 1712 = Gregorian 11 Mar 1712. Gregorian from 1753 (17 Feb 1753 was followed by 1 Mar 1753).",
  },
  {
    key: "Russia",
    aliases: ["russia", "russian empire", "ussr", "soviet union"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1918, month: 2, day: 14 }, calendar: "gregorian" }],
    yearStartJan1From: 1700,
    note: "31 Jan 1918 was followed by 14 Feb 1918.",
  },
  {
    key: "Greece",
    aliases: ["greece", "greek"],
    spans: [{ from: null, calendar: "julian" }, { from: { year: 1923, month: 3, day: 1 }, calendar: "gregorian" }],
    yearStartJan1From: 1923,
    note: "16 Feb 1923 was followed by 1 Mar 1923.",
  },
];

/** Lowercase, strip punctuation and collapse whitespace, so "Württemberg,"
 *  "wurttemberg" and "  Württemberg " all match the same row. Diacritics are
 *  kept — the alias list carries both spellings where they differ. */
function normalizeJurisdiction(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:()'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lookupJurisdiction(raw: string): Jurisdiction | null {
  const n = normalizeJurisdiction(raw);
  if (!n) return null;
  for (const j of JURISDICTIONS) {
    if (normalizeJurisdiction(j.key) === n) return j;
    if (j.aliases.some((a) => normalizeJurisdiction(a) === n)) return j;
  }
  return null;
}

/** Every accepted spelling, for the unmatched-jurisdiction error. */
export function acceptedJurisdictions(): string[] {
  return JURISDICTIONS.map((j) => j.key);
}

function regimeAt(j: Jurisdiction, at: Ymd): DayReckoning {
  let current: DayReckoning = j.spans[0].calendar;
  for (const s of j.spans) {
    if (s.from === null || cmpYmd(at, s.from) >= 0) current = s.calendar;
  }
  return current;
}

export function convertCalendar(input: ConvertCalendarInput): ConvertCalendarResult {
  const { date, corrections } = input ?? {};
  if (!date || !Number.isInteger(date.year)) {
    return { ok: false, errors: ["date.year is required and must be an integer"] };
  }
  if (date.month !== undefined && (date.month < 1 || date.month > 12)) {
    return { ok: false, errors: ["date.month must be 1–12"] };
  }
  if (date.day !== undefined && (date.day < 1 || date.day > 31)) {
    return { ok: false, errors: ["date.day must be 1–31"] };
  }
  const c = corrections ?? {};
  const requested =
    Number(!!c.doubleDatedYear) +
    Number(!!c.osNsYear) +
    Number(!!c.quakerMonth) +
    Number(!!c.julianToGregorianDay);
  if (requested === 0) {
    return { ok: false, errors: ["corrections must request at least one conversion"] };
  }

  // ── Regime resolution (issue #2260) ──────────────────────────────────────
  // An unmatched string is a caller error and returns ok:false. It is NOT
  // silently treated as "no jurisdiction": convert_calendar is in
  // OK_FALSE_IS_FAILURE, so this surfaces to the model as an error it must fix,
  // which is the point — a silent fallback would apply a correction under the
  // WRONG regime and read as success.
  let place: Jurisdiction | null = null;
  if (input.jurisdiction !== undefined) {
    if (typeof input.jurisdiction !== "string" || !input.jurisdiction.trim()) {
      return { ok: false, errors: ["jurisdiction must be a non-empty string when supplied"] };
    }
    place = lookupJurisdiction(input.jurisdiction);
    if (!place) {
      return {
        ok: false,
        errors: [
          `jurisdiction ${JSON.stringify(input.jurisdiction)} is not one this tool knows. ` +
            `Pass one of: ${acceptedJurisdictions().join(", ")}. ` +
            `Matching ignores case and punctuation and accepts common alternates ` +
            `(e.g. "Great Britain" for England, "Württemberg" for the Protestant German states). ` +
            `If the record's place is not on that list, omit jurisdiction and decide the regime yourself.`,
        ],
      };
    }
  }

  let year = date.year;
  let month = date.month;
  let day = date.day;
  const applied: AppliedCorrection[] = [];
  const notes: string[] = [];

  // What the regime says about the date AS WRITTEN. Both flags mean "the
  // caller asked for a correction that does not apply here" — the tool reports
  // it and declines to apply, rather than applying a correction nobody should
  // want or silently dropping the request.
  let dayOffsetNotApplicable = false;
  let osNsNotApplicable = false;
  let swedishShiftDays = 0;
  if (place) {
    const at = { year, month: month ?? 1, day: day ?? 1 };
    const reckoning = regimeAt(place, at);
    notes.push(`${place.key}: ${reckoning} day reckoning on the date as written. ${place.note ?? ""}`.trim());
    if (c.julianToGregorianDay && reckoning === "gregorian") {
      dayOffsetNotApplicable = true;
      notes.push(
        `julianToGregorianDay not applied: ${place.key} was already on the Gregorian calendar for this date, so there is no offset to remove.`,
      );
    }
    if (reckoning === "swedish") {
      // Sweden 1 Mar 1700 – 30 Feb 1712 ran one day AHEAD of Julian. Convert
      // to Julian first, then the normal Julian→Gregorian path applies.
      swedishShiftDays = -1;
      notes.push(
        "Swedish calendar in force: one day ahead of Julian, ten behind Gregorian. Reduced to its Julian equivalent before the day offset.",
      );
    }
    if (c.osNsYear && place.yearStartJan1From !== null && year >= place.yearStartJan1From) {
      osNsNotApplicable = true;
      notes.push(
        `osNsYear not applied: ${place.key} began its civil year on 1 January from ${place.yearStartJan1From}, so a ${year} date needs no Old Style year shift.`,
      );
    }
  }

  // 1. Double-dated year → the later (New Style) year. Inside the Jan 1–Mar 24
  //    window the New-Style year is always +1; outside it there is nothing to
  //    resolve, so the guard below refuses rather than bumping. (This comment
  //    used to assert the slash *proved* the window, which is what let the
  //    unguarded bump ship — see issue #1654.)
  if (c.doubleDatedYear) {
    // A legitimate double date spans consecutive years, so the New-Style year is
    // always year + 1; the recorded "/N" must be consistent with that.
    if (date.doubleYear !== undefined && !String(year + 1).endsWith(String(date.doubleYear))) {
      return {
        ok: false,
        errors: [`doubleYear ${date.doubleYear} is not consistent with the New-Style year ${year + 1}`],
      };
    }
    // Double dating only exists inside the Jan 1–Mar 24 window. On March 25 the
    // Old-Style year increments, so from that date the two styles agree and there
    // is nothing to resolve — bumping anyway would move the event a year. Only
    // refuse when the date PROVES it is outside the window; `month` is optional
    // on this correction, so a year-only input keeps the historical behaviour.
    if (month !== undefined) {
      const provablyOutside = month > 3 || (month === 3 && day !== undefined && day > 24);
      if (provablyOutside) {
        return {
          ok: false,
          errors: [
            `doubleDatedYear does not apply to ${month}/${day ?? "??"}: double dating covers Jan 1–Mar 24 only. ` +
              `On March 25 the Old-Style year increments, so the Old-Style and New-Style years agree from that date onward. ` +
              `A slash written outside the window is anomalous — check where the year turns over in the surrounding register entries rather than resolving it.`,
          ],
        };
      }
      if (month === 3 && day === undefined) {
        notes.push(
          "doubleDatedYear: a March date without a day cannot be tested against the March 24 boundary; " +
            "if the record reads March 25 or later the slash is anomalous and the year should not be resolved",
        );
      }
    }
    year += 1;
    applied.push({
      correction: "doubleDatedYear",
      rule: "Double-dated year resolved to the later (New Style) year (+1)",
      yearAdjusted: true,
    });
  }

  // 2. Old Style → New Style year: dates Jan 1–Mar 24 in a March-25 year-start
  //    jurisdiction belong to the following year by modern reckoning.
  if (c.osNsYear && !osNsNotApplicable) {
    if (month === undefined) {
      return { ok: false, errors: ["osNsYear requires date.month"] };
    }
    let bump = false;
    if (month < 3) {
      bump = true;
    } else if (month === 3) {
      if (day === undefined) {
        notes.push(
          "osNsYear: a March date without a day is ambiguous for the March 24 boundary; year not adjusted",
        );
      } else if (day <= 24) {
        bump = true;
      }
    }
    if (bump) {
      year += 1;
      applied.push({
        correction: "osNsYear",
        rule: "Date falls Jan 1–Mar 24 in an Old-Style (year starts March 25) jurisdiction; New-Style year is +1",
        yearAdjusted: true,
      });
    } else if (month !== 3 || day !== undefined) {
      applied.push({
        correction: "osNsYear",
        rule: "Date is after March 24; no Old-Style year correction needed",
        yearAdjusted: false,
      });
    }
  }

  // 3. Quaker numbered month → calendar month, respecting the 1752 shift.
  if (c.quakerMonth) {
    if (c.quakerMonth.era !== "pre_1752" && c.quakerMonth.era !== "post_1752") {
      return { ok: false, errors: ["quakerMonth.era must be 'pre_1752' or 'post_1752'"] };
    }
    if (month === undefined) {
      return {
        ok: false,
        errors: ["quakerMonth requires date.month (the Quaker ordinal)"],
      };
    }
    const ordinal = month;
    if (c.quakerMonth.era === "post_1752") {
      month = ordinal; // 1st month = January
      applied.push({
        correction: "quakerMonth",
        rule: `Post-1752 Quaker numbering: ${ordinal} month → calendar month ${month} (1st = January)`,
        monthShift: 0,
      });
    } else {
      // pre_1752: 1st month = March; the 11th/12th roll into the next year.
      if (ordinal <= 10) {
        month = ordinal + 2;
        applied.push({
          correction: "quakerMonth",
          rule: `Pre-1752 Quaker numbering: ${ordinal} month → calendar month ${month} (1st = March)`,
          monthShift: 2,
        });
      } else {
        month = ordinal - 10; // 11 → January, 12 → February
        year += 1;
        applied.push({
          correction: "quakerMonth",
          rule: `Pre-1752 Quaker numbering: ${ordinal} month → ${month === 1 ? "January" : "February"} of the following year (1st = March)`,
          monthShift: -10,
          yearAdjusted: true,
        });
      }
    }
  }

  // 4. Julian → Gregorian day offset, via JDN round-trip.
  if (c.julianToGregorianDay && !dayOffsetNotApplicable) {
    if (month === undefined || day === undefined) {
      notes.push(
        "julianToGregorianDay needs a full day-month-year date; day offset not applied",
      );
    } else if (julianToJDN(year, month, day) < gregorianToJDN(1582, 10, 15)) {
      // The Gregorian calendar did not exist before 1582-10-15, so there is no
      // genealogically meaningful Julian→Gregorian day offset to apply.
      return {
        ok: false,
        errors: [
          "julianToGregorianDay is not defined before the 1582-10-15 Gregorian introduction (the Julian and Gregorian calendars had not diverged)",
        ],
      };
    } else {
      // swedishShiftDays is -1 only inside Sweden's 1700–1712 window. Feb 30
      // survives this arithmetic: the Fliegel formula is linear, so Julian
      // "30 Feb 1712" is 1 Mar 1712, and -1 day lands on 29 Feb 1712 — the
      // real Julian date behind the real Swedish one.
      const jdn = julianToJDN(year, month, day) + swedishShiftDays;
      const offsetDays = jdn - gregorianToJDN(year, month, day);
      const g = gregorianFromJDN(jdn);
      year = g.year;
      month = g.month;
      day = g.day;
      applied.push({
        correction: "julianToGregorianDay",
        rule: `Julian → Gregorian: +${offsetDays} days`,
        offsetDays,
      });
    }
  }

  const converted: { year: number; month?: number; day?: number } = { year };
  if (month !== undefined) converted.month = month;
  if (day !== undefined) converted.day = day;

  return { ok: true, original: { ...date }, converted, applied, notes };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const convertCalendarSchema = {
  name: "convert_calendar",
  description:
    "Convert a date between historical calendar systems — Old Style→New Style " +
    "year, Julian→Gregorian day offset, and Quaker numbered-month resolution. Use " +
    "when a genealogist asks to convert a date, when a double-dated year (e.g. " +
    "'1750/1') or a Quaker numbered month appears, or when a date seems off by a " +
    "year/days because of a calendar transition.\n" +
    "\n" +
    "Pass `jurisdiction` whenever the record names a place and the tool identifies " +
    "the regime for you — which calendar was in force, where the civil year began, " +
    "and whether a requested correction applies at all. You still decide WHICH " +
    "question to ask: request ONLY the correction(s) the user asked for via `corrections` — the " +
    "tool does just those, in a fixed order, and never bundles a correction you " +
    "didn't request. Pass `date` as structured year/month/day; `month` is the " +
    "Quaker ordinal when you request `quakerMonth`. Returns the converted date, the " +
    "rule(s) applied (with the day offset), and notes. It writes nothing — present " +
    "the original date alongside the conversion.",
  inputSchema: {
    type: "object" as const,
    properties: {
      date: {
        type: "object",
        description: "The recorded date, as structured fields.",
        properties: {
          year: { type: "number", description: "The year as recorded." },
          month: {
            type: "number",
            description:
              "Calendar month 1–12 — EXCEPT when requesting quakerMonth, where this is the Quaker ordinal 1–12. Required for the day offset and Quaker conversions.",
          },
          day: { type: "number", description: "Day of month 1–31. Required for the day offset." },
          doubleYear: {
            type: "number",
            description: "The trailing '/N' of a double-dated year, e.g. 1 for '1750/1' (used with doubleDatedYear).",
          },
        },
        required: ["year"],
      },
      jurisdiction: {
        type: "string",
        description:
          "Optional. The place the record comes from, so the tool can identify which calendar was in force — pass it whenever the record names one. Offline matched lookup, NOT a standardPlace: England, Scotland, France, Sweden, Russia, Greece, Denmark, Holland, Zeeland, Gelderland, Utrecht, Friesland, Groningen, Drenthe, Catholic Europe, Catholic German states, Protestant German states. Case and punctuation are ignored and common alternates are accepted (\"Great Britain\", \"Württemberg\", \"Moscow\" is NOT — pass \"Russia\"). An unrecognized string is an error listing the accepted keys. When supplied, the tool declines a correction the regime says does not apply (an already-Gregorian date, or an Old Style year shift in a place whose year already began 1 January) and says so in notes.",
      },
      corrections: {
        type: "object",
        description: "Which correction(s) to apply — request only what was asked.",
        properties: {
          doubleDatedYear: {
            type: "boolean",
            description: "Resolve a double-dated year ('1750/1') to the later New-Style year.",
          },
          osNsYear: {
            type: "boolean",
            description: "Apply the Old Style→New Style year correction (Jan 1–Mar 24 → year + 1).",
          },
          quakerMonth: {
            type: "object",
            description: "Interpret `month` as a Quaker numbered month using the pre/post-1752 shift.",
            properties: {
              era: { type: "string", enum: ["pre_1752", "post_1752"] },
            },
            required: ["era"],
          },
          julianToGregorianDay: {
            type: "boolean",
            description: "Add the era-appropriate Julian→Gregorian day offset (10/11/12/13).",
          },
        },
      },
    },
    required: ["date", "corrections"],
  },
};
