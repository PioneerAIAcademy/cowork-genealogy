---
name: convert-dates
model: claude-sonnet-4-6
description: Converts historical dates across calendar regime boundaries —
  Julian to Gregorian, Old Style to New Style, Quaker numbered months.
  Handles country-specific transition dates (England 1752, Catholic Europe
  1582, Russia 1918, etc.). Outputs converted dates to the user; does not
  modify project files (dates remain freeform strings per the schema). Use
  when the user says "convert this date", "Julian or Gregorian?", "Old
  Style date", "New Style", "Quaker date"; when the user asks what a
  double-dated notation like "1749/50" or "25 March 1750/1" MEANS or which
  year to use; when the user asks for the Gregorian equivalent of a
  pre-transition Julian date in any jurisdiction; or when record-extraction
  or assertion-classification encounters a date from before the Gregorian
  transition in the relevant jurisdiction. Do NOT use for cosmetic display
  reformatting that does not cross a calendar regime — converting
  "15-Feb-1821" to "February 15, 1821", expanding abbreviated month names,
  switching date separators, or rearranging day/month/year order are NOT
  calendar conversions. Also do NOT use for resolving date conflicts
  between sources (use conflict-resolution), for schema validation (use
  validate-schema), or to explain WHY a calendar or dating convention
  existed or its cultural history (use historical-context). This skill
  performs the mechanical conversion or interpretation of a specific
  date — not display reformatting and not background narrative.
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

This is a knowledge skill — there is no MCP tool to call. The conversion
is deterministic arithmetic you perform in context from the jurisdiction,
the era, and the tables below. (A `convert_calendar` tool is specced for
the future but is **not yet implemented** — do not attempt to call it.)

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

Work it from the tables above:
- Apply the Old Style → New Style **year** correction if the date falls
  between January 1 and March 24 in a pre-transition jurisdiction.
- Apply the Julian → Gregorian **day** offset (10–13 days, depending on
  jurisdiction and era) when a full Gregorian equivalent is needed.
- Resolve Quaker month numbering against the pre-/post-1752 shift.

If you can't determine the jurisdiction or which calendar was in use,
flag the ambiguity rather than guessing.

### 4. Present the conversion

Show the user:
- Original date and system
- Converted date
- The rule that applies
- Why the conversion matters for their research

**Example:**

```
Date conversion: "25 March 1750/1"

This is a double-dated English record (pre-1752).
- Old Style: 25 March 1750 (year starts March 25)
- New Style: 25 March 1751 (year starts January 1)

The correct modern date is: 25 March 1751

Additionally, the Julian calendar was 11 days behind:
- Gregorian equivalent: 5 April 1751

For genealogical records, use: 1751-03-25 (New Style year,
Julian day — the standard convention for pre-1752 English dates)
unless precise Gregorian conversion is needed for cross-country
comparison.
```

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
