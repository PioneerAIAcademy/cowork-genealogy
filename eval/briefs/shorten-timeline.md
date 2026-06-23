# Shorten: timeline

**Bucket:** B (craft compression)
**Primary owner:** genealogist (developer assists with structure)
**Current size:** 420 lines → **Target:** ~300–320 lines (~25% reduction)
**Tool migration:** n/a (no new tool). **Reads/writes via** `place_search`, `place_search_all`, `place_distance` (read-only place tools) and `validate_research_schema`; **writes** the `timelines[]` section of `research.json` directly (it is the sole owner of that section per the universal ownership table).
**Still needed as a skill?** yes — building candidate timelines, chronological sequencing, gap detection (negative evidence), impossibility detection, and identity-coherence verdicts are the GPS-Step-3 correlation craft the rubric grades. The place tools only fetch distances; the sequencing/feasibility judgment is the skill's.

## TL;DR
Timeline is genuinely write-bearing (it owns `timelines[]`) and uses `place_distance` for geographic-feasibility judgment — none of that is cuttable. The compression is in **deduplicated rules** (the regeneratable/sort/combine/date-certainty rules are each stated in both Steps and "Important rules"), the **schema/JSON dumps** that duplicate `research.schema.json`, and one **over-explained worked display block**. Note one fact: SKILL.md tells Claude to `invoke check-warnings` (line 249) but `check-warnings` is NOT in `allowed-tools` — the genealogist resolves this inconsistency **in this PR** (see JUDGMENT CALLS), not a mechanical developer cut.

## Why this skill is shortenable
The same load-bearing rules appear twice — once narratively in Steps, once as a bulleted "Important rules" list (362–381):

- **"Timelines are regeneratable / replace wholesale"** — Step 1 Mode C (68–71), Step 7 Regeneration (308–311), Important rules (364–365), Re-invocation behavior (405–418). Four times.
- **"Sort chronologically, year as sort key for approximate dates"** — Step 3 (102–104), Important rules (366–368).
- **"Combine related assertions into one event"** — Step 3 (106–110), Important rules (369–371).
- **"Date certainty uses the timeline subset, not before/after/between"** — Step 3 (116–121), Important rules (372–374).
- **"Impossibilities are identity signals"** — Step 5 (245–247), Step 6, Important rules (375–376), and the handoff rules.
- **Handoff/next-step suggestions** appear three times: Step 8 "Suggest next steps" (352–360), "Handoff rules" (383–395), and the Step-5/Step-6 inline suggestions.

The JSON example blocks (91–100, 116/154–166, 178–185, 216–222, 295–306) restate fields the schema already defines.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_timeline.py` + universal):
  - `test_positive_produces_timeline` — a positive test must add or refresh ≥1 timeline.
  - `test_events_have_non_empty_assertion_ids` — every event cites ≥1 assertion.
  - `test_event_assertion_ids_resolve` — every `assertion_id` points to a real assertion.
  - `test_events_chronologically_ordered` — events sorted by date string (mechanical sort).
  - `test_no_impossibilities_when_resolved` — tag-gated (`no-impossibilities-expected`): `impossibilities[]` empty when source data is internally consistent.
  - `test_no_rejected_assertion_in_events` — tag-gated (`rejected-assertion-id-<id>`): a resolved conflict's rejected assertion must not appear in event `assertion_ids`.
  - Universal: `test_ownership_table` (timeline owns only `timelines`), `test_tool_allowlist` (place_search/place_search_all/place_distance/validate_research_schema), schema validation, append-only log, no-delete.
- **Rubric dims** (`eval/tests/unit/timeline/rubric.md`): Chronological ordering, Gap detection, Impossibility detection, Geographic feasibility (N/A unless a distance-sensitive pair exists), Identity coherence (Mode-B timelines).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-conflict-resolution` (resolve a conflict → conflict-resolution; timeline may REVEAL but not resolve), `negative-person-evidence` (attach record → person-evidence), `negative-proof-conclusion` (write a conclusion → proof-conclusion).
- **Key test files:** `geographic-infeasibility.json` (the only `place_distance` test — Ireland↔PA, 7 days, flag impossibility), `identity-two-lives.json` / `identity-one-life.json` (Mode-B coherence verdicts), `timeline-with-multi-conflict.json` (rejected-assertion + conflict_ids handling), `impossibility-after-death.json`, `build-patrick-timeline.json`, the three negatives.

## CUT — safe to remove (redundancy / over-explanation)
- **[lines 362–381] "Important rules"** — every bullet restates a rule already stated narratively in Steps (regeneratable, sort, combine, date-certainty subset, impossibilities-are-identity-signals, gaps-are-negative-evidence). The bulleted "correlation tool / single-source has limited power" point (378–381) is the only one not in Steps; preserve that one sentence elsewhere and cut the rest of the section.
- **[lines 405–418] "Re-invocation behavior"** — boilerplate restating "regeneratable, replace wholesale, keyed by id/label, don't duplicate" — already in Step 1 Mode C, Step 7, and the description. One line at most.
- **[lines 352–360 OR 383–395] one of the two handoff lists** — Step 8 "Suggest next steps" and "Handoff rules" cover the same four handoffs (gaps→question-selection, impossibilities→conflict-resolution/hypothesis-tracking, hypothesis-fail→hypothesis-tracking, conflict→conflict-resolution, link→person-evidence). Keep one consolidated handoff list.
- **The full display-format block (321–345)** is longer than it needs to be — the ASCII timeline render with two census rows + distance lines + GAPS/IMPOSSIBILITIES/Coherence is a generous worked example. Trim to a compact skeleton showing the format once; the field-by-field re-explanation below it (347–351) duplicates Step 3.5's distance rules.
- **Redundant JSON example blocks** — keep ONE event JSON (the enriched one at 154–166 covers all fields including `standard_place`/`distance_from_previous_km`); the plain event block (91–100) is a strict subset. Cut the subset. The gap (178–185) and impossibility (216–222) JSON blocks restate `research.schema.json` shape — trim to the field list, not full JSON.

