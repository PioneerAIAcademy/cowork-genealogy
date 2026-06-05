# Deep-Dive Brief — `convert-dates`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Calendar-regime knowledge is the substance (genealogical). New tests are pure prompt→judge — the skill is output-only (no tools, no file writes).
**Files:** SKILL.md (254 lines) · references ×2 (186 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
Mechanically converts dates recorded under pre-modern calendar systems to a modern Gregorian equivalent: Julian→Gregorian day-shift (offset varies by jurisdiction/era — 10 days in 1582 Catholic Europe, 11 in 1752 England, 13 in 1918 Russia), Old Style/New Style year-start correction (English legal year began 25 March pre-1752), and Quaker numbered-month dates. It presents both original and converted forms to the user with dual-dating notation.

## ✅ Resolved before the event (2026-06-05)
The implementation drift this brief originally flagged is already fixed —
`convert-dates` is now coherently **output-only**. No action needed here;
go straight to the gaps below. What changed:
- The phantom `convert_calendar` call is gone; SKILL.md now does the
  conversion in context (the tool is specced but not yet implemented).
- The "Update assertions" step, the "Validate after writing" rule, and
  the re-invocation block's invalid `date_*` fields (which aren't in the
  `additionalProperties:false` assertion schema, so they'd fail
  validation) are removed — the skill no longer writes to `research.json`.
  An assertion's `date` keeps the original record value; the conversion
  is shown to the user.
- The unused `allowed-tools: validate_research_schema` and the dead
  `references/validation-protocol.md` are removed.

## Where everything lives
- `plugin/skills/convert-dates/SKILL.md`
- `references/calendar-conflicts.md` (172 lines), `references/validation-protocol.md` (14 lines)
- `eval/tests/unit/convert-dates/` — `quaker-date-conversion.json`, `julian-gregorian-1750.json`, `negative-historical-context.json`, `rubric.md`

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_convert_dates_001 | Quaker numbered month (post-1752 shift), 1845 date, preserves original notation | positive |
| ut_convert_dates_002 | Pre-1752 English `1749/50` dual-dating, 11-day offset | positive |
| ut_convert_dates_003 | "Why did Quakers use numbered months?" → routes to `historical-context` | negative |

## Gaps — new tests to add
**Positive (jurisdictions/edge cases untested):**
- **Catholic Europe 1582** — 10-day shift on a Spanish/Italian date around Oct 4–15, 1582.
- **Russia 1918** — 13-day shift (e.g. 1 Feb 1918 Julian → 14 Feb).
- **Scotland 1600–1752 hybrid** — year-start already Jan 1 (no year correction) but Julian days kept (day shift still applies) — distinct logic path from England.
- **Slash-notation, no arithmetic** — user supplies `25 March 1750/1`; just extract the New Style year and explain.
- **No conversion needed** — a clearly post-transition Gregorian date; skill should say "no conversion needed", not silently apply one.
- **Protestant German states 1700** — 10-day shift, the gap between 1582 and 1752.

**Negative (boundaries):**
- → *no skill* (plain reformatting): "Reformat '15-Feb-1821' to 'February 15, 1821'."
- → `conflict-resolution`: "Death listed June 3 vs June 8, same English county 1865 — which is right?" (5-day gap ≠ any offset).
- → `validate-schema`: "Is '15 Feb 1749/50' a valid date field in research.json?"

## Fixture work
All gap tests are prompt→judge (no fixtures) **unless** you decide the skill writes assertion fields — then a scenario with a target assertion is needed for write-verification. The no-conversion case needs none.

## Definition of done
Add the 6 jurisdiction/edge positive tests + the 3 negatives → full harness pass + CRUD review + PR. (The SKILL.md implementation drift was already fixed — see the Resolved note above.)
