import { describe, it, expect } from "vitest";
import { convertCalendar } from "../../src/tools/convert-calendar.js";

describe("convert_calendar", () => {
  describe("doubleDatedYear", () => {
    it("resolves '1750/1' to the later New-Style year", () => {
      const r = convertCalendar({
        date: { year: 1750, month: 3, day: 25, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.converted).toEqual({ year: 1751, month: 3, day: 25 });
      expect(r.applied.map((a) => a.correction)).toEqual(["doubleDatedYear"]);
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
        date: { year: 1750, month: 3, day: 25, doubleYear: 1 },
        corrections: { doubleDatedYear: true },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // year resolved, but day/month untouched and no offset applied.
      expect(r.converted).toEqual({ year: 1751, month: 3, day: 25 });
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
});
