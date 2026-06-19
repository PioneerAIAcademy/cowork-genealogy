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
(`SKILL.md:31–36`, `convert-dates/references/calendar-conflicts.md`) — a
miscomputed offset silently suppresses a real conflict or fabricates a fake one.

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
digits, choosing the later year (`SKILL.md:107–110, 202`). E.g. `1750` + `1` →
`1751`; `1699` + `700` → `1700`. Sets `converted.year`; no day/month change.

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

## 5. What the tool owns vs. what the caller decides

| Owned by the tool (mechanical) | Decided by the caller (judgment) |
|--------------------------------|----------------------------------|
| The offset value for a Julian date; the ≤Mar-24 year bump; the Quaker month/year roll; double-date resolution | The jurisdiction and era; whether the source date is Julian vs. Gregorian; whether conversion is needed at all; **which** corrections to request |

### 5b. Single-correction discipline
The `corrections` object is how the spec's "answer only the calendar question that
was asked" rule (`SKILL.md:220–229`) becomes structural: the caller passes exactly
the corrections the user asked for, and the tool applies exactly those. Asking for
the New-Style **year** of "25 March 1750/1" → `{ doubleDatedYear: true }` (or
`{ osNsYear: true }`) and nothing else; the day offset is not applied unprompted.

---

## 6. Non-goals / persistence

- **Writes nothing.** Like the skill it replaces, the tool is output-only — it
  returns the conversion; it does not touch `research.json` or `tree.gedcomx.json`
  (`SKILL.md:231–238`). Assertions keep the original record date; the conversion is
  interpretation shown to the user. (No project write layer, no validation pass.)
- **Does not identify the regime.** It will not infer jurisdiction or guess whether
  a date is Julian — that is the caller's judgment and the source of the "flag the
  ambiguity rather than guess" rule (`SKILL.md:162–163`).
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
| Julian date before the jurisdiction's Gregorian-era table start (pre-1582) | apply the 10-day offset and note that pre-1582 Julian/Gregorian coincided (no offset) — or input error; pick one and document (recommend: note + 10-day floor) |

---

## 8. Test plan (vitest)

- **Double date** — `{1750, doubleYear:1}` + `doubleDatedYear` → `1751`.
- **OS/NS year** — `15 Feb 1720` + `osNsYear` → `1721`; `15 June 1720` → unchanged.
- **OS/NS boundary** — `24 Mar 1720` → bumped; `25 Mar 1720` → unchanged.
- **Quaker pre-1752** — `{month:1}` (1st) `pre_1752` → March; `{month:11}` → January of `year+1`.
- **Quaker post-1752** — `{month:1}` `post_1752` → January.
- **Day offset by era** — a 1690 Julian date → +10; 1750 → +11; 1850 → +12; 1950 → +13; check month/year rollover at e.g. `1752-09-02` Julian → `1752-09-13`.
- **Single-correction discipline** — requesting only `doubleDatedYear` on `25 Mar 1750/1` does NOT change the day or apply the offset.
- **Combined** — OS/NS year then day offset on one call, applied in order, both reflected in `applied`.
- **Missing day** — `julianToGregorianDay` with no `day` skips the offset and notes it; other requested corrections still apply.
- **Purity / idempotence** — same input → same output; input object not mutated.

---

## 9. Consumers

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
