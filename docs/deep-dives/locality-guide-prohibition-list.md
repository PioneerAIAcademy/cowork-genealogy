# locality-guide — prohibition list

Deep dive #1664. Step 1 of `docs/skill-deep-dive-guide.md`: every rule in
`packages/engine/plugin/skills/locality-guide/SKILL.md` that is **checkable
against a transcript**. Saved so the next auditor starts from this list rather
than rebuilding it. Judgement-only rules ("apply topical breadth well") are out
of scope; only transcript-checkable rules are listed.

Source run for this dive: `eval/runlogs/unit/locality-guide/v1_2026-08-20_14-20-01.json`
(26 tests). Re-derived numbers: 2 of 6 dimensions non-discriminating
(`Jurisdiction accuracy`, `Research strategy` — both always 3); `judge_context`
naming a score branch: 0 files.

## Grounding / fabrication
1. Name only the collections, volumes, record counts, IDs, dates, and repositories that actually appear in a tool result.
2. Never present a truncated `recordCount` as the verified total.
3. Never extrapolate a tool's number into a claim it did not make (a `volume_search` percentage is not a statement about FamilySearch's interface).
4. If a FamilySearch Wiki page returns only generic content, do not cite specifics it does not contain.

## Scope
5. Ask only when place **or** time period is genuinely missing; a named region ("the anthracite coal region") counts as a place — do not ask the user to narrow to a county.

## Jurisdiction
6. When boundaries changed across the target period, call `place_search_all` (not just `place_search`).
7. When a boundary/name change splits records across two jurisdictions, connect them explicitly as one continuous research trail, not as unrelated record sets.
8. A **geographic** split (parent divided into successors covering different areas) must be written "search both successors," not resolved to one successor as if it were a temporal split; do not resolve the ambiguity from a FamilySearch Wiki summary unless it pins the specific place.

## Survey (Step 3)
9. Issue the Step-3 survey calls in a SINGLE turn as PARALLEL calls (`place_population`, `collections_search`, `volume_search`, `external_links_search`, `wiki_search`, all four `wiki_place_page` sections); drop none.
10. Attempt **all four** `wiki_place_page` sections (home / getting_started / online_records / research_tips); a section that 404s is recorded `found: false`, but every section must be attempted, never silently skipped.
11. If the exact-place page 404s, broaden the `standardPlace` one jurisdiction level and retry before recording `found: false`.
12. Collapse duplicate `external_links_search` URLs before listing repositories.
13. `external_links_search`: if `totalForPlace > 0` but `results` is empty, note the out-of-window gap rather than reporting "no online resources"; if `totalForPlace === 0`, FS has none.

## Classify (Step 4)
14. Flag full-text-searchable-but-not-name-indexed explicitly; do not collapse it into "indexed" or "browse-only".
15. A zero `volume_search`/`collections_search` result is a coverage gap to report plainly — never licence to invent a volume, collection, or count.

## Persist (Step 6)
16. Persist exactly one `localities` entry when a `research.json` exists; skip persistence entirely when there is no project.
17. `pages_read` must list all four wiki sections, each with its `found` outcome.
18. Each `jurisdictions[]` entry has exactly `{name, date_range}`; each `collections[]` entry exactly `{id, title, date_range}`; no stray keys — searcher advice goes in `quirks[]`.
19. On repeat invocation for the same place, update the existing `loc_` entry (`op: "update"`), not append a duplicate.

## Important rules
20. Never state a registration/records-begin date without naming its jurisdictional level (town/parish, county, statewide); cite the FamilySearch Wiki page that states it.
21. Match record classes to the target window — flag pre-/post-period classes as background context, not prime sources; do not dismiss a class as out-of-period and then also list it as available.
22. Flag browse-only, non-English, and physical-only records prominently (0% name-indexed + not full-text → browse image-by-image with no search; non-English → note original-language reading; physical-only → state explicitly).
23. Cite the FamilySearch Wiki page URL, not just its title, for any records/dates/registration claim from the FamilySearch Wiki; a claim you cannot attach a returned URL to is not a finding — say the FamilySearch Wiki does not cover it rather than asserting it from memory.
24. Cross-border: name adjoining counties **and** towns across the line, not just the bordering states; cross-border advice goes in `quirks[]`.
25. Cover topical breadth (checklist in `references/locality-broad-context.md`).
