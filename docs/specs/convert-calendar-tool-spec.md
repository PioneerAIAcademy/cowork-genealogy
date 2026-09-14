# `convert_calendar` — calendar conversion tool — Spec

> **Status:** New (2026-06-19). Migrates the deterministic arithmetic the
> `convert-dates` skill currently performs **by hand in context** into a tested
> MCP tool. The skill's own SKILL.md already anticipates this: *"A
> `convert_calendar` tool is specced for the future but is **not yet
> implemented**"* (`convert-dates/SKILL.md:64`). The LLM keeps every judgment
> (which jurisdiction/era applies, whether conversion is even needed, which
> correction was asked for); the tool does only the arithmetic.

A pure, offline tool that applies the three independent calendar corrections a
genealogist needs — Old Style→New Style **year**, Julian→Gregorian **day**
offset, and Quaker numbered-**month** resolution — each only when the caller
requests it. It computes nothing about *which* regime applies; the caller
supplies that judgment as input.

```
convert_calendar({ date, corrections }) -> { original, converted, applied, notes }
```

---

## 1. Why this exists

Calendar conversion is the one place in the catalog where a hand-arithmetic slip
changes the **year**, not just the day — `convert-dates/SKILL.md:142` lists "a
date seems 'off by one year'" as a trigger, and the OS/NS rule (`SKILL.md:98–110`)
turns "15 February 1720" into 1721. The century-dependent Julian→Gregorian offset
(10/11/12/13 days across the 1700/1800/1900 leap-skip thresholds,
`SKILL.md:84–87`) and the pre-/post-1752 Quaker month shift (`SKILL.md:126–129`)
are equally mechanical and equally easy to get wrong by a day or a month. A wrong
result also propagates: `conflict-resolution` uses the *expected* offset to decide
whether two dates that differ are a real conflict or a calendar artifact
(`SKILL.md:31–36`; `convert-dates/references/calendar-conflicts.md` carried this
until it was deleted, its numbers having moved into §4.5) — a miscomputed
offset silently suppresses a real conflict or fabricates a fake one.

This is exactly the "pure arithmetic the LLM does in-context" anti-pattern: the
rules are fixed tables, the inputs are a date plus a regime, and the output is
deterministic. It belongs in tested code.

---

## 2. Evidence base (seen directly)

| Fact | Source |
|------|--------|
| The skill is knowledge-only today; conversion is "deterministic arithmetic you perform in context"; a `convert_calendar` tool is specced-but-unbuilt | `packages/engine/plugin/skills/convert-dates/SKILL.md:62–65` |
| Julian→Gregorian offset table by jurisdiction + the "grows one day each skipped Julian leap year (1700→11, 1800→12, 1900→13)" rule, with the Feb-29-Julian threshold | `convert-dates/SKILL.md:71–87` |
| OS/NS: legal year began March 25; dates Jan 1–Mar 24 are the "previous" year by modern reckoning; double-dated "1750/1" → use the **later** year | `convert-dates/SKILL.md:94–110, 198, 202` |
| Quaker numbered months; the 1752 shift (before: 1st month = March; after: 1st month = January); 11th/12th month roll into the next year before 1752 | `convert-dates/SKILL.md:112–129` |
| "Answer only the calendar question that was asked" — each correction is a **separate** operation; do not bundle unprompted | `convert-dates/SKILL.md:220–229` |
| Standardized-date parsing/representation already exists | `src/utils/date-standardize.ts` (`stdDate`), `src/utils/date-helpers.ts` (`getDayRange`, `earliestYear`, `latestYear`) |
| The skill writes nothing — output-only, idempotent | `convert-dates/SKILL.md:231–242` |

---

## 3. The tool

