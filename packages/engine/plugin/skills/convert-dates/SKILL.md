---
name: convert-dates
model: claude-sonnet-4-6
description: Use when a genealogist asks to convert a date "to the
  Gregorian calendar," asks what a Quaker numbered-month date means in
  modern terms, wonders if an unusual historical date is valid under the
  period's calendar system, or wants to know if same-date records from
  different countries actually describe the same day. Handles
  Julian-to-Gregorian arithmetic, Old Style/New Style year-start
  corrections, Quaker numbered months, and double-dated years (e.g.
  "1749/50"). Country transition cutoffs — Catholic Europe 1582, Germany
  1700, England/colonies 1752, Sweden 1753, Russia 1918. Skip for cosmetic
  reformatting without conversion (use no skill), date schema validation
  (use validate-schema), source conflicts where both records used the
  same calendar (use conflict-resolution), and explanations of why a
  calendar convention existed (use historical-context).
allowed-tools:
  - convert_calendar
---

# Convert Dates

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Converts historical dates between calendar systems. Before the
Gregorian calendar was universally adopted, different jurisdictions
used different systems — and the transition dates vary by country.
Getting this wrong can place an event in the wrong YEAR, not just
the wrong day.

## When to use this skill vs conflict-resolution

**Use convert-dates when:** the date difference between sources
matches the expected calendar offset for the jurisdictions involved.
This is a conversion, not a conflict — the dates actually agree.

**Hand off to conflict-resolution when:** the date difference does
NOT match any expected calendar offset, or both records come from
the same jurisdiction at the same time (same calendar system).

**Decision rule:** Before flagging a date disagreement to
conflict-resolution, check whether the records come from
jurisdictions on different calendars. If the difference is exactly
10-13 days, or exactly 1 year (for Jan-Mar dates), or both — it is
almost certainly a calendar-system difference, not a true conflict.

Load `references/calendar-conflicts.md` for the full decision
process and common patterns.

## When to use this skill vs historical-context

**Use convert-dates when:** the user supplies a specific date and
wants it translated between calendar systems — a mechanical conversion.

**Hand off to historical-context when:** the user asks WHY a calendar
or dating convention existed, or wants the cultural or religious
history behind it. "Convert this Quaker date: 3rd month 1748" is
convert-dates. "Why did Quakers use numbered months?" is
historical-context — that is background narrative, not a conversion.
Do not answer it by performing a conversion the user did not ask for.

## How the conversion works

The conversion arithmetic runs in the `convert_calendar` MCP tool. Your
job is the judgment — read the regime off the record (jurisdiction, era,
which calendar was in force) using the tables below, decide whether
conversion is even needed, and decide **which** corrections the user
actually asked for. The tool does only the arithmetic, in a fixed order,
and never bundles a correction you didn't request. It writes nothing.

Call it with the recorded date as structured fields and exactly the
corrections you want:

```
convert_calendar({
  date: { year, month?, day?, doubleYear? },
  corrections: {
    doubleDatedYear?: true,                  // resolve "1750/1" → later year
    osNsYear?: true,                         // Jan 1–Mar 24 → year + 1
    quakerMonth?: { era: "pre_1752" | "post_1752" }, // `month` is the Quaker ordinal
    julianToGregorianDay?: true,             // add the era day offset (10–13)
  },
})
```

It returns `{ ok: true, original, converted, applied, notes }`. Narrate
from `applied[].rule` (one per correction, with `offsetDays` on the day
shift) and `notes[]` (e.g. a day was omitted so the offset was skipped),
and present `converted` next to `original`.

If the call returns `{ ok: false, errors }` (e.g. a missing `month` for an
OS/NS check, or a Julian day offset requested before 1582-10-15), surface
the error and the missing input to the user rather than retrying blindly
or falling back to hand arithmetic — fix the input or the regime choice
and call again.

## Calendar systems relevant to genealogy

### Julian vs. Gregorian

