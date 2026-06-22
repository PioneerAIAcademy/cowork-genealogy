# Shorten: convert-dates

**Bucket:** A (dead-mechanics removal)
**Primary owner:** both (developer dedupes the tables; genealogist confirms the
regime-identification judgment stays intact)
**Current size:** 299 lines → **Target:** ~120–140 lines (~55% reduction)
**Tool migration:** done — calls `convert_calendar` (arithmetic only; writes
nothing).
**Still needed as a skill?** **Yes** — deciding *which* corrections apply (the
regime: jurisdiction, era, calendar in force) is LLM judgment the tool does
not do. But the file is ~2.5× longer than it needs to be.

## TL;DR
The arithmetic moved into `convert_calendar`. The skill's only remaining job is
regime identification + "answer only the correction that was asked" +
presentation. The regime facts are currently stated **four times** (description,
the big tables, Steps, Common traps, Important rules). Keep one authoritative
copy (the tables, as identification reference) and delete the restatements.

## Why this skill is shortenable
`convert_calendar` does Julian↔Gregorian day offsets, OS/NS year correction,
double-date resolution, and Quaker month mapping — in a fixed order, applying
only the corrections you pass. So every "here's how to do the arithmetic"
passage is dead; the skill only needs "here's how to recognize which regime
applies, and request exactly those corrections."

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_convert_dates.py`):
  - `test_only_convert_calendar_called` — positive tests may call only
    `convert_calendar` (no other MCP tool). *(Note: current corpus uses
    `scenario: null` — no research.json to diff, so there are no state-shape
    asserts. This skill writes nothing.)*
- **Rubric dims** (`eval/tests/unit/convert-dates/rubric.md`): Conversion
  accuracy, Ambiguity handling, Genealogical presentation — all *craft* (read
  the narrative), all judge-graded.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** route same-calendar disagreements →
  conflict-resolution; route "why did this convention exist" →
  historical-context; route schema questions → validate-schema. These
  boundaries are in the description and the two "When to use this skill
  vs ..." sections.

## CUT — safe to remove
- **[~215–248] the worked "25 March 1750/1" example** (full `convert_calendar`
  request + return + rendered output) — duplicates the tool schema's return
  shape. Keep at most a 3-line "present original next to converted" snippet.
- **[~250–260] "Common traps" table** — every row restates a fact already in
  the regime tables (OS/NS year, Quaker shift, Russian Julian, double-date "use
  later year"). The *one* trap worth keeping is "don't flag a calendar offset
  as a conflict," and that's already in "When to use this skill vs
  conflict-resolution." Cut the table.
- **[~161–204] "Steps" 1–3** — these re-narrate the table contents as a
  procedure ("Old Style → New Style year: pass `osNsYear:true`"). Collapse to a
  short mapping list: *correction → when it applies → the `corrections` key*.
- **[~288–299] "Re-invocation behavior"** — boilerplate (output-only,
  idempotent). One line at most.
- **[~113–117, ~137–141] the offset-growth explanation prose** repeated below
  the tables — the table's "Notes" column already carries it.

## KEEP — load-bearing judgment
- **The regime tables** (Julian/Gregorian by jurisdiction; OS/NS; Quaker
  numbered months; transition cutoffs) — this is the *identification
  reference* the LLM uses to decide which corrections apply. Keep as the single
  source. (Conversion accuracy rubric dim depends on getting the regime right.)
- **"Answer only the calendar question that was asked"** (Important rules) —
  load-bearing for the Ambiguity-handling / over-conversion grading. The tool
  enforces "no bundled corrections" structurally, but the judge still grades
  whether Claude *requested* only what was asked. Keep, state once.
- **"Don't silently convert — show original next to converted"** (Genealogical
  presentation dim). Keep.
- **"When in doubt, don't convert / flag the ambiguity"** (Ambiguity
  handling). Keep.
- **The two routing sections** (vs conflict-resolution, vs historical-context)
  — boundary behavior; keep, tighten.
- **The `{ ok:false, errors }` handling** — one line: surface the error and
  the missing input rather than falling back to hand arithmetic.

## TIGHTEN
- Merge "Steps" into the table section: after each table, one line on the
  matching `corrections` key. No separate procedure.
- State "narrate from `applied[].rule` / `notes[]` / `converted`" once.

## Suggested target structure (~130 lines)
1. Frontmatter + Narration.
2. 3-sentence purpose (calendars varied by jurisdiction; wrong regime → wrong
   *year*).
3. Routing: vs conflict-resolution, vs historical-context (tight).
4. How to call `convert_calendar` (the `corrections` keys + the one
   `{ ok:false }` line).
5. **Regime tables** (the kept reference) with the matching `corrections` key
   per row.
6. Rules: answer only what's asked; show original next to converted; when in
   doubt, flag don't guess.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill convert-dates
```
Confirm Conversion accuracy stays green across the regime cases and the
boundary prompts still route out.

## Owner notes
**Developer** dedupes the tables/Steps/traps and cuts the worked example.
**Genealogist** confirms the regime tables remain complete and the
"answer-only-what's-asked" + "don't-silently-convert" rules survive — those are
the graded craft.
