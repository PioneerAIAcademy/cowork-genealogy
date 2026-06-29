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

## Routing

**Use convert-dates when** the date difference between sources matches
the expected calendar offset for the jurisdictions involved — that is
a conversion, not a conflict.

**Hand off to conflict-resolution when** the difference does NOT match
any expected calendar offset, or both records come from the same
jurisdiction at the same time (same calendar system). Before flagging
a date disagreement, check whether the records come from jurisdictions
on different calendars. If the difference is exactly 10–13 days, or
exactly 1 year (for Jan–Mar dates), or both — it is almost certainly
a calendar-system difference, not a true conflict.

**No skill needed when** both dates are already in the same calendar
system (e.g. both post-transition Gregorian) and the gap does not match
any calendar offset — the user can resolve this with general GPS
reasoning about source proximity and evidence weighing.

**Hand off to historical-context when** the user asks WHY a calendar
or dating convention existed. "Convert this Quaker date" is
convert-dates. "Why did Quakers use numbered months?" is
historical-context.

## Calling `convert_calendar`

The tool does only arithmetic — your job is the judgment: identify the
regime (jurisdiction, era, calendar in force) from the tables below,
decide which corrections the user actually asked for, and request
exactly those.

```
convert_calendar({
  date: { year, month?, day?, doubleYear? },
  corrections: {
    doubleDatedYear?: true,                  // resolve "1750/1" → later year
    osNsYear?: true,                         // Jan 1–Mar 24 → year + 1
    quakerMonth?: { era: "pre_1752" | "post_1752" }, // month is the Quaker ordinal
    julianToGregorianDay?: true,             // add the era day offset (10–13)
  },
})
```

Returns `{ ok: true, original, converted, applied, notes }`. Narrate
from `applied[].rule` and `notes[]`, present `converted` next to
`original`.

If it returns `{ ok: false, errors }`, surface the error and the
missing input to the user — fix the input or the regime choice and
call again. Do not fall back to hand arithmetic.

**Present the result** in step-by-step form: original date and system
(`original`), the rule applied (`applied[].rule`, plus
`applied[].offsetDays` on a day shift), and the converted date
(`converted`). Example: "14 September 1582 (Julian) +10 days =
24 September 1582 (Gregorian)". Always preserve both the original
and converted forms.

## Calendar regime tables

Use these tables to identify which calendar was in force, then pass the
matching `corrections` key.

### Julian vs. Gregorian → `julianToGregorianDay: true`

| Jurisdiction | Gregorian adoption | Offset | Notes |
|---|---|---|---|
| Catholic Europe (Spain, Portugal, Italy, Poland) | Oct 1582 | 10 days | Oct 4 → Oct 15 |
| France | Dec 1582 | 10 days | |
| Catholic German states | 1583–1585 | 10 days | Varied by state |
| Protestant German states | 1700 | 10→11 days | Feb 18 → Mar 1 |
| Denmark/Norway | 1700 | 10→11 days | |
| Great Britain & colonies | Sep 1752 | 11 days | Sep 2 → Sep 14 |
| Sweden | 1753 | 11 days (post-1753); 1700–1753 used a unique "Swedish calendar" 1 day ahead of Julian / 10 days behind Gregorian | Failed gradual transition; Feb 30, 1712 is a real Swedish date (added to revert to Julian). Swedish 30 Feb 1712 = Julian 29 Feb 1712 = Gregorian 11 Mar 1712 |
| Scotland | 1752 (day correction) | 10→11 days | Year-start changed to Jan 1 in 1600 |
| Russia | Feb 1918 | 13 days | Jan 31 → Feb 14 |
| Greece | 1923 | 13 days | |

Offset grows by 1 day at each Julian leap year the Gregorian calendar
skipped: before 1700 → 10 days; 1700–1799 → 11; 1800–1899 → 12;
1900+ → 13.

### Old Style / New Style year → `osNsYear: true`

Before 1752, England's legal year began March 25. Dates January 1 –
March 24 are in the "previous" year by modern reckoning:
"15 February 1720" OS = "15 February 1721" NS.

### Double-dated years → `doubleDatedYear: true`

Records often show both years: "25 March 1750/1" means 1750 OS but
1751 NS. Pass `date: { year: 1750, doubleYear: 1 }` — the tool
returns the later (New Style) year.

### Quaker numbered months → `quakerMonth: { era }`

| Quaker | Before 1752 | After 1752 |
|---|---|---|
| 1st month | March | January |
| 2nd month | April | February |
| … | … | … |
| 10th month | December | October |
| 11th month | January (next year) | November |
| 12th month | February (next year) | December |

"1st month" shifts meaning at 1752 — always check the era.

## Rules

- **Answer only the calendar question asked.** Each correction
  (OS/NS year, Julian→Gregorian day, Quaker month, double-date) is a
  separate operation. Do not bundle corrections the user didn't
  request — that is over-conversion.
- **Show original next to converted.** The original is what the record
  says; the conversion is interpretation. Keep them distinct.
- **When in doubt, don't convert.** If the jurisdiction or calendar
  convention is unclear, flag the ambiguity rather than guessing.
- **Jurisdiction matters.** Never convert without knowing where the
  record was created.

## Re-invocation behavior

Output-only. Writes nothing. Idempotent — same date and jurisdiction produce the same result.
