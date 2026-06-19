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

  let year = date.year;
  let month = date.month;
  let day = date.day;
  const applied: AppliedCorrection[] = [];
  const notes: string[] = [];

  // 1. Double-dated year → the later (New Style) year. The slash already signals
  //    the Jan 1–Mar 24 boundary, so the New-Style year is always +1.
  if (c.doubleDatedYear) {
    // A legitimate double date spans consecutive years, so the New-Style year is
    // always year + 1; the recorded "/N" must be consistent with that.
    if (date.doubleYear !== undefined && !String(year + 1).endsWith(String(date.doubleYear))) {
      return {
        ok: false,
        errors: [`doubleYear ${date.doubleYear} is not consistent with the New-Style year ${year + 1}`],
      };
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
  if (c.osNsYear) {
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
  if (c.julianToGregorianDay) {
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
      const jdn = julianToJDN(year, month, day);
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
    "You decide the regime (jurisdiction, era, whether conversion is even needed) " +
    "and request ONLY the correction(s) the user asked for via `corrections` — the " +
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