```typescript
convert_calendar({
  // The recorded date, as structured fields (the caller has already read it off
  // the record). `month` is the calendar month 1–12, EXCEPT when a quakerMonth
  // correction is requested, where `month` is the Quaker ordinal 1–12.
  date: {
    year: number,
    month?: number,       // 1–12; required for day-offset and quaker conversions
    day?: number,         // 1–31; required for the day-offset conversion
    doubleYear?: number,  // the "/N" of a double-dated year, e.g. 1 for "1750/1"
  },

  // Optional. The place the record names, matched offline against §4.5's
  // table. Supplying it lets the tool identify the REGIME (§5). NOT a
  // standardPlace: resolving one would pull place-resolver.ts and the
  // FamilySearch Places API into a tool §6 declares "not a network tool",
  // and would break its live handler in eval/harness/harness/mock_mcp.py.
  jurisdiction?: string,

  // Which corrections to apply, in this fixed order: doubleDatedYear → osNsYear
  // → quakerMonth → julianToGregorianDay. Request only what was asked (§5b).
  corrections: {
    doubleDatedYear?: boolean,          // resolve year/doubleYear → the later year
    osNsYear?: boolean,                 // if month/day ∈ [Jan 1, Mar 24], year += 1
    quakerMonth?: { era: "pre_1752" | "post_1752" }, // interpret `month` as a Quaker ordinal
    julianToGregorianDay?: boolean,     // add the era-appropriate Julian→Gregorian offset
  },
})
```

`corrections` must request **at least one** correction. Each requested correction
is applied in the fixed order above (so an OS/NS year fix lands before the Quaker
month roll-over and the day offset operate on it). Omitted corrections are not
applied — the tool never "helpfully" bundles one the caller didn't ask for.

### 3.1 Return value

```typescript
{
  original: { year, month?, day?, doubleYear? },   // echoed input date
  converted: { year, month?, day? },               // after the requested corrections
  applied: Array<{                                  // one per correction actually applied
    correction: "doubleDatedYear" | "osNsYear" | "quakerMonth" | "julianToGregorianDay",
    rule: string,                                   // human-readable rule, for narration
    offsetDays?: number,                            // julianToGregorianDay only (10/11/12/13)
    monthShift?: number,                            // quakerMonth only
    yearAdjusted?: boolean,                          // osNsYear / doubleDatedYear
  }>,
  notes: string[],                                   // e.g. "day omitted; day offset not applied"
}
```

The skill narrates from `applied`/`notes` and keeps presenting the original
alongside the converted date (`SKILL.md:209–211`); the tool never persists
anything (§6).

---

## 4. The arithmetic (deterministic rules)

### 4.1 `doubleDatedYear`
Given `year` and `doubleYear`, the New-Style year is the **later** of the two:
the value formed by taking `year`'s leading digits and `doubleYear`'s trailing
digits, choosing the later year. E.g. `1750` + `1` →
`1751`; `1699` + `700` → `1700`. Sets `converted.year`; no day/month change.

**Precondition — the Jan 1 – Mar 24 window.** Double dating exists
only in that window. Where `month` is supplied and the date is provably outside
it (`month > 3`, or March with `day > 24`), the correction is an **input error**
rather than a bump: on 25 March the Old-Style year increments, so from that date
the two styles agree and there is nothing to resolve — bumping anyway moves the
event a year. `month` is optional on this correction, so a year-only input cannot
be tested and keeps the historical behaviour; a March date with no `day` is
noted, not refused.

### 4.2 `osNsYear`
If the (calendar) `month`/`day` falls on or after **January 1** and on or before
**March 24**, add 1 to `converted.year`; otherwise no change
(`SKILL.md:98–101, 198`). Requires `month` (and `day` when the date is in March,
to test the ≤24 boundary). The day and month are unchanged — this is the
year-start correction only.

### 4.3 `quakerMonth`
Interpret `date.month` as a Quaker ordinal (1–12) and map to a calendar month
(`SKILL.md:117–129`):
- **`post_1752`:** calendar month = ordinal (1st month = January).
- **`pre_1752`:** calendar month = `((ordinal + 1) % 12) + 1` shifted so 1st = March,
  …, 10th = December, **11th = January of `year + 1`**, **12th = February of
  `year + 1`** (the two roll into the next year). The tool sets
  `converted.month` and, for the 11th/12th cases, increments `converted.year`.

