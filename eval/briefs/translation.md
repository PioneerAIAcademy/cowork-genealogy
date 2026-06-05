# Deep-Dive Brief — `translation`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Almost all the work is genealogical judgment — translation accuracy and annotation. Test mechanics are minimal: the skill calls no MCP tools and writes no files, so new tests are pure prompt→judge.
**Files:** SKILL.md (191 lines) · references ×2 (253 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
Helps a genealogist read and translate historical records in non-English Western European languages (German, French, Spanish, Italian, Dutch, Latin, Portuguese), including period handwriting (Kurrentschrift, Sütterlin) and Latin parish-register abbreviations. It transcribes the original exactly, translates with genealogically precise annotations (expands abbreviations, names godparents/witnesses, preserves proper names, flags uncertain readings with `[?]`), and outputs to the user only — it never writes project files.

## Where everything lives
- `plugin/skills/translation/SKILL.md`
- `plugin/skills/translation/references/gps-translation-standards.md` (142 lines)
- `plugin/skills/translation/references/vocabulary-and-record-structures.md` (111 lines)
- `eval/tests/unit/translation/` — `german-kurrent-baptism.json`, `latin-marriage-record.json`, `negative-search-wikipedia.json`, `rubric.md`

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_translation_001 | German baptism: `ehelicher Sohn`, `Bergmann`, `Taufpaten`; flags Irish names in a German parish | positive |
| ut_translation_002 | Latin marriage: `matrimonium iniverunt`, `filius/filia`; flags Latinized given names; two-generation parentage | positive |
| ut_translation_003 | Explicit "look up Kirchenbuch on Wikipedia" → routes to `search-wikipedia` | negative |

## Gaps — new tests to add
**Positive (domain coverage is thin — only German + Latin tested):**
- **French civil registration (post-1792)** — an *acte de naissance* with the declarant/officier formula and a Republican-calendar month (Vendémiaire/Thermidor).
- **Spanish colonial baptism** — ecclesiastical Spanish with casta terms (español/mestizo) and abbreviations (`dho.`, `N.L.`).
- **Mixed Latin/German Lutheran register** — formula in Latin, names/occupations in German mid-entry.
- **Damaged/uncertain text** — a partially illegible passage that forces `[?]` annotation (directly exercises the "Notation of uncertainty" rubric dimension, currently untested).
- **Latin genitive name normalization** — names in genitive case (`Johannis` → `Johannes`) that must be normalized, not silently altered.

**Negative (boundaries from the description):**
- → `record-extraction`: "Pull the facts out of this 1850 English census entry and add them to the project."
- → `historical-context`: "Why did the German priest in 1845 Pennsylvania keep records in German?"
- → `locality-guide`: "What records exist for Bavaria in the 1700s and where are they held?"

## SKILL / reference work
- **Vocabulary reference covers only 4 of 7 advertised languages** — Dutch, Italian, Portuguese have zero vocab/abbreviation/structure entries. Add at least Italian and Dutch record-structure templates.
- **No worked output example** in SKILL.md (the reference skill `search-wikipedia` has one) — add a transcription→translation→annotations sample so the output format isn't implicit.
- **Trigger gaps** — description omits "Sütterlin", "old German script", "can't read this document"; may under-fire on handwriting-primary requests.
- **Rubric** has no "Preservation of original text" or "Name handling" dimension despite both being core GPS requirements the SKILL.md stresses.

## Fixture work
**None for the positive gaps** — translation calls no MCP tools; all new tests are prompt→judge. The only fixtures involved are for *negative* tests where the correct neighbor calls a tool (the existing `wikipedia-search-kirchenbuch` is the model). Lowest-fixture-cost skill in the batch.

## Definition of done
Fix trigger/reference gaps → add ≥3 positive tests across new languages + the uncertainty case → add the 3 neighbor negatives → extend the rubric → full harness pass + CRUD review + PR.