## KEEP — load-bearing craft (do NOT cut)
- **Key design principle: candidate timelines keyed by id/label not person, aggregating multiple GedcomX persons for identity testing (42–52)** — protects Identity coherence dim and Mode-B tests. Keep.
- **Step 3.5 "Enrich with place data and distances" (123–166)** — the `place_search`→`standard_place`→`place_distance` procedure and the same-place-=-0-km / skip-if-null rules. Protects Geographic feasibility dim + `geographic-infeasibility` test + Tool Arguments. Keep the procedure (it's the tool-call contract); only trim the example JSON.
- **Step 4 gap detection: severity tiers + "how to determine expected events" + gaps-as-migration-clues (169–208)** — protects Gap detection dim. The expected-events heuristics (census every 10 years, 1890 destroyed, marriage-before-first-child, wartime military) are craft the rubric's "name specific record types" pass criterion needs. Keep.
- **Step 5 impossibility detection: the `impossibilities[]`-is-chronological-ONLY boundary + conflict_ids/conflict_note routing (210–247)** — protects Impossibility detection dim AND `test_no_impossibilities_when_resolved` (the "conflicting informant testimony is not a chronological impossibility" distinction). Keep; this is subtle and validator-pinned.
- **Step 6 identity-testing analysis: Pass/Fail/Inconclusive criteria (253–272)** — protects Identity coherence dim. Keep.
- **Step 7 assertion_ids vs conflict_ids vs conflict_note rules (284–292)** — protects `test_no_rejected_assertion_in_events` ("rejected `a_*` never goes in assertion_ids or conflict_ids"). Keep; validator-pinned.
- **Date-certainty conversion rule (116–121): before/after/between → estimated + note** — protects Chronological ordering dim and the sort validator. Keep (state once).
- **The conflict-resolution / person-evidence / proof-conclusion handoff boundaries** — protects the three negative tests. Keep one consolidated list.

## TIGHTEN — keep the point, cut the words
- State **regeneratable / sort / combine / date-certainty-subset** once each (in their Step), delete the "Important rules" echoes.
- Consolidate the two handoff lists into one.
- Trim the display block to a minimal skeleton; remove the post-block re-explanation of distance lines (it repeats Step 3.5).
- Keep ONE enriched event JSON; replace gap/impossibility JSON with a field list.

## JUDGMENT CALLS (genealogist decides)
- **`check-warnings` invocation (249–251) — resolve in this PR.** SKILL.md says "After writing the timeline, invoke `check-warnings`," but `check-warnings` is a sibling *skill*, not in this skill's `allowed-tools`, and the overview's bucket-A guidance ("keep only the check-warnings step, which is genealogical") refers to the check-warnings *tool* in write skills. The genealogist picks the resolution (reword to a handoff suggestion, remove the line, or — if Claude really should call it — add it to `allowed-tools`) and applies it in this PR; it's an open inconsistency, so don't leave it as-is.
- **How much of the worked display block to keep.** The ASCII render is a teaching aid for presentation quality (which Correctness/Completeness can reflect), not a graded structural field. A genealogist decides whether a one-screen skeleton suffices or the fuller example earns its lines.
- **Whether the gaps-as-migration-clues paragraph (171–176) is fully covered by the reference doc** (`references/timeline-analysis-guide.md`, 266 lines, holds the Eliza Olds pattern). It may be safely shortened to a pointer — but only the genealogist should confirm the rubric's Gap-detection pass doesn't lean on the in-SKILL phrasing.

## Suggested target structure (~310 lines)
1. Frontmatter + Narration + Places pointer.
2. Purpose + Key design principle (candidate timelines / identity testing) — kept.
3. Steps 1–3: determine mode → gather assertions → build events (one enriched event JSON, date-certainty conversion rule stated once).
4. Step 3.5 place enrichment procedure — kept (trim JSON only).
5. Step 4 gaps (severity + expected-events heuristics) — kept.
6. Step 5 impossibilities (chronological-ONLY boundary + conflict_ids/note) — kept.
7. Step 6 identity coherence (Pass/Fail/Inconclusive) — kept.
8. Step 7 write rules (assertion_ids vs conflict_ids vs conflict_note) — kept.
9. Step 8 validate + compact display skeleton.
10. One consolidated handoff list; one-line Re-invocation note. ("Important rules" section deleted, its one unique sentence folded into the purpose.)

## Verify
```
cd eval/harness && uv run python run_tests.py --skill timeline
```
Watch: `geographic-infeasibility` must still call `place_distance` and flag the transatlantic impossibility (Geographic feasibility dim); `identity-one-life`/`identity-two-lives` verdicts stay correct (Identity coherence); `timeline-with-multi-conflict` must keep rejected assertions out of events (`test_no_rejected_assertion_in_events`); the three negatives must still route out; all structural validators green.

## Owner notes
Genealogist-led because the keep-list (gap heuristics, the chronological-only impossibility boundary, identity-coherence verdicts, the assertion/conflict id routing) is dense graded craft, and the `check-warnings` line is an open inconsistency that needs a craft decision (made and applied **in this PR** — see JUDGMENT CALLS). A **developer can safely** delete the "Important rules" echoes, the Re-invocation boilerplate, the duplicate handoff list, the subset event JSON, and trim the gap/impossibility JSON to field lists. A developer should **not** unilaterally resolve the `check-warnings` line, or touch the gap-heuristic content or the impossibility-vs-conflict boundary wording — those are the genealogist's.