### 4.4 `julianToGregorianDay`
Add the era-appropriate offset to the Julian `year/month/day`, rolling month/year
over correctly (and respecting Julian leap years). The offset is a pure function
of the Julian date, keyed off the skipped-Julian-leap thresholds
(`SKILL.md:84–87`):

| Julian date range | Offset (days) |
|-------------------|---------------|
| 1582-10-15 … before 1700-03-01 (Julian) | 10 |
| 1700-03-01 … before 1800-03-01 (Julian) | 11 |
| 1800-03-01 … before 1900-03-01 (Julian) | 12 |
| 1900-03-01 … 2099 (Julian) | 13 |

(The boundary sits at the day after each skipped Julian Feb 29 — i.e. March 1
Julian of 1700/1800/1900.) Requires a full `year/month/day`; if `day` is absent
the tool **skips** this correction and adds a `notes` entry rather than guessing.
Output is the Gregorian `year/month/day`.

> **Implementation:** reuse `date-standardize.ts`/`date-helpers.ts` for the
> day-number representation rather than hand-rolling date math. The offset table
> and the OS/NS + Quaker rules transcribe directly from `convert-dates/SKILL.md`,
> which is the de-facto spec for the regime tables.

---

### 4.5 `jurisdiction` — the regime lookup

Added by lead ruling 2026-09-07, which moved the Gregorian adoption table out
of `convert-dates/SKILL.md` and into this tool.

**The wiki route was the alternative and lost on measurement.** Routing the
table to `Julian_and_Gregorian_Calendars` was the competing option under
ADR-0012; that page gives the Dutch provinces as a bare **year**, with no
month and no offset, which cannot decide a Gelderland date in Jan–Jun 1700 —
precisely the case the table exists for.

Each row is a list of **spans**, not a single adoption date, because three
rows are not plain adoptions:

| Row | Shape |
|---|---|
| Sweden | A **third** day-reckoning. 1 Mar 1700 – 30 Feb 1712 Sweden ran one day ahead of Julian and ten behind Gregorian; 30 Feb 1712 is a real date, inserted to revert to Julian. Julian again until 1753, Gregorian after. |
| Scotland | Year-start moved to 1 January in **1600**, day reckoning stayed Julian until the 1752 British correction. The two facts move independently. |
| Groningen | **Non-monotone**: Gregorian 1583–1594, reverted to Julian, adopted again with Friesland in 1701. |

A flat `jurisdiction → {date, offset}` map cannot hold any of the three.

**The offset is not in this table and never was.** §4.4 derives it by JDN
round-trip, which gets the 1700/1800/1900 thresholds right by construction.
What a jurisdiction adds is *which calendar was in force* and *where the civil
year began*.

Matching is case- and punctuation-insensitive over a canonical key plus
alternates (`Great Britain` → England, `Württemberg` → Protestant German
states). A jurisdiction is a **jurisdiction, not a town**: `Moscow` does not
match, `Russia` does. An unrecognized string is an **error** listing the
accepted keys (§7), never a silent fallback to "no regime" — `convert_calendar`
is in `OK_FALSE_IS_FAILURE`, so the error surfaces to the model as something to
fix, whereas a silent fallback would apply a correction under the wrong regime
and read as success.

---

## 5. What the tool owns vs. what the caller decides

| Owned by the tool (mechanical) | Decided by the caller (judgment) |
|--------------------------------|----------------------------------|
| The offset value for a Julian date; the ≤Mar-24 year bump; the Quaker month/year roll; double-date resolution; **and, when `jurisdiction` is supplied, the regime** — which calendar was in force, where the civil year began, and whether a requested correction applies at all (§4.5) | **Which** corrections to request; whether conversion is needed at all; the jurisdiction string itself (and the era, where no jurisdiction is passed) |

### 5b. Single-correction discipline
The `corrections` object is how the spec's "answer only the calendar question that
was asked" rule (`SKILL.md:220–229`) becomes structural: the caller passes exactly
the corrections the user asked for, and the tool applies exactly those. Asking for
the New-Style **year** of "15 February 1750/1" → `{ doubleDatedYear: true }` (or
`{ osNsYear: true }`) and nothing else; the day offset is not applied unprompted.

