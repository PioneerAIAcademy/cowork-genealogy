# Deep dive: historical-context — findings and validator requests

Issue #1663. Guide followed: `docs/skill-deep-dive-guide.md`.

**Corpus read:** `eval/runlogs/unit/historical-context/v1_2026-08-20_11-21-15.json`
(the pre-PR baseline) and `v1_2026-08-24_21-38-52.json` (this PR's final, active run
log, which adds `ut_historical_context_014`). Transcripts read before scores.
Prohibition list: `historical-context-prohibition-list.md`.

**Starting numbers, corrected:** the issue's own numbers were stale before this dive
started — it said 12 tests and "1 of 6 dimensions never discriminate." Two tests and
one rubric dimension (Citation completeness) were added by the separate issue #1315
citation fix before this dive began. Current reality, after this PR's own new test:
**15 tests, 7 dimensions.** Recomputed directly from the active run log rather than
repeating either the issue's old count or a reviewer's restated one: three rubric
dimensions (Relevance to research, Citation completeness, Genealogical implications)
show only the value 3 across the whole corpus, and the base Tool Arguments dimension
shows only 3 or null, never 1 or 2. Not chased as its own fix here — no counter-example
was found showing any of these should fail on an existing scenario, so this reads as
corpus coverage rather than a lenient rubric; worth revisiting if a future dive finds
one.

`judge_context` grep for score-branch spoilers: 0 hits, confirmed.

---

## F1 — 10 `wikipedia_search` mock fixtures return a response shape the real tool can never produce

**Did:** `ut_historical_context_002`'s committed response ends with a "Sources
consulted" list citing both "Company town" and "Philadelphia and Reading Coal and Iron
Company" as two separate Wikipedia sources — both pulled from a single
`wikipedia_search` call.

**Should:** the real tool (`packages/engine/mcp-server/src/tools/wikipedia.ts`) calls
the Wikipedia REST summary API and returns exactly **one** object —
`{ title, extract, url }` (`WikipediaSearchResult`, `types/wikipedia.ts`). There is no
way for a real `wikipedia_search` call to return two articles.

**Gap — not a SKILL.md or judge/rubric defect; a test-corpus/fixture defect.** 10 of
roughly 50 `eval/fixtures/mcp/wikipedia-search-*.json` files were authored with a
`{ query, results: [{ title, summary, url }, ...] }` shape — apparently modeled on
`wiki_search`'s real multi-result shape, applied to the wrong tool:
`anthracite-company-towns`, `appurtenances-property-law`, `coal-mine-accidents`,
`coal-miners-wales-ireland`, `coal-occupational-terms`, `dorset-history`,
`irish-famine-pennsylvania`, `molly-maguires`, `philadelphia-immigration`,
`reading-coal-company` — affecting 5 of the suite's original 14 tests. This was
invisible to the judge entirely: it grades the response against the fixture's
*content*, never against whether the fixture's *shape* matches the real API. No
cross-skill impact — all 10 are used only by historical-context's own tests.

**Fixed directly** (mechanical — matching a verified TypeScript contract, no
genealogical judgment involved): reshaped all 10 to `{ title, extract, url }`, keeping
the single most on-topic result where a fixture had two and dropping the other.

**Converts** — see the class-closer validator request at the bottom of this doc
(filed as its own issue per Step 6 and clack391's review, rather than duplicated per
finding).

---

## F2 — the same defect class, worse, in `wiki_search` and `wiki_place_page`

**Did:** `wiki-search-kentucky.json`'s response, before this PR, had:
```json
{ "rank": 1, "relevance_score": 0.9, "chunk_text": "...", "page_title": "Kentucky Vital Records",
  "page_url": "https://www.familysearch.org/en/wiki/Kentucky_Vital_Records" }
```
and `wiki-place-page-pennsylvania-online-records.json`'s response had:
```json
{ "place": "Pennsylvania, United States", "section": "online_records", "content": "...",
  "source_url": "https://www.familysearch.org/en/wiki/Pennsylvania,_United_States_Genealogy#Online_Genealogy_Records" }
```