| Jurisdiction | Gregorian adoption date | Julian → Gregorian offset | Notes |
|-------------|------------------------|---------------------------|-------|
| Catholic Europe (Spain, Portugal, Italy, Poland) | October 1582 | 10 days | Jumped from Oct 4 to Oct 15 |
| France | December 1582 | 10 days | |
| Catholic German states | 1583-1585 | 10 days | Varied by state |
| Protestant German states | 1700 | 10 days before Feb 29 Julian 1700; 11 days after | Jumped from Feb 18 to Mar 1 |
| Denmark/Norway | 1700 | 10 days before Feb 29 Julian 1700; 11 days after | |
| Great Britain & colonies | September 1752 | 11 days | Jumped from Sep 2 to Sep 14 |
| Sweden | 1753 | 11 days | Complex transition with "Swedish calendar" 1700-1753 |
| Scotland | 1752 (day correction) | 10 days before Feb 29 Julian 1700; 11 days after | Year-start changed to Jan 1 in 1600; Julian days kept until 1752 |
| Russia | February 1918 | 13 days | Jumped from Jan 31 to Feb 14 |
| Greece | 1923 | 13 days | |

The offset grew by one day each Julian leap-year that the Gregorian
calendar skipped (1700, 1800, 1900 — none divisible by 400). So a
date BEFORE Feb 29 (Julian) 1700 uses a 10-day offset; AFTER, 11 days.
The same threshold logic applies in 1800 (→12) and 1900 (→13).

**Impact on genealogy:** A death in "March 1750" in England under
the Julian calendar corresponds to "March 1751" in the Gregorian
calendar (because England's year started on March 25, not January 1,
until 1752).

### Old Style / New Style (England and colonies)

Two issues compounded in English records before 1752:

1. **Year start:** The legal year began on March 25 (Lady Day), not
   January 1. So dates between January 1 and March 24 are in the
   "previous" year by modern reckoning.
   - "15 February 1720" (Old Style) = "15 February 1721" (New Style)

2. **Julian calendar:** England was also 11 days behind the Gregorian
   calendar by 1752.
   - Both corrections were applied in September 1752

**Double dating:** Records from this period often show both years:
"25 March 1750/1" means March 25 in the year that was 1750 Old Style
but 1751 New Style. The LATER year is the one to use in modern
genealogical records.

### Quaker double-dating

Quakers refused to use "pagan" month and day names. They used
numbers instead:

| Quaker | Modern (before 1752) | Modern (after 1752) |
|--------|---------------------|---------------------|
| 1st month | March | January |
| 2nd month | April | February |
| ... | ... | ... |
| 10th month | December | October |
| 11th month | January (next year) | November |
| 12th month | February (next year) | December |

**The shift:** Before 1752, "1st month" = March (year started March 25).
After 1752, "1st month" = January (year started January 1). A
"3rd month 1740" Quaker date = May 1740 (before 1752 shift), but
"3rd month 1760" = March 1760 (after 1752 shift).

## Steps

### 1. Identify dates needing conversion

Dates need conversion when:
- The record is from a jurisdiction BEFORE its Gregorian adoption
  date AND the date is between January 1 and March 24 (Old Style
  year issue)
- The record shows double dating (1750/1)
- The record uses Quaker month numbering
- The user explicitly asks for conversion
- A date seems "off by one year" (often the OS/NS issue)
- Comparing dates across jurisdictions that were on different
  calendars at the time

### 2. Determine the jurisdiction and period

Critical — the conversion depends on WHERE and WHEN:
- An English record from 1720: Old Style (Julian, year starts March 25)
- A French record from 1720: New Style (Gregorian, year starts Jan 1)
- A Pennsylvania Quaker record from 1720: Quaker numbering + Old Style

### 3. Apply the conversion

Use the tables above to decide the regime, then call `convert_calendar`
with **only** the corrections the user asked for — the tool does the
arithmetic:

- Old Style → New Style **year** (date between January 1 and March 24 in
  a pre-transition jurisdiction): `corrections: { osNsYear: true }`.
- Double-dated year like "1750/1": pass `date: { year: 1750, doubleYear: 1 }`
  with `corrections: { doubleDatedYear: true }` — the tool returns the
  later (New Style) year.
- Julian → Gregorian **day** offset (10–13 days, when a full Gregorian
  equivalent is needed): `corrections: { julianToGregorianDay: true }`
  with a full `year/month/day`. The tool picks the era offset and reports
  it as `applied[].offsetDays`.
- Quaker month numbering: pass the Quaker ordinal as `date.month` with
  `corrections: { quakerMonth: { era: "pre_1752" | "post_1752" } }`.

