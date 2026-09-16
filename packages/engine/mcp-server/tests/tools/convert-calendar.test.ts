import { describe, it, expect } from "vitest";
import {convertCalendar, acceptedJurisdictions} from "../../src/tools/convert-calendar.js";

describe("convert_calendar", () => {
  describe("doubleDatedYear", () => {
    it("resolves '1750/1' to the later New-Style year", () => {
      const r = convertCalendar({
        date: { year: 1750, month: 2, day: 15, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted).toEqual({ year: 1751, month: 2, day: 15 });
      expect(r.applied.map((a) => a.correction)).toEqual(["doubleDatedYear"]);
    });

    // March 25 is where the Old-Style year INCREMENTS, so from that date the two
    // styles agree and a slash has nothing to disambiguate. Resolving it anyway
    // moves the event a year. This case previously asserted 1751 — the error was
    // in the tool, this test, convert-dates/SKILL.md and ut_convert_dates_007
    // simultaneously (issue #1654).
    it("refuses the year-start boundary day (Mar 25) instead of bumping", () => {
      const r = convertCalendar({
        date: { year: 1750, month: 3, day: 25, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/Jan 1–Mar 24 only/);
    });

    it("bumps on Mar 24 but refuses Mar 25", () => {
      const before = convertCalendar({
        date: { year: 1750, month: 3, day: 24, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      const after = convertCalendar({
        date: { year: 1750, month: 3, day: 25, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(before.ok && before.converted.year).toBe(1751);
      expect(after.ok).toBe(false);
    });

    it("refuses a month outside the window entirely", () => {
      const r = convertCalendar({
        date: { year: 1750, month: 9, day: 14, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(false);
    });

    it("notes, rather than refuses, a March date with no day", () => {
      const r = convertCalendar({
        date: { year: 1750, month: 3, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1751);
      expect(r.notes.join(" ")).toMatch(/cannot be tested against the March 24 boundary/);
    });

    it("still accepts a year-only double date (month is optional)", () => {
      const r = convertCalendar({ date: { year: 1750, doubleYear: 1 }, corrections: { doubleDatedYear: true } });
      expect(r.ok && r.converted.year).toBe(1751);
    });
  });

  describe("osNsYear", () => {
    it("bumps a February date in a pre-1752 jurisdiction", () => {
      const r = convertCalendar({ date: { year: 1720, month: 2, day: 15 }, corrections: { osNsYear: true } });
      expect(r.ok && r.converted.year).toBe(1721);
    });
    it("leaves a June date unchanged", () => {
      const r = convertCalendar({ date: { year: 1720, month: 6, day: 15 }, corrections: { osNsYear: true } });
      expect(r.ok && r.converted.year).toBe(1720);
    });
    it("bumps on the Mar 24 boundary but not Mar 25", () => {
      const before = convertCalendar({ date: { year: 1720, month: 3, day: 24 }, corrections: { osNsYear: true } });
      const after = convertCalendar({ date: { year: 1720, month: 3, day: 25 }, corrections: { osNsYear: true } });
      expect(before.ok && before.converted.year).toBe(1721);
      expect(after.ok && after.converted.year).toBe(1720);
    });
    it("notes ambiguity for a March date with no day", () => {
      const r = convertCalendar({ date: { year: 1720, month: 3 }, corrections: { osNsYear: true } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1720);
      expect(r.notes.join(" ")).toMatch(/ambiguous/);
    });
    it("requires a month", () => {
      const r = convertCalendar({ date: { year: 1720 }, corrections: { osNsYear: true } });
      expect(r.ok).toBe(false);
    });
  });

  describe("quakerMonth", () => {
    it("pre-1752: 1st month is March", () => {
      const r = convertCalendar({ date: { year: 1740, month: 1, day: 3 }, corrections: { quakerMonth: { era: "pre_1752" } } });
      expect(r.ok && r.converted).toEqual({ year: 1740, month: 3, day: 3 });
    });
    it("pre-1752: 11th month rolls into January of the next year", () => {
      const r = convertCalendar({ date: { year: 1740, month: 11, day: 3 }, corrections: { quakerMonth: { era: "pre_1752" } } });
      expect(r.ok && r.converted).toEqual({ year: 1741, month: 1, day: 3 });
    });
    it("post-1752: 1st month is January", () => {
      const r = convertCalendar({ date: { year: 1760, month: 1, day: 3 }, corrections: { quakerMonth: { era: "post_1752" } } });
      expect(r.ok && r.converted).toEqual({ year: 1760, month: 1, day: 3 });
    });
  });

  describe("julianToGregorianDay", () => {
    const offset = (year: number) => {
      const r = convertCalendar({ date: { year, month: 6, day: 15 }, corrections: { julianToGregorianDay: true } });
      if (!r.ok) throw new Error("unexpected");
      return r.applied.find((a) => a.correction === "julianToGregorianDay")?.offsetDays;
    };
    it("applies the era-appropriate offset (10/11/12/13)", () => {
      expect(offset(1690)).toBe(10);
      expect(offset(1750)).toBe(11);
      expect(offset(1850)).toBe(12);
      expect(offset(1950)).toBe(13);
    });
    it("converts the 1752 English cutover date Sep 2 → Sep 13", () => {
      const r = convertCalendar({ date: { year: 1752, month: 9, day: 2 }, corrections: { julianToGregorianDay: true } });
      expect(r.ok && r.converted).toEqual({ year: 1752, month: 9, day: 13 });
    });
    it("skips (with a note) when the day is missing", () => {
      const r = convertCalendar({ date: { year: 1752, month: 9 }, corrections: { julianToGregorianDay: true } });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied).toHaveLength(0);
      expect(r.notes.join(" ")).toMatch(/day offset not applied/);
    });
  });

  describe("composition + discipline", () => {
    it("applies only the requested correction (no unprompted day shift)", () => {
      const r = convertCalendar({
        // In-window date: this case is about correction DISCIPLINE, not the
        // Mar 24/25 boundary, which is covered in the doubleDatedYear block.
        date: { year: 1750, month: 2, day: 15, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // year resolved, but day/month untouched and no offset applied.
      expect(r.converted).toEqual({ year: 1751, month: 2, day: 15 });
      expect(r.applied.some((a) => a.correction === "julianToGregorianDay")).toBe(false);
    });
    it("applies year then day offset in order", () => {
      const r = convertCalendar({
        date: { year: 1720, month: 2, day: 15 },
        corrections: { osNsYear: true, julianToGregorianDay: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // OS/NS bumps to 1721, then +11 days → 26 Feb 1721 Gregorian.
      expect(r.converted).toEqual({ year: 1721, month: 2, day: 26 });
      expect(r.applied.map((a) => a.correction)).toEqual(["osNsYear", "julianToGregorianDay"]);
    });
  });

  describe("day offset at the leap-skip thresholds", () => {
    const off = (y: number, m: number, d: number) => {
      const r = convertCalendar({ date: { year: y, month: m, day: d }, corrections: { julianToGregorianDay: true } });
      if (!r.ok) return null;
      return r.applied.find((a) => a.correction === "julianToGregorianDay")?.offsetDays;
    };
    it("steps from 10→11 across 1700, 11→12 across 1800, 12→13 across 1900 (boundary = Mar 1 Julian)", () => {
      expect(off(1700, 2, 28)).toBe(10);
      expect(off(1700, 3, 1)).toBe(11);
      expect(off(1800, 2, 28)).toBe(11);
      expect(off(1800, 3, 1)).toBe(12);
      expect(off(1900, 2, 28)).toBe(12);
      expect(off(1900, 3, 1)).toBe(13);
    });
  });

  describe("errors + purity", () => {
    it("rejects when no correction is requested", () => {
      const r = convertCalendar({ date: { year: 1750 }, corrections: {} });
      expect(r.ok).toBe(false);
    });
    it("rejects an invalid quakerMonth.era (exported function is called outside the MCP enum)", () => {
      const r = convertCalendar({ date: { year: 1740, month: 1 }, corrections: { quakerMonth: { era: "bogus" as any } } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toMatch(/era must be/);
    });
    it("rejects julianToGregorianDay before the 1582 Gregorian introduction", () => {
      const r = convertCalendar({ date: { year: 1500, month: 1, day: 1 }, corrections: { julianToGregorianDay: true } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toMatch(/1582/);
    });
    it("rejects a doubleYear inconsistent with year + 1", () => {
      const r = convertCalendar({ date: { year: 1750, doubleYear: 9 }, corrections: { doubleDatedYear: true } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors.join(" ")).toMatch(/doubleYear/);
    });
    it("rejects an out-of-range month/day", () => {
      expect(convertCalendar({ date: { year: 1750, month: 13 }, corrections: { osNsYear: true } }).ok).toBe(false);
      expect(convertCalendar({ date: { year: 1750, month: 1, day: 40 }, corrections: { osNsYear: true } }).ok).toBe(false);
    });
    it("does not mutate the input date and is idempotent", () => {
      const input = { date: { year: 1752, month: 9, day: 2 }, corrections: { julianToGregorianDay: true } };
      const r1 = convertCalendar(input);
      const r2 = convertCalendar(input);
      expect(input.date).toEqual({ year: 1752, month: 9, day: 2 });
      expect(r1).toEqual(r2);
    });
  });

  // ── jurisdiction regimes (issue #2260) ───────────────────────────────────
  // One case per row of the table that moved out of convert-dates/SKILL.md,
  // plus the three rows review flagged as not being plain adoption dates.
  describe("jurisdiction: the tool identifies the regime", () => {
    const day = (year: number, month: number, dayOfMonth: number, jurisdiction?: string) =>
      convertCalendar({
        date: { year, month, day: dayOfMonth },
        corrections: { julianToGregorianDay: true },
        ...(jurisdiction === undefined ? {} : { jurisdiction }),
      });

    // Each row: [jurisdiction, last Old Style date, first New Style date].
    // The pair is what a bare adoption YEAR cannot express, and is why the
    // wiki route lost: a year alone cannot place 30 Jun 1700 in Gelderland.
    const ROWS: Array<[string, [number, number, number], [number, number, number]]> = [
      ["France", [1582, 12, 9], [1582, 12, 20]],
      ["Catholic German states", [1582, 12, 31], [1583, 1, 1]],
      ["Protestant German states", [1700, 2, 18], [1700, 3, 1]],
      ["Zeeland", [1582, 12, 14], [1582, 12, 25]],
      ["Holland", [1583, 1, 1], [1583, 1, 12]],
      ["Gelderland", [1700, 6, 30], [1700, 7, 12]],
      ["Utrecht", [1700, 11, 30], [1700, 12, 12]],
      ["Friesland", [1700, 12, 31], [1701, 1, 12]],
      ["Drenthe", [1701, 4, 30], [1701, 5, 12]],
      ["Denmark", [1700, 2, 18], [1700, 3, 1]],
      ["England", [1752, 9, 2], [1752, 9, 14]],
      ["Russia", [1918, 1, 31], [1918, 2, 14]],
      ["Greece", [1923, 2, 16], [1923, 3, 1]],
    ];

    // Catholic Europe is excluded from ROWS and tested on its own: its last Old
    // Style date is 4 Oct 1582, the day before the Gregorian calendar existed
    // anywhere, so "convert it to Gregorian" has no answer and the tool has
    // always refused it. That refusal is the correct behaviour, not a gap.
    it("Catholic Europe: 4 Oct 1582 has no Gregorian equivalent and is refused", () => {
      const r = day(1582, 10, 4, "Catholic Europe");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/not defined before the 1582-10-15 Gregorian introduction/);
    });

    it("Catholic Europe: 15 Oct 1582 is already New Style and is declined", () => {
      const r = day(1582, 10, 15, "Catholic Europe");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).not.toContain("julianToGregorianDay");
    });

    it.each(ROWS)("%s: the last Old Style date still converts", (place, os) => {
      const r = day(os[0], os[1], os[2], place);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).toContain("julianToGregorianDay");
    });

    it.each(ROWS)("%s: the first New Style date is declined, not converted", (place, _os, ns) => {
      const r = day(ns[0], ns[1], ns[2], place);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).not.toContain("julianToGregorianDay");
      expect(r.converted).toEqual({ year: ns[0], month: ns[1], day: ns[2] });
      expect(r.notes.join(" ")).toMatch(/already on the Gregorian calendar/);
    });

    // Row 1 of 3 flagged by review: a THIRD calendar, not a late adoption.
    it("Sweden: 30 February 1712 is a real date and resolves to 11 Mar 1712", () => {
      const r = day(1712, 2, 30, "Sweden");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted).toEqual({ year: 1712, month: 3, day: 11 });
      expect(r.notes.join(" ")).toMatch(/one day ahead of Julian/i);
    });

    it("Sweden: after the 1712 revert it is plain Julian again", () => {
      const r = day(1750, 6, 1, "Sweden");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Julian, so the offset applies and carries no Swedish note.
      expect(r.applied.map((a) => a.correction)).toContain("julianToGregorianDay");
      expect(r.notes.join(" ")).not.toMatch(/one day ahead of Julian/i);
    });

    // Row 2 of 3: year-start and day-reckoning move independently.
    it("Scotland: 1730 still needs the day offset", () => {
      const r = day(1730, 2, 14, "Scotland");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted).toEqual({ year: 1730, month: 2, day: 25 });
    });

    it("Scotland: but osNsYear is declined — the year moved to 1 Jan in 1600", () => {
      const r = convertCalendar({
        date: { year: 1730, month: 2, day: 14 },
        corrections: { osNsYear: true },
        jurisdiction: "Scotland",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1730);
      expect(r.applied).toEqual([]);
      expect(r.notes.join(" ")).toMatch(/1 January from 1600/);
    });

    it("England by contrast still takes osNsYear in 1720", () => {
      const r = convertCalendar({
        date: { year: 1720, month: 2, day: 15 },
        corrections: { osNsYear: true },
        jurisdiction: "England",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1721);
    });

    // Row 3 of 3: non-monotone. A flat jurisdiction->date map loses this.
    it("Groningen: Gregorian 1583-1594, so an in-window date is declined", () => {
      const r = day(1590, 6, 1, "Groningen");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).not.toContain("julianToGregorianDay");
    });

    it("Groningen: REVERTED to Julian, so a 1600 date converts again", () => {
      const r = day(1600, 6, 1, "Groningen");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).toContain("julianToGregorianDay");
    });

    // Asserts WHICH regime each spelling resolves to, not merely that the call
    // succeeded. An earlier version checked only `ok`, and an alias moved onto
    // the wrong country passed it silently -- every spelling still returned
    // ok:true, just under another nation's calendar.
    //
    // 1800 is the discriminating year: England has been Gregorian since 1752,
    // so the correction is DECLINED, while a jurisdiction still on Julian in
    // 1800 (Russia, Greece) would apply a 12-day offset. A 1700 date cannot
    // discriminate -- both were Julian then, so both give the same answer.
    it("every England spelling resolves to England's regime, not merely to ok", () => {
      for (const spelling of ["England", "  england ", "Great Britain", "great britain,", "GREAT BRITAIN"]) {
        const r = convertCalendar({
          date: { year: 1800, month: 6, day: 1 },
          corrections: { julianToGregorianDay: true },
          jurisdiction: spelling,
        });
        expect(r.ok, spelling).toBe(true);
        if (!r.ok) continue;
        expect(r.applied.map((a) => a.correction), spelling).not.toContain("julianToGregorianDay");
        expect(r.converted, spelling).toEqual({ year: 1800, month: 6, day: 1 });
      }
    });

    it("a jurisdiction still Julian in 1800 does convert, so the case above discriminates", () => {
      const r = convertCalendar({
        date: { year: 1800, month: 6, day: 1 },
        corrections: { julianToGregorianDay: true },
        jurisdiction: "Russia",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.applied.map((a) => a.correction)).toContain("julianToGregorianDay");
      expect(r.converted).toEqual({ year: 1800, month: 6, day: 13 });
    });

    // The comment above claims a case per row. Nothing enforced that, and the
    // claim was already false -- `Catholic German states` had no case at all.
    // This makes the guarantee fail loudly instead of reading as coverage.
    it("every jurisdiction the tool accepts is covered by a case above", () => {
      const covered = new Set<string>([
        ...ROWS.map(([place]) => place),
        "Catholic Europe",
        // Venice shares Catholic Europe's 1582 changeover, and the tool refuses
        // julianToGregorianDay before that date, so the ROWS pair cannot express
        // it. Venice is a row because its YEAR start is 215 years later; its own
        // cases live in the osNsYear refusal block.
        "Venice",
        "Sweden",
        "Scotland",
        "Groningen",
      ]);
      const missing = acceptedJurisdictions().filter((k) => !covered.has(k));
      expect(missing, `jurisdiction rows with no test case: ${missing.join(", ")}`).toEqual([]);
    });

    it("an unrecognized jurisdiction is an error that lists the accepted keys", () => {
      const r = convertCalendar({
        date: { year: 1700, month: 1, day: 1 },
        corrections: { julianToGregorianDay: true },
        jurisdiction: "Atlantis",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/not one this tool knows/);
      expect(r.errors[0]).toMatch(/England/);
      expect(r.errors[0]).toMatch(/Gelderland/);
    });

    it("an empty jurisdiction is rejected rather than ignored", () => {
      const r = convertCalendar({
        date: { year: 1700, month: 1, day: 1 },
        corrections: { julianToGregorianDay: true },
        jurisdiction: "   ",
      });
      expect(r.ok).toBe(false);
    });

    it("omitting jurisdiction leaves the pre-#2260 behaviour exactly as it was", () => {
      const without = convertCalendar({
        date: { year: 1750, month: 2, day: 14 },
        corrections: { julianToGregorianDay: true },
      });
      expect(without.ok).toBe(true);
      if (!without.ok) return;
      expect(without.converted).toEqual({ year: 1750, month: 2, day: 25 });
      expect(without.notes.join(" ")).not.toMatch(/day reckoning/);
    });
  });

  // The shift that CHANGES the number must explain itself, not only the one
  // that declines to. Review: "a silently incremented year is the one output a
  // genealogist cannot catch by reading the result."
  describe("osNsYear — the applied path says so", () => {
    it("names the before and after year, and the jurisdiction's year start", () => {
      const r = convertCalendar({
        date: { year: 1650, month: 1, day: 10 },
        corrections: { osNsYear: true },
        jurisdiction: "England",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1651);
      expect(r.notes.join(" ")).toMatch(/osNsYear applied: 1650 → 1651/);
      expect(r.notes.join(" ")).toMatch(/England began its civil year on 1 January from 1752/);
    });

    it("says the year start was assumed when no jurisdiction was given", () => {
      const r = convertCalendar({
        date: { year: 1650, month: 1, day: 10 },
        corrections: { osNsYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1651);
      expect(r.notes.join(" ")).toMatch(/assumes a civil year beginning 25 March/);
    });

    it("stays silent about applying it when the shift was declined", () => {
      const r = convertCalendar({
        date: { year: 1800, month: 1, day: 10 },
        corrections: { osNsYear: true },
        jurisdiction: "England",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1800);
      expect(r.notes.join(" ")).not.toMatch(/osNsYear applied/);
      expect(r.notes.join(" ")).toMatch(/osNsYear not applied/);
    });
  });

  // Review: `yearStartJan1From` was being set from the DAY-RECKONING adoption
  // date on nearly every row, and the year start is a different fact. Setting it
  // too late applies the OS/NS shift where none belongs, silently. These are the
  // four cases the review measured as wrong, plus the two rows that were right.
  describe("osNsYear — year start is not the day-reckoning adoption date", () => {
    const jan10 = (place: string, year: number) =>
      convertCalendar({
        date: { year, month: 1, day: 10 },
        corrections: { osNsYear: true },
        jurisdiction: place,
      });

    it.each([
      ["France", 1570],
      ["Denmark", 1650],
      ["Protestant German states", 1650],
    ])("%s %d is already New Style and is NOT shifted", (place, year) => {
      const r = jan10(place as string, year as number);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(year);
    });

    it.each([
      ["England", 1650, 1651],
      ["Scotland", 1580, 1581],
    ])("%s %d still shifts to %d", (place, year, expected) => {
      const r = jan10(place as string, year as number);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(expected);
    });

    it("Scotland after 1600 is not shifted, though its days stay Julian to 1752", () => {
      const r = jan10("Scotland", 1650);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1650);
    });
  });

  // The +1 Jan–Mar rule IS the Annunciation case. Applying it to a jurisdiction
  // that displaced a different style produces an off-by-one year that reads as
  // perfectly ordinary, so the tool refuses instead of guessing.
  describe("osNsYear — refuses where the Annunciation rule does not apply", () => {
    const jan10 = (place: string, year: number) =>
      convertCalendar({
        date: { year, month: 1, day: 10 },
        corrections: { osNsYear: true },
        jurisdiction: place,
      });

    it("Christmas-style: refuses in the 25–31 December window, naming the opposite sign", () => {
      // The affected window for a 25 December year start is 25–31 December
      // ONLY — that is where the year number differs, and it differs by MINUS
      // one. A January date needs nothing under this convention.
      const r = convertCalendar({
        date: { year: 1500, month: 12, day: 28 },
        corrections: { osNsYear: true },
        jurisdiction: "Denmark",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/began on 25 DECEMBER/);
      expect(r.errors[0]).toMatch(/opposite sign/);
    });

    it("Christmas-style: a January date is a plain no-op, not an error", () => {
      // Refusing here would reject a question that has a perfectly good answer.
      const r = jan10("Denmark", 1500);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1500);
      expect(r.notes.join(" ")).toMatch(/outside the window where that could matter/);
    });

    it("Easter-style: says the boundary moves", () => {
      const r = jan10("France", 1560);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/began at EASTER, which moves/);
    });

    it("Venice: names the 1 March year start and the narrower window", () => {
      const r = jan10("Venice", 1600);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/began on 1 MARCH/);
      expect(r.errors[0]).toMatch(/28\/29 February/);
    });

    it("Venice after 1797 is fine and is not shifted", () => {
      const r = jan10("Venice", 1850);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1850);
    });

    it("Russia pre-1700: names the Anno Mundi era, not a year shift", () => {
      const r = jan10("Russia", 1650);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/1 SEPTEMBER/);
      expect(r.errors[0]).toMatch(/5508/);
    });

    it("a mixed row refuses at ANY year, because suppressing is a guess too", () => {
      // Catholic Europe spans Poland c.1450 to Venice 1797. A 1600 Florentine
      // date genuinely needed the shift (Florence kept 25 March until 1750),
      // so staying silent would be as wrong as shifting.
      for (const year of [1500, 1600, 1700, 1900]) {
        const r = jan10("Catholic Europe", year);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.errors[0]).toMatch(/covers territories whose civil years began on different dates/);
      }
    });

    it("a mixed row still answers a date no convention would move", () => {
      // 14 September is after every candidate year start in that row, so the
      // answer is the same whichever was in force. This is the regression the
      // first version of the refusal introduced: it errored on Madrid 1582.
      const r = convertCalendar({
        date: { year: 1582, month: 9, day: 14 },
        corrections: { osNsYear: true },
        jurisdiction: "Catholic Europe",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted.year).toBe(1582);
    });

    it("`italy` is refused for the same reason — the alias is too coarse", () => {
      const r = jan10("italy", 1600);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors[0]).toMatch(/Name the specific territory/i);
    });
  });
});
