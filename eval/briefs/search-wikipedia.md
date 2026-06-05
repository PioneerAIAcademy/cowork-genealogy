# Deep-Dive Brief — `search-wikipedia`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Mostly mechanics (slug rules, template, file save). This is the canonical reference skill and already the best-covered in the batch — the deep-dive value is polishing the reference pattern others copy, not big coverage wins.
**Files:** SKILL.md (69 lines) · template ×1 (6 lines) · tests ×8 (most in the batch) · rubric ✗ (**missing**).

## What this skill does
Looks up a topic (person, place, event, or concept) on **general Wikipedia** via the single `wikipedia_search` MCP tool, fills the 3-field `wiki-summary.md` template, derives a slug from the article title, and saves `<slug>.md` to the working folder. It is also **the intentionally-minimal reference pattern every other skill is copied from** — the simplest valid MCP-tool → template → file-save pipeline. Improvements here propagate by example.

## Where everything lives
- `plugin/skills/search-wikipedia/SKILL.md`
- `plugin/skills/search-wikipedia/templates/wiki-summary.md` (6 lines: `{{title}}`, `{{extract}}`, `{{url}}`)
- `eval/tests/unit/search-wikipedia/` — 8 test JSONs (below) — **no rubric.md**

## Current tests (8) — already strong
| id | covers | type |
|----|--------|------|
| ut_…_001 | Place lookup (Schuylkill County); comma-space slug | positive |
| ut_…_002 | Person lookup (Einstein); two-word slug | positive |
| ut_…_003 | Event lookup (Great Famine); parenthesized-title slug | positive |
| ut_…_004 | Slug regression: `O'Brien (surname)` → `o-brien-surname` | positive |
| ut_…_005 | Abstract topic (U.S. census); flexible query derivation | positive |
| ut_…_006 | "FamilySearch wiki…" → `search-wiki` | negative |
| ut_…_007 | "What records exist and where" → `locality-guide` | negative |
| ut_…_008 | Off-topic (Python CSV) → no skill fires (coercion resistance) | negative |

> Honest assessment: coverage of this skill's scope is the **best in the batch**. All four topic shapes, both documented slug edge cases, and 2 of 3 named negatives are covered. Don't manufacture duplicate tests — focus this team on the few real gaps and on polishing the reference so good patterns propagate.

## Gaps — new tests to add (real but low-priority)
- **Missing negative: `historical-context`** — the only named "do NOT use" boundary with no test: "Tell me about Irish→US migration patterns in the 1840s" / "How did PA county boundaries change 1800–1850?" → should route to `historical-context`, not a Wikipedia lookup. **Add this.**
- **Empty extract / article-not-found** — `wikipedia_search` returns `extract: ""`/`null`; the skill has no handling instruction. (needs a net-new fixture)
- **Disambiguation page** — returned article is itself a disambiguation list; no guidance today. (needs a net-new fixture)
- **Diacritic / non-ASCII title slug** — e.g. "Württemberg", "Québec"; the slug rule is silent on whether `ü` is preserved or hyphenated. (common in European genealogy)
- **Redirect** — query differs sharply from returned title (slug derives from the *title*, not the query) — implicitly touched by ut_003 but never with a dramatic query↔title gap.

## ⚠️ Reference-quality items (high leverage — others copy this)
- **No `rubric.md`** — as the reference, it should *model* a minimal 2–3 dimension rubric for contributors to copy. Authoring one here pays off across every skill.
- **Empty `judge_context` on ut_002/003/004** — populate one meaningful cue each so authors see the pattern.
- **Slug rule silent on diacritics/non-ASCII** — clarify; the ambiguity propagates to every skill that copies it.
- **"Refresh in place" rule** doesn't address two different queries that slug to the same filename (silent overwrite). One-line clarification.
- **Template has no metadata line** (no date/query/skill attribution) — make a deliberate decision since it's the template others inherit.

## Fixture work
All 6 referenced fixtures exist and follow the standard format. Net-new only for the gap tests: `wikipedia-search-empty-extract.json`, `wikipedia-search-disambiguation.json`, and a diacritic-title fixture. The historical-context negative needs **no** fixture.

## Definition of done
Author the model `rubric.md` + populate thin `judge_context` → add the historical-context negative → add the empty-extract + disambiguation + diacritic tests with their fixtures → clarify the slug-rule diacritic case (it propagates) → full harness pass + CRUD review + PR.