Request each correction separately and only when asked (see "Answer only
the calendar question that was asked" below). If you can't determine the
jurisdiction or which calendar was in use, flag the ambiguity rather than
guessing — do not call the tool on a regime you haven't pinned down.

### 4. Present the conversion

Narrate from the tool's result. Show the user:
- Original date and system (`original`)
- Converted date (`converted`)
- The rule that applies (`applied[].rule`, plus `applied[].offsetDays`
  on a day shift, and any `notes[]`)
- Why the conversion matters for their research

**Example** — the user asks which YEAR to use for "25 March 1750/1":

```
convert_calendar({
  date: { year: 1750, month: 3, day: 25, doubleYear: 1 },
  corrections: { doubleDatedYear: true },
})
→ { ok: true,
    original: { year: 1750, month: 3, day: 25, doubleYear: 1 },
    converted: { year: 1751, month: 3, day: 25 },
    applied: [{ correction: "doubleDatedYear",
                rule: "Double-dated year resolved to the later (New Style) year (+1)",
                yearAdjusted: true }],
    notes: [] }
```

Present it:

```
Date conversion: "25 March 1750/1" (double-dated English record, pre-1752)
- Original (Old Style): 25 March 1750 (year starts March 25)
- New Style year: 25 March 1751

The correct modern date is: 25 March 1751

For genealogical records, use: 1751-03-25 (New Style year, Julian day —
the standard convention for pre-1752 English dates).
```

The user asked only for the year, so we requested only `doubleDatedYear`
and did not apply the 11-day Julian offset. If they also want the precise
Gregorian DAY equivalent for a cross-country comparison, call again with
`corrections: { julianToGregorianDay: true }` and present that as a
separate result.

## Common traps

| Trap | Problem | Solution |
|------|---------|----------|
| Assuming all European dates are the same system | Catholic and Protestant regions adopted Gregorian at different times — 118 years apart in some cases | Always check the jurisdiction |
| Ignoring the OS/NS year issue | "February 1720" in England is really February 1721 by modern reckoning | Dates Jan 1–Mar 24 in pre-1752 England: add 1 to the year |
| Confusing the two changes | The 11-day shift and the year-start change are independent corrections that happened to coincide in England | Apply each correction separately, then combine |
| Quaker month numbers | "1st month" changes meaning in 1752 | Check whether the date is before or after 1752 |
| Russian dates | Russian Empire used Julian until 1918 | A Russian birth in "1890" is Julian — convert if comparing to Western dates |
| Double-date confusion | "1750/1" — which year to use? | Use the LATER year (the one after the slash) — that's the Gregorian/New Style year |
| Flagging calendar differences as conflicts | Two dates that differ by the expected offset are not contradictory | Check calendar systems BEFORE invoking conflict-resolution |

## Important rules

- **Jurisdiction matters.** Never convert without knowing where the
  record was created.
- **Don't silently convert.** Always present the original date next to
  the converted one. The original is what the record says; the
  conversion is interpretation — keep the two distinct.
- **When in doubt, don't convert.** If you're unsure whether a date
  needs conversion (e.g., it's from a transitional period and you
  don't know which calendar the recorder used), note the ambiguity
  rather than guessing.
- **Cross-jurisdiction comparisons need conversion.** If comparing
  a 1700 English record to a 1700 French record, the English date
  is 11 days behind AND potentially off by one year (Jan-Mar). Both
  corrections matter.
- **Answer only the calendar question that was asked.** Each correction
  type (Old Style → New Style **year**, Julian → Gregorian **day**
  offset, Quaker month numbering) is a separate operation. If the user
  asks which YEAR to use for a double-dated date like "25 March 1750/1",
  answer the year question only — do NOT also apply the day-shift
  offset unprompted. If the user asks for the Gregorian DAY equivalent,
  do that only — do NOT extend into year-start commentary the user
  did not request. Bundling corrections the user didn't ask for is
  over-conversion and obscures the specific decision the genealogist
  is making.

## Re-invocation behavior

**Writes:** nothing. This skill is output-only — it presents the
converted date and the reasoning to the user and does not modify
`research.json` or `tree.gedcomx.json`. Dates are stored as freeform
strings, and an assertion's `date` field keeps the original record
value; the conversion is interpretation shown to the user, not written
back.

**On repeat invocation:** re-runs the same calendar-regime conversion on
the same input. Idempotent — the same date and jurisdiction produce the
same result.