**The tool identifies the regime; the caller still names the question.**
`corrections` stays required. Full auto-selection — deriving the corrections
from jurisdiction and date alone — was considered and **rejected**: it
over-converts `ut_convert_dates_007` (a slash-notation question would also
receive an OS/NS year and a day shift, the over-conversion this section
forbids) and it forces a call on `ut_convert_dates_008`, whose validator fails
the run if `convert_calendar` is called at all. The reversal the ruling makes
is to the **regime**, not to the **question**.

The date matters here: this example previously read "25 March 1750/1", which §4.1's
window precondition now makes an input error under `doubleDatedYear` while §4.2
leaves it unchanged — the two corrections disagreed by a year on the one date used
to illustrate that they agree.

---

## 6. Non-goals / persistence

- **Writes nothing.** Like the skill it replaces, the tool is output-only — it
  returns the conversion; it does not touch `research.json` or `tree.gedcomx.json`
  (`SKILL.md:231–238`). Assertions keep the original record date; the conversion is
  interpretation shown to the user. (No project write layer, no validation pass.)
- **Identifies the regime when told the place — reversed 2026-09-07.** This
  section previously read "Does not identify the regime". With
  `jurisdiction` supplied the tool now says which calendar was in force, where
  the civil year began, and whether a requested correction applies (§4.5). With
  it omitted the old behaviour stands unchanged: the tool applies what was
  asked and infers nothing. What the tool still does **not** do is choose the
  question — see §5b.
- **No free-text date parsing as the primary path.** The caller passes structured
  `year/month/day`; a future convenience overload that accepts a raw string via
  `stdDate` is out of scope for v1.
- Not a network tool — pure arithmetic, no auth.

---

## 7. Errors / edge cases

| Condition | Behavior |
|-----------|----------|
| `corrections` requests nothing | input error (nothing to do) |
| `julianToGregorianDay` but `day` (or `month`) absent | skip that correction; add a `notes` entry ("day offset needs a full day-month-year date"); still apply the others |
| `osNsYear` but `month` absent | input error (cannot test the Jan 1–Mar 24 window) |
| `quakerMonth.era` missing/invalid | input error (the shift is era-dependent) |
| `date.month` outside 1–12 / `day` outside 1–31 | input error |
| `julianToGregorianDay` on a Julian date before 1582-10-15 | **input error** — the Gregorian calendar did not exist before its introduction, so there is no meaningful day offset to apply (the other corrections, if requested, are unaffected) |
| `quakerMonth.era` not exactly `pre_1752` / `post_1752` | input error (the shift is era-dependent; the exported function is called outside the MCP enum guard) |
| `doubleYear` given but inconsistent with `year + 1` | input error (a real double date always spans consecutive years) |
| `jurisdiction` supplied but not a known key | **input error** listing the accepted keys, noting that matching ignores case and punctuation and that a town is not a jurisdiction. Never a silent fallback — §4.5 |
| `jurisdiction` supplied as an empty or whitespace-only string | input error (an empty string is a caller bug, not "no jurisdiction"; omit the field instead) |
| `julianToGregorianDay` requested where the regime says the date is already Gregorian | **not an error**: the correction is declined, `applied` omits it, `converted` equals the input, and `notes` says why |
| `osNsYear` requested where the regime's civil year already began 1 January | **not an error**: declined the same way, with the year that place moved named in `notes` |
| `doubleDatedYear` on a date provably outside Jan 1 – Mar 24 (`month > 3`, or March with `day > 24`) | **input error** — under the **English Lady Day convention** (England, Wales, Ireland and the colonies; also Florence and Pisa) the legal year began 25 March, so from that date the Old-Style and New-Style years agree and a slash has nothing to disambiguate. **Scope note:** other year-start conventions existed — Venice 1 March, the Byzantine and pre-1700 Russian 1 September, the French *mos gallicanus* Easter start — under which a slashed year outside Jan–Mar can be legitimate. Nothing in the corpus exercises those, so the guard is deliberately scoped to the Lady Day convention; widening it is a scope decision, not a bug fix |