**Should:** the real `wiki_search` result item is
`{ rank, relevance_score, chunk_text, page_title, section_heading, source_url }`
(`WikiSearchResultItem`, `types/wiki-search.ts`) — no `page_url` field exists, and
`section_heading` was missing entirely. The real `wiki_place_page` result is
`{ standardPlace, placeName, content, url }` (`WikiPlacePageResult`,
`types/wikiPage.ts`) — no `place` or `section` field exists in the response, and
`placeName` was missing entirely.

**Gap — same class as F1, worse in `wiki_place_page`.** For `wiki_search`: 4 fixtures
used the wrong field names. Two are historical-context-only
(`ancient-order-hibernians`, `england-nonconformist-records`); two touch a different
skill, `research-plan` (`kentucky`, used by `ut_research_plan_016`; `denmark`,
currently unused by any test). For `wiki_place_page`: **all 9 fixtures in the entire
repo** were missing `placeName`, and 6 of the 9 also used the wrong names for the
rest. Fixed all 4 `wiki_search` fixtures and the 6 `wiki_place_page` fixtures that
touch only `research-plan` or nothing (Kentucky x2, Pennsylvania x2, Denmark x2)
directly here, since re-running `research-plan` was already unavoidable (it shares
these fixtures). The remaining 3 `wiki_place_page` fixtures
(`wiki-place-page-any.json`, `-ireland.json`, `-via-server-signature.json`) are used
by 25 of `locality-guide`'s own tests — essentially its whole suite — so fixing them
means a full `locality-guide` re-run outside this PR's scope. Filed as issue #1891
with the exact blast radius and the small fix each of the 3 actually needs.

**Converts** — same class-closer validator as F1.

---

## F3 — no fixture modeled an empty or error wiki/Wikipedia response, leaving prohibition line 11 completely untested

**Did:** no fixture in the corpus, before this PR, returned an empty `wiki_search`
result set or a `wikipedia_search` error. Confirmed by grep across
`eval/fixtures/mcp/wiki*.json` and every historical-context test's `mcp_fixtures`
list before this PR.

**Should:** SKILL.md's Important rules (~line 200) — "when a tool call returns no
results or an error, do not continue elaborating that topic as if the search
succeeded — narrow the response or flag the gap explicitly." Prohibition line 11.

**Gap — lane 2/coverage gap, mine, and fixed directly.** Added `ut_historical_context_014`
against a fictional, deliberately obscure place ("Hollow Creek Settlement") so the
model cannot have genuine prior knowledge either, with two new fixtures:
`wiki-search-hollow-creek-empty.json` (empty `results[]`) and
`wikipedia-search-hollow-creek-error.json` (an error body mirroring the real tool's
actual 404 message). The committed run scored **partial** — verified by reading the
actual response directly: the model states specific-sounding causal explanations
("this is the most likely explanation") for a place neither tool ever returned
anything about, with the caveat that this is general knowledge arriving only in a
closing note. That partial is the correct, intended signal this test exists to
produce, not a test defect.

**Not blocking, but worth recording:** in the committed run the model searched broad
background topics and never called `wiki_search` on the literal place name, so
`wiki-search-hollow-creek-empty` was never actually served — only the error branch of
the new test fired (via `wikipedia_search`). The test still exercises prohibition
line 11 through the error path; the empty-results branch remains unexercised on this
particular run and is worth checking on a future rerun.

---

## F4 — the skill fabricated a false "system hiccup" to justify skipping research

**Did:** `ut_historical_context_001`'s response, in the pre-PR run log
`v1_2026-08-18_19-19-59` (a run since superseded by a clean rerun, but the transcript
was read and recorded before it aged out), opens: *"The skill ran into a system
hiccup, but I can provide this historical context directly from my knowledge"* —
followed by many specific, confident claims (Famine death tolls, named Irish counties
of origin, a specific Pennsylvania civil-registration date, Liverpool as the departure
port) with zero "unconfirmed" flagging and no "Sources consulted" list. Checked the
run log directly: `tool_calls: []`, `skill_attempts: 1` — no tool call was ever
attempted, successful or failed. There was no system hiccup; the model invented one.

