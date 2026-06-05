# Deep-Dive Brief — `convert-dates`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Calendar-regime knowledge is the substance (genealogical). New tests are pure prompt→judge — but resolve the implementation bug below before adding any.
**Files:** SKILL.md (254 lines) · references ×2 (186 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
Mechanically converts dates recorded under pre-modern calendar systems to a modern Gregorian equivalent: Julian→Gregorian day-shift (offset varies by jurisdiction/era — 10 days in 1582 Catholic Europe, 11 in 1752 England, 13 in 1918 Russia), Old Style/New Style year-start correction (English legal year began 25 March pre-1752), and Quaker numbered-month dates. It presents both original and converted forms to the user with dual-dating notation.

## ⚠️ Known issues — FIX BEFORE ADDING TESTS
This skill has real implementation drift, not just thin coverage:
- **`convert_calendar` MCP tool does not exist.** SKILL.md tells the model to call `convert_calendar({date, fromSystem, jurisdiction, toSystem})`, but the only tool in `allowed-tools` is `validate_research_schema`, and no such tool is in the MCP server. The skill either hallucinates the call or silently does the arithmetic in-context. **Decide which is intended** (almost certainly: do the arithmetic in-context, and remove the bogus tool call) and fix the SKILL.md.
- **Undocumented schema fields.** The re-invocation section writes `date_normalized`, `date_julian`, `date_gregorian`, `date_conversion_notes` onto assertions. If these aren't in `research.schema.json`, the post-write `validate_research_schema` call fails (or `additionalProperties:false` rejects them). Verify against `docs/specs/schemas/research.schema.json` before relying on them.
- **Doc inconsistency:** `validation-protocol.md` says invoke `check-warnings` too; SKILL.md only names `validate_research_schema`.

> Note the contradiction to resolve: the description says convert-dates "does not modify project files (dates remain freeform strings)", yet the re-invocation section describes writing normalized date fields. Settle whether this skill writes at all.

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
Resolve the `convert_calendar` / write-behavior questions **first** → fix SKILL.md → add the 6 jurisdiction/edge positive tests + 3 negatives → full harness pass + CRUD review + PR.
