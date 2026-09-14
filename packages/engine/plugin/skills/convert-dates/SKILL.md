---
name: convert-dates
description: Use when a genealogist asks to convert a date "to the
  Gregorian calendar," asks what a Quaker numbered-month date means in
  modern terms, wonders if an unusual historical date is valid under the
  period's calendar system, or wants to know if same-date records from
  different countries actually describe the same day. Handles
  Julian-to-Gregorian arithmetic, Old Style/New Style year-start
  corrections, Quaker numbered months, and double-dated years (e.g.
  "1749/50"). Country-specific transitions — Catholic Europe, the German
  states, the Dutch provinces, England and its colonies, Scotland, Sweden,
  Russia. Skip for cosmetic
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
on different calendars — convert each with its own `jurisdiction` and
compare what comes back. If a conversion accounts for the gap, or the
gap is exactly 1 year on a Jan–Mar date, or both, it is almost
certainly a calendar-system difference, not a true conflict.

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
the call. `corrections` must always name at least one real conversion.

```
convert_calendar({
  date: { year, month?, day?, doubleYear? },
  corrections: {
    doubleDatedYear?: true,                  // resolve "1750/1" → later year
    osNsYear?: true,                         // Jan 1–Mar 24 → year + 1
    quakerMonth?: { era: "pre_1752" | "post_1752" }, // month is the Quaker ordinal
    julianToGregorianDay?: true,             // apply the era day offset
  },
})
```

Returns `{ ok: true, original, converted, applied, notes }`. Narrate
from `applied[].rule` and `notes[]`, present `converted` next to
`original`.

If it returns `{ ok: false, errors }`, surface the error and the
missing input to the user — fix the input or the regime choice and
call again. Do not fall back to hand arithmetic.

**One rejection reason needs its own presentation rule, not just an
error surfaced:** a Julian date from before the Gregorian calendar
existed anywhere, which the tool names in its error. On that rejection, do
not present a "Gregorian date" field at all — not even the original
date held "unchanged". Give the date once, as recorded, labelled
Julian / Old Style. A proleptic Gregorian alignment may be offered
only if explicitly labelled proleptic or hypothetical.

**Present the result** in step-by-step form: original date and system
(`original`), the rule applied (`applied[].rule`, plus
`applied[].offsetDays` on a day shift), and the converted date
(`converted`). Example: "10 June 1650 (Julian, England), tool applied
julianToGregorianDay, = 20 June 1650 (Gregorian)". Take the offset from
`applied[].offsetDays`, never from memory. When the tool returns a converted date,
always preserve both the original and converted forms.

## Calendar regime

`convert_calendar` holds the adoption table. Pass `jurisdiction` with the
place the record names and it identifies which calendar was in force, where
the civil year began, and whether the correction you asked for applies.

- Pass the place as the record gives it (`England`, `Gelderland`, `Sweden`,
  `Scotland`). Case and punctuation do not matter. An unrecognized place
  returns an error listing what it accepts — read that list, do not guess.
- A place is a jurisdiction, not a town: pass `Russia`, not `Moscow`.
- Where the tool says a correction does not apply, report that. It means the
  date was already on the calendar asked about — not that conversion failed.
- Do not state an adoption date, an offset, or a year-start from memory. Ask
  the tool and quote what it returns.
- Omit `jurisdiction` only when the record names no place, and then say in
  your answer that the conversion assumes a regime you could not confirm.

### Old Style / New Style year → `osNsYear: true`

Where the civil year began later than 1 January, dates between 1 January and
that start belong to the "previous" year by modern reckoning. Which places,
and from which year, is the tool's — pass `jurisdiction`.

### Double-dated years → `doubleDatedYear: true`

Records often show both years: "6 January 1745/6" means 1745 Old Style but
1746 New Style. Pass `date: { year: 1745, doubleYear: 6 }` — the tool returns
the later (New Style) year. Double dates belong to the stretch between 1
January and the old year-start only. On the year-start day itself the two
years are the same, so a slash there is anomalous: flag it and check where the
year turns over in the surrounding register entries. Do not resolve it to the
later year.

### Quaker numbered months → `quakerMonth: { era }`

Quaker registers number their months rather than naming them, and the
numbering shifts at the year-start reform. Request `quakerMonth` with the era
when the source is a Friends record; the tool holds the mapping.

### French Republican calendar

`convert_calendar` cannot convert French Republican dates (Vendémiaire,
Brumaire, an II). Say so and leave the date as recorded — do not guess an
equivalent.

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