**Should:** SKILL.md's Step 3 requires calling MCP tools for context; the Important
rules require flagging unconfirmed claims and never presenting training-knowledge in
the same register as tool-verified facts. But no rule currently and explicitly forbids
*fabricating a false technical excuse* for skipping that step — the closest existing
language ("flag the gap explicitly") assumes an honest admission, not an invented
pretext.

**Gap — lane 4 (core doctrine).** A new, explicit rule is needed; this is not a lane-2
grading issue and not mine to silently patch. This is single-run variance, not a
permanent state — a later standalone rerun of the same test passed cleanly with six
real tool calls (now the committed baseline). But the pattern is real and worth
guarding against: a future run could reproduce it with more convincing surrounding
prose and a more lenient judge result. The judge already caught the symptoms on that
run (it failed); what's uncaught is the pattern itself. Filed as issue #1892 with the
validator request below, since a new core-doctrine rule deserves review before landing
rather than a silent patch.

> **Validator request V2 — no unbacked system/tool-error claim**
> **Rule:** if `output.text_response` claims a tool, system, or technical error
> occurred (phrases like "system hiccup," "technical issue," "ran into an error"), then
> `output.tool_calls` must be non-empty, and at least one call must actually show an
> error — otherwise the claimed failure never happened.
> **Where to look:** `output.tool_calls` (a harness field, not judge output),
> cross-referenced against `output.text_response` for error-claiming phrases.
> **Why it is not judgment:** a literal-phrase match plus a mechanical check of whether
> any tool call was actually attempted — no interpretation needed.
> **What a violation looks like:** `ut_historical_context_001`,
> `v1_2026-08-18_19-19-59` — claims a "system hiccup," `tool_calls: []`.

---

## Lane summary

| # | Finding | Lane | Converts |
|---|---|---|---|
| F1 | 10 `wikipedia_search` fixtures shaped as a multi-result array; impossible for the real API | fixture defect (not a skill-behavior lane) | V1 (class-closer, filed separately) |
| F2 | Same class in `wiki_search` (4 fixtures) and `wiki_place_page` (9 of 9 fixtures) | fixture defect | V1 |
| F3 | No empty/error wiki fixture existed; prohibition line 11 untested | 2 (coverage gap, mine) | — (new test added) |
| F4 | Fabricated "system hiccup" to justify skipping research | 4 (core doctrine) | V2 |

**1 findings-specific validator request (V2) plus 1 class-closer validator request
(V1, filed as its own issue per Step 6 and the "group by lane" rule) from 4 findings.**
F1/F2's fixture-shape defect does not fit any of the guide's four skill-behavior lanes
— it is a test-corpus defect, not a claim about what the skill did wrong — but it is
exactly the kind of finding Step 6 asks to convert, since a program can check it
mechanically against each tool's TypeScript return type.

---

## What to hand back

- The prohibition list (`historical-context-prohibition-list.md`, 20 items) and the
  corrected test/dimension counts (15 tests, 7 dimensions, 4 flat cells) — for the
  next auditor.
- 4 findings, Did/Should/Gap, each placed in a lane (or noted as outside the four
  lanes, for F1/F2).
- F1 and half of F2: fixed directly (mechanical fixture-shape corrections, no
  genealogical judgment).
- F3: a genuinely new test authored and fixed directly (a real coverage gap, not a
  judgment call about wording).
- The other half of F2 (issue #1891) and all of F4 (issue #1892): two follow-up
  issues, each with a validator request, handed off because either the blast radius
  (a second skill's full suite) or the doctrine change (a new SKILL.md rule) needs
  review this PR's scope and lane don't cover.
- V1, the class-closer validator for the fixture-shape defect underlying F1 and F2:
  filed as its own issue (not per-finding, per the guide's "group by lane" rule),
  since it is one mechanical rule that closes the whole defect class across
  `wikipedia_search`, `wiki_search`, and `wiki_place_page` at once.
