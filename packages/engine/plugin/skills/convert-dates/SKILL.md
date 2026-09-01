---
name: convert-dates
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

If the date is already expressed in the calendar the user asked about —
no jurisdiction's transition applies to it — say so directly and skip
the call. `corrections` must always name at least one real conversion;
the tool rejects an empty `corrections` object as an input error, so
calling it "just to check" produces nothing useful.

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
call again. Do not fall back to hand arithmetic. When the rejection is
because the date precedes the Gregorian calendar's existence anywhere
(a Julian date before 15 October 1582), do not present a "Gregorian
date" field at all — not even the original date held "unchanged".
Give the date once, as recorded, labelled Julian / Old Style. A
proleptic Gregorian alignment may be offered only if explicitly
labelled proleptic or hypothetical.

**Present the result** in step-by-step form: original date and system
(`original`), the rule applied (`applied[].rule`, plus
`applied[].offsetDays` on a day shift), and the converted date
(`converted`). Example: "10 June 1650 (Julian, France) +10 days =
20 June 1650 (Gregorian)". When the tool returns a converted date,
always preserve both the original and converted forms.

## Calendar regime tables

Use these tables to identify which calendar was in force, then pass the
matching `corrections` key.

### Julian vs. Gregorian → `julianToGregorianDay: true`

| Jurisdiction | Gregorian adoption | Offset at adoption | Notes |
|---|---|---|---|
| Catholic Europe (Spain, Portugal, Italy, Poland) | Oct 1582 | 10 days | Oct 4 → Oct 15 |
| France | Dec 1582 | 10 days | |
| Catholic German states | 1583–1585 | 10 days | Varied by state |
| Protestant German states | 1700 | 10→11 days | Feb 18 → Mar 1 |
| Zeeland, Brabant | Dec 1582 | 10 days | Dec 14 → Dec 25 |
| Holland | Jan 1583 | 10 days | Adopted at the turn of the year, after Zeeland and Brabant |
| Gelderland | Jul 1700 | 11 days | Jun 30 → Jul 12. A 1700 date up to Jun 30 is still Old Style |
| Utrecht, Overijssel | Dec 1700 | 11 days | Nov 30 → Dec 12. A 1700 date up to Nov 30 is still Old Style |
| Friesland, Groningen | Dec 1700 | 11 days | Dec 31 1700 → Jan 12 1701. Groningen used Gregorian 1583–1594, then reverted to Julian |
| Drenthe | Apr 1701 | 11 days | Apr 30 → May 12 1701. A 1701 date up to Apr 30 is still Old Style |
| Denmark/Norway | 1700 | 10→11 days | |
| Great Britain & colonies | Sep 1752 | 11 days | Sep 2 → Sep 14 |
| Sweden | 1753 | 11 days (post-1753); 1700–1753 used a unique "Swedish calendar" 1 day ahead of Julian / 10 days behind Gregorian | Failed gradual transition; Feb 30, 1712 is a real Swedish date (added to revert to Julian). Swedish 30 Feb 1712 = Julian 29 Feb 1712 = Gregorian 11 Mar 1712 |
| Scotland | 1752 (day correction) | 10→11 days | Year-start changed to Jan 1 in 1600 |
| Russia | Feb 1918 | 13 days | Jan 31 → Feb 14 |
| Greece | 1923 | 13 days | |

Offset grows by 1 day the day after each Julian Feb 29 the Gregorian
calendar skipped — the threshold is 1 March (Julian), not New Year:
10 days before 1 Mar 1700; 11 from 1 Mar 1700; 12 from 1 Mar 1800;
13 from 1 Mar 1900. A Julian Jan–Feb date in 1700, 1800 or 1900 keeps
the previous century's offset (Julian 14 Feb 1900 → +12, not +13).

### Old Style / New Style year → `osNsYear: true`

Before 1752, England's legal year began March 25. Dates January 1 –
March 24 are in the "previous" year by modern reckoning:
"15 February 1720" OS = "15 February 1721" NS.

### Double-dated years → `doubleDatedYear: true`

Records often show both years: "6 January 1745/6" means 1745 OS but
1746 NS. Pass `date: { year: 1745, doubleYear: 6 }` — the tool
returns the later (New Style) year. Double dates belong to Jan 1 –
Mar 24 only. On 25 March the two years are the same, so a slash on
that date is anomalous: flag it and check where the year turns over in
the surrounding register entries. Do not resolve it to the later year.

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
