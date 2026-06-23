# Shorten: historical-context

**Bucket:** B (craft compression)
**Primary owner:** genealogist (developer assists with structure)
**Current size:** 238 lines → **Target:** ~175–195 lines (~20% reduction)
**Tool migration:** n/a (no new tool). **Reads via** `wiki_search`, `wiki_read`, `wikipedia_search`, `place_search`, `place_search_all`, `place_population`. **Writes nothing** (read-only narrative skill; `test_does_not_modify_research_json` + the universal ownership table both enforce it).
**Still needed as a skill?** yes — translating historical background (boundary changes, naming conventions, migration patterns, period legal/relationship vocabulary, record-availability-by-era) into research-actionable implications is the narrative judgment the rubric grades. The tools fetch context; the "how this affects YOUR research" framing is the skill's.

## TL;DR
This skill is already moderately lean and delegates detail to three reference docs. The compression is in **deduplicated routing** (the same four redirects appear in the top Routing-check table AND the Decision-rules table AND Step 2's bullet list), **deduplicated tool documentation**, and one of the **two long worked examples** (both teach the same "context → implication" move). The narrative craft — connect-context-to-action, present-multiple-possibilities, distinguish-from-locality-guide/conflict-resolution, the tool-vs-training-knowledge honesty rule — must survive; the redirects are negative-test-pinned and must survive (once).

## Why this skill is shortenable
The routing/redirect rules are stated three times:
- **"Routing check — do this FIRST" table (35–47)**: records-exist→locality-guide, search→search-records, translate→translation, convert-date→convert-dates.
- **Step 2 bullets (84–96)**: re-list the same "where would records be → redirect to locality-guide," "why conflict → discrepancy context then conflict-resolution," etc.
- **Decision rules table (177–187)**: records-exist→locality-guide, formally-resolve→conflict-resolution, convert-date→convert-dates, translate→translation, foreign-term→translation.

Tools are documented twice: the `allowed-tools` frontmatter (15–21) + the "MCP tools used" table (66–70) + inline Step-3 examples (102–108).

The two worked examples (135–173) — the Patrick birthplace-discrepancy and the Thomas Olds station-master example — both demonstrate the identical "explain the historical reason, then state the research implication" pattern.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_historical_context.py` + universal):
  - `test_does_not_modify_research_json` — read-only (positive tests; `before == after`).
  - Universal: `test_ownership_table` (owns no section → any write fails), `test_tool_allowlist` (the six read tools), schema validation.
- **Rubric dims** (`eval/tests/unit/historical-context/rubric.md`): Relevance to research, Source quality, Genealogical implications — all narrative, all judge-graded.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests (5):** `negative-redirect-locality-guide` (records-exist question → locality-guide, NO tool calls), `negative-redirect-translation`, `negative-redirect-convert-dates`, `negative-redirect-search-records`, plus the search-wikipedia boundary. These pin the Routing-check block hard.
- **Key test files:** `west-virginia-boundary-change.json`, `england-civil-registration-1837.json`, `norwegian-patronymic-naming.json`, `pennsylvania-coal-1850s.json`, `irish-famine-migration.json`, `legal-terms-in-will.json`, `connect-context-to-research.json` (the "translate context into action" craft), and the five negatives.

## CUT — safe to remove (redundancy / over-explanation)
- **[lines 66–70] "MCP tools used" table** — duplicates the frontmatter `allowed-tools` list + the inline Step-3 examples. Cut; keep the inline examples (they carry argument shape) and the frontmatter.
- **One of the two worked examples (135–173)** — both teach the same context→implication move. Keep ONE (the Patrick birthplace-discrepancy example, 137–153, also reinforces the informant-weighting craft that overlaps conflict-resolution boundary); cut the Thomas Olds station-master example, OR keep only its unique cue ("'in-law' often meant step-relationship") as a one-liner in the terminology bullet.
- **[lines 229–238] "Re-invocation behavior"** — boilerplate ("writes nothing, safe to repeat, no duplication"). Already in the description and the "Output only — no file writes" rule. One line at most.
- **Step 2 redirect bullets that duplicate the Routing-check table (the "where would records be → locality-guide," "why conflict → conflict-resolution" sub-bullets, 86–96)** — the Routing-check table (35–47) is the authoritative redirect home and is what the negative tests map to. Keep Step 2's *interpretation* taxonomy ("why does record say X → interpretation; what does term mean → vocabulary") but strip the redirect restatements that the table already owns.
- **Decision-rules rows that restate the Routing-check table** (records-exist, convert-date, translate, foreign-term, formally-resolve) — keep these as routing in ONE place. The Decision-rules table also has unique craft rows (place-discrepancy → check boundary first; date-discrepancy of 10-13 days → calendar difference; absence-of-records → historical reason; multiple-explanations → order by likelihood) — keep those. Cut only the rows duplicating the top table.

## KEEP — load-bearing craft (do NOT cut)
- **The Routing-check table (35–47) + the "redirect, no tool calls, no file reads, stop" instruction (46)** — protects all five negative tests, especially `negative-redirect-locality-guide`'s "Should not call any tools" criterion. Keep verbatim; this is the single authoritative redirect home.
- **Step 2 interpretation taxonomy (82–96)** — the "why does record say X → interpretation / what does term mean → vocabulary / why can't I find person → migration-occupation-name-changes" mapping is the craft that drives Relevance-to-research. Keep (minus the redirect restatements).
- **Step 3 BCG-standard-41 broad-sources guidance + `place_population`-when-community-size-matters + `place_search_all`-for-changed-boundaries (98–127)** — protects Source quality + Tool Arguments. Keep.
- **The one kept worked example** — protects Genealogical implications (the "Implication: …" close is the graded move). Keep.
- **Important rules: connect-context-to-action, consider-full-range-of-factors, interpret-terms-in-historical-context, use-occupational/geographic-networks, cite-sources-and-distinguish-tool-vs-training-knowledge, don't-speculate-beyond-evidence (189–227)** — these map directly onto all three rubric dims. The tool-vs-training-knowledge honesty rule (209–217) is the Source-quality pass criterion ("don't present training-knowledge in the same register as tool-verified facts") — keep it whole. Keep the distinguish-from-locality-guide and distinguish-from-conflict-resolution bullets (221–227) — they reinforce the boundaries the negatives test.
- **The three reference-doc pointers + "do NOT duplicate their content" (50–62)** — keep as load-on-demand pointers; the detailed terminology/boundary/broad-context lives there.

## TIGHTEN — keep the point, cut the words
- Make the **Routing-check table the single redirect home**; strip redirect duplication from Step 2 and the Decision-rules table.
- Delete the "MCP tools used" table; keep frontmatter + inline examples.
- Keep ONE worked example; fold the other's unique cue into the terminology bullet.
- Cut Re-invocation to one line.
- Trim reference-doc pointer descriptions to filename + load-trigger phrase.

## JUDGMENT CALLS (genealogist decides)
- **Which worked example to keep.** Both teach context→implication; the Patrick one also models informant-weighting (the conflict-resolution boundary), the Thomas Olds one models occupational/geographic networks (a named Important-rule). A genealogist decides which better protects Genealogical implications, or whether both earn their lines for the breadth they show.
- **How much of Step 2's taxonomy survives after stripping redirects.** The interpretation/vocabulary/search-strategy/discrepancy taxonomy partly drives Relevance-to-research framing; over-trimming could flatten the "tie context to the specific question" behavior. Genealogist sets the floor.
- **Whether the Decision-rules craft rows (boundary-first, 10-13-day calendar hint, absence-of-records) are fully covered by `references/boundary-and-calendar-changes.md`** (179 lines) and could become pointers. I treat them as keep (they're quick-reference craft); a genealogist may judge them safely demotable to the reference.

## Suggested target structure (~185 lines)
1. Frontmatter + Narration + Places pointer.
2. Purpose (records created in specific contexts; misreading context misreads records).
3. **Routing-check table** (the single redirect home, "no tool calls, stop").
4. Reference-doc pointers (trimmed) + "don't duplicate their content."
5. Steps: 1 load references → 2 identify context question (interpretation taxonomy, redirects removed) → 3 research the context (BCG-41 broad sources, place tools) → 4 present (one worked example with the "Implication:" close).
6. Decision rules (craft rows only; routing rows that duplicate the table removed).
7. Important rules (connect-to-action, multiple-possibilities, historical-term meaning, networks, tool-vs-training honesty, no-speculation, distinguish-from-locality-guide/conflict-resolution).
8. One-line Re-invocation note.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill historical-context
```
Watch: all five negatives must still redirect with NO tool calls (especially `negative-redirect-locality-guide`); Relevance-to-research + Genealogical implications stay green on `connect-context-to-research`, `west-virginia-boundary-change`, `irish-famine-migration`; Source quality stays green (the tool-vs-training-knowledge rule intact); `test_does_not_modify_research_json` green.

## Owner notes
Genealogist-led because the keep-list (the interpretation taxonomy, the connect-to-action move, the tool-vs-training honesty rule, the worked-example "Implication:" close) is the graded narrative craft, and choosing which example/taxonomy survives is a craft call. A **developer can safely** delete the "MCP tools used" table, cut the Re-invocation boilerplate, strip the redirect restatements from Step 2 and the Decision-rules table (leaving the Routing-check table as the one home), and trim reference-doc pointer descriptions. A developer should **not** decide which worked example to keep or demote the Decision-rules craft rows.