---

## 8. Test plan (vitest)

- **Double date** — `{1750, doubleYear:1}` + `doubleDatedYear` → `1751`.
- **OS/NS year** — `15 Feb 1720` + `osNsYear` → `1721`; `15 June 1720` → unchanged.
- **OS/NS boundary** — `24 Mar 1720` → bumped; `25 Mar 1720` → unchanged.
- **Quaker pre-1752** — `{month:1}` (1st) `pre_1752` → March; `{month:11}` → January of `year+1`.
- **Quaker post-1752** — `{month:1}` `post_1752` → January.
- **Day offset by era** — a 1690 Julian date → +10; 1750 → +11; 1850 → +12; 1950 → +13; check month/year rollover at e.g. `1752-09-02` Julian → `1752-09-13`.
- **Single-correction discipline** — requesting only `doubleDatedYear` on `15 Feb 1750/1` does NOT change the day or apply the offset.
- **Double-date window** — `25 Mar 1750/1` + `doubleDatedYear` is an input error; `24 Mar` is bumped; `month > 3` is refused; a March date with no `day` is noted and still bumped; a year-only `{1750, doubleYear:1}` still resolves.
- **Combined** — OS/NS year then day offset on one call, applied in order, both reflected in `applied`.
- **Missing day** — `julianToGregorianDay` with no `day` skips the offset and notes it; other requested corrections still apply.
- **Purity / idempotence** — same input → same output; input object not mutated.
- **Jurisdiction, row per adoption (§4.5)** — for each row, the last Old Style
  date still converts and the first New Style date is declined with a note.
  `Catholic Europe` is tested separately: its last Old Style date is 4 Oct 1582,
  the day before the Gregorian calendar existed anywhere, so §7's pre-1582 rule
  refuses it and that refusal is the correct answer.
- **Jurisdiction, the three irregular rows** — Sweden `30 Feb 1712` → `11 Mar
  1712`, and plain Julian again after the revert; Scotland takes the day offset
  in 1730 but declines `osNsYear` (year start moved 1600) where England accepts
  it; Groningen declines inside 1583–1594 and converts again in 1600.
- **Jurisdiction matching** — case, padding and punctuation ignored; alternates
  accepted; an unknown key is an error naming the accepted keys; an empty string
  is an error; **omitting `jurisdiction` reproduces the earlier behaviour
  exactly**, including emitting no regime note.

---

## 9. Consumers

- **`eval/harness/validators/test_convert_dates.py`** — `test_day_offset_calls_name_a_jurisdiction`
  asserts that a `julianToGregorianDay` call carries a `jurisdiction`. Gated on
  the correction rather than on the `requires-tool-conversion` tag, because
  `ut_convert_dates_001` carries that tag and names no place at all ("3rd day of
  2nd month 1845") — a tag-gated check would fail it for a jurisdiction that does
  not exist. Nothing else can see this: vitest proves the tool HONOURS a
  jurisdiction, only a run log shows whether the model PASSED one.
- `convert-dates` skill — replaces the in-context arithmetic; SKILL.md becomes
  "identify the regime, call `convert_calendar` with the requested corrections,
  present original + converted." Its regime tables stay as reference for the
  identification judgment.
- `conflict-resolution` — calls `convert_calendar` (or reads `applied[].offsetDays`)
  to get the **expected** offset between two jurisdictions, so a date difference
  that matches the calendar offset is correctly classified as an artifact, not a
  conflict (`SKILL.md:31–36`).

---

## 10. Wiring

Standard MCP tool: implementation in `src/tools/convert-calendar.ts`, schema added
to `allToolSchemas` in `src/tool-schemas.ts`, dispatch in `src/index.ts`, name in
`manifest.json`'s `tools` array (the packaging drift test enforces parity).
camelCase at the boundary; no persisted output so no snake_case rename applies.
