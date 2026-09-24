Closes #2745.

## Summary

- **Normal tier.** Fills the `SUPPRESSIONS` list PR #2729 shipped empty (issue #1522): **93 hits → 14, with 79 suppressed**, each entry quoting the phrase that makes it a false positive. Suppress-only, per the review-ready ruling of 2026-09-24 — no rubric, `judge_context` or agent body is edited, and no eval run is spent.
- Adds `^packages/engine/plugin/agents/` to the scope `PATTERNS` of `.github/workflows/eval-harness-tests.yml`. An agent-body-only PR did not run this job, and 14 of the 79 entries name an agent body.
- Corrects the `eval/CLAUDE.md` paragraph that describes this check's output, which named three skills as genuine drift that are not.

## Review guidance

**Start here:** the classification itself — `SUPPRESSIONS` in `eval/harness/scripts/check_rubric_tool_drift.py`, read against the 93-row table at the bottom. **Nothing can test whether a classification is right**; that table is the only guard, which is why it carries all 93 rows and not just the 14 survivors.

The one judgement everything else hangs on: I treated **"acceptable *and expected*"** as genuine drift while **"acceptable *if made*"** and **"Do not score down for omitting it; do not reward calling it"** are false positives. The reasoning is that `do not penalize it` is scoped to a call that *was made*, and does not stop a judge reading "expected" and deducting for an absence — the `same_person`/`source_attachments` failure this lint exists to catch. All three wordings sit in this corpus, so the line is drawn on a real contrast rather than an invented one. **If you read that line the other way, 13 of the 14 survivors collapse back into suppressions** — so this is the review's highest-leverage half-hour.

**Unsure about:** one row, where I would like a second opinion rather than a rubber stamp. `packages/engine/plugin/agents/proof-conclusion.md` → `collections_search` / `volume_search` is marked *descriptive*: "Only describe a source as having an 'accessible' or 'digitized' image when the record data actually contains an image reference (e.g. … a nonzero image count from `collections_search`/`volume_search`)". That is an acceptance criterion sourced from two tools the agent does not hold — structurally close to the `person-evidence` / `place_distance` row I kept GENUINE. I separate them because this sentence is a *restriction* (its unreachable branch fails safe) and it is agent prose rather than judge prose, whereas `place_distance` is an imperative to *use* the tool. That distinction is defensible, not obvious.

## Plan

**Didn't change:** any rubric, `judge_context`, `SKILL.md` or agent body — Option B at review-ready, declined ($8–12 and 45–65 min per skill across up to 13 skills, and check_runlogs rule 6 wants zero reds on every one). No genuine hit was suppressed "for now" — Option C, declined, since that hides the one signal the lint gives. No change to the check's mechanism: no new filter, no widening of `COMMON_WORD_EXEMPTIONS`. `docs/lead-themes-2026-09-05.md` is left alone although it records the "about 20% genuine" share as never re-measured — it is a dated snapshot whose own figure is stamped 2026-09-11, so retro-editing it would rewrite what was believed on a date; the measurement went into `eval/CLAUDE.md`, which is the living doc.

**Acceptance check:** none in the usual sense, and that is worth stating plainly rather than leaving blank. Both guards pass on `main` **vacuously** (the list is empty there) and pass here populated. What replaces it: `python eval/harness/scripts/check_rubric_tool_drift.py` reports **14 hits / 79 suppressed** here against **93 / 0** on `main`, and the table below is the only check on whether each row is classified correctly. The guards were therefore proven by breaking them — six ways, below.

**Deviated from the plan:** three things.

1. `eval/CLAUDE.md` was added to the edit list after the plan-critic round-1 review, before any code. The issue's `Touches:` narrows it to "only if a count is quoted there" and none is — **this is a deliberate widening**, because the paragraph *describes the check's output* in three categories this PR removes from it.
2. Both of the plan's flagged "unverified predictions" came back negative: `tree-edit`, `research-exhaustiveness` and `init-project` are **not** genuine drift. That is what grew item 1 from a stale category list into a corrected verdict.
3. The genuine set is 14, not the 11 the issue predicted — triage added 2 `proof-conclusion` twins of the same phrasing and 1 `person-evidence` agent hit of a different shape.

## Test plan

- [x] **I reviewed my own diff first** and left a review on this PR. It ran in a **fresh session** rather than this one, since authoring context makes a poor reviewer of one's own diff — it found two blockers, both fixed in `2b941a903`; the review itself says what they were.
- [ ] **`make test-all` — NOT yet green, and not yet attributed.** The eval-harness leg passes (4682 passed, 8 skipped), but `scripts/test.sh` ends `FAIL: one or more suites failed`. It runs ESLint, typecheck, test-js, server-test, engine-test, eval-ui-test and harness-test; I am re-running with per-suite output to find which one and whether this branch caused it. **Do not merge until this box is ticked.** This PR touches one Python script, one YAML comment+regex and two Markdown/prose files, so a JS/TS suite failure would not be attributable to it — but I am not asserting that until I have the log.
- [x] No skill run-log snapshot changed — no `SKILL.md`, agent body, `eval/tests/unit/**` test or fixture is touched, so no `make eval-skill` run is owed. This PR only *reads* `eval/tests/unit/`; the lint does.
- [x] No skill `description` or DO NOT clause changed, so no routing-pair negative tests are owed.

### Verification run

| | |
|---|---|
| `make test-all` | **not green — under investigation, see the Test plan box above** |
| `uv run pytest tests/unit/test_check_rubric_tool_drift.py` | 25 passed |
| `make harness-test` | **4682 passed, 8 skipped** |
| `check_rubric_tool_drift.py` here | 14 hits, `Suppressed 79 known false positive(s)` |
| same, with `SUPPRESSIONS=[]` | 93 hits — the "before" figure is measured, not arithmetic |

**Guards proven to fail.** `test_no_stale_suppressions` passes vacuously on an empty list, so it was broken five ways and watched to fail each time: a wholly nonexistent file; the **right file with the wrong tool** (`tree-edit/rubric.md` + `record_search`); a `./`-prefixed path; backslash separators; a trailing space. `test_every_suppression_carries_a_reason` was broken with `"reason": "noise"` — failed.

**Proven not to over-fire**, which breaking the repo cannot show: reflowing a multi-line reason onto one physical line still passes; all 79 real entries pass; and the real workflow — editing an agent body to drop a mention **and** deleting the matching entry in the same change — passes, while the same edit with the entry left behind fails and names the pair.

**The `PATTERNS` regex, both directions:** `packages/engine/plugin/agents/gps-mentor.md` goes no-match → match, while `README.md`, `docs/architecture.md` and the near-miss sibling `packages/engine/plugin/agents-notes.md` stay non-matching — the trailing slash is what does that. It has **15** top-level alternatives (an earlier revision of this body said 16, counting a nested alternation twice). Note that nothing in CI asserts this regex; it is verified by hand here, as every other entry in that list always has been.

## Collisions — re-checked at head

Re-measured after merging `origin/main`. **One open PR will invalidate an entry:** PR #2725 deletes both `record_search` mentions from `packages/engine/plugin/agents/person-evidence.md` (2 occurrences → 0), so whichever of #2725 and this PR merges **second** must delete the `{person-evidence.md, record_search}` entry or `test_no_stale_suppressions` fails. I reproduced the failure and [flagged it on #2725](https://github.com/PioneerAIAcademy/cowork-genealogy/pull/2725#issuecomment-5816101718). Deleting an entry is always safe.

The other three collision PRs the issue named — #2870, #2809, #2781 — each keep every suppressed mention intact, so they are clear. *(An earlier revision of this body said no open PR had moved a hit-set file. That was wrong; #2725 had.)*

## Follow-on issues

**Folded in / filed instead:** nothing filed. Two things found during the PR were folded in: the `eval/CLAUDE.md` dating correction, and the now-contradictory comment on `test_suppression_is_selective_end_to_end`, whose hardcoded target this PR reclassifies as a suppressed false positive (the comment called it "clear drift that won't be 'fixed' away"). Both are small and the context was loaded — CLAUDE.md § "Work you find along the way", step 1.

The 14 genuine hits are **routed, not filed** — each already has an open card holding that skill's eval slot, so no new issue was justified:

| Skill / agent | Hits | Routed to |
|---|---|---|
| `search-records` | 11 | [#2123](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/2123#issuecomment-5815135679) |
| `proof-conclusion` | 2 | [#2604](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/2604#issuecomment-5815136356) |
| `person-evidence` agent | 1 | [#2537](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/2537#issuecomment-5815137001) |

## Classification table (all 93 rows)

Genuine rows first.

| file | tool | verdict | shape | quoted phrase |
|---|---|---|---|---|
| `eval/tests/unit/proof-conclusion/gps-review-existing-proof.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/proof-conclusion/gps-review-narrative-not-self-contained.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/attachment-triage.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/child-middle-name-not-surname.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/execute-census-search.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/maiden-name-pre-marriage-search.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/maiden-to-married-name-shift-search.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/negative-no-match-results.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/non-derivative-nickname-bitsie-in-record.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/reject-same-name-birthyear-conflict.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/same-person-conflict-triage.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/same-person-near-match-triage.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `eval/tests/unit/search-records/write-result-sidecar.json` | `validate_research_schema` | **GENUINE** | expects an impossible call | A validate_research_schema call ... is acceptable **and expected** - do not penalize it |
| `packages/engine/plugin/agents/person-evidence.md` | `place_distance` | **GENUINE** | expects an impossible call | Geographic proximity including burial location (use `place_distance` when coordinates are available) |
| `eval/tests/unit/check-warnings/negative-schema-validation.json` | `validate_research_schema` | suppressed | cross-owner | Should route to validate-schema (or whatever skill owns the validate_research_schema MCP tool) |
| `eval/tests/unit/init-project/check-warnings-relative-impossibility.json` | `person_quality` | suppressed | cross-owner | check-warnings' own doctrine skips `person_quality` silently for a non-FamilySearch-PID-shaped id. Only the offline `person_warnings` half is expected to have run. |
| `eval/tests/unit/init-project/check-warnings-relative-impossibility.json` | `person_warnings` | suppressed | cross-owner | check-warnings' own doctrine skips `person_quality` silently for a non-FamilySearch-PID-shaped id. Only the offline `person_warnings` half is expected to have run. |
| `eval/tests/unit/init-project/rubric.md` | `validate_research_schema` | suppressed | not-needed | init-project has no schema-validation tool in its `allowed-tools`, so this is graded by reading the file against the schema, not by expecting a `validate_research_sche... |
| `eval/tests/unit/locality-guide/ut_locality_guide_009.json` | `collection_read` | suppressed | not-needed | Citing collection ids that came from a correctly-matched collections_search call, without independently re-verifying them through collection_read, is not a fabrication... |
| `eval/tests/unit/locality-guide/ut_locality_guide_020.json` | `collection_read` | suppressed | not-needed | is the fixture's known limitation, not a Tool Arguments error - do not penalize Tool Arguments for the mismatch between the requested id and the returned collection |
| `eval/tests/unit/person-evidence/baptism-parentage-links-only-defers-relationship.json` | `tree_correct` | suppressed | negative mention | nothing in this skill's toolset can raise the gender afterwards, since `tree_correct update_person` is not granted to it |
| `eval/tests/unit/person-evidence/patronymic-mismatch-caps-confidence.json` | `record_search` | suppressed | descriptive | this assertion is record_search-sourced (record_persona_id CP1 is non-null), so same_person is available here |
| `eval/tests/unit/proof-conclusion/no-image-claim-without-tool-confirmation.json` | `record_read` | suppressed | descriptive | record_read was never called to check for a digitized image |
| `eval/tests/unit/proof-conclusion/no-image-claim-without-tool-confirmation.json` | `record_search` | suppressed | descriptive | Its notes and log_001 explicitly state that record_search returned no imageId/artifacts field for this hit |
| `eval/tests/unit/question-selection/ut_question_selection_005.json` | `validate_research_schema` | suppressed | not-needed | if the skill calls validate_research_schema, gets a validation error, self-corrects, and re-validates successfully, score Tool Arguments=3 |
| `eval/tests/unit/question-selection/ut_question_selection_006.json` | `validate_research_schema` | suppressed | not-needed | if the skill calls validate_research_schema, gets a validation error, self-corrects, and re-validates successfully, score Tool Arguments=3 |
| `eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json` | `materialize_facts` | suppressed | cross-owner | Minting the sibling person stubs (Bridget, John) ... is person-evidence's household-skeleton step (materialize_facts create-or-enrich + tree_edit add_relationship), re... |
| `eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json` | `tree_correct` | suppressed | negative mention | record-extraction is ASSERTION-ONLY ... `mcp__genealogy__tree_edit` is not in its frontmatter; it makes ZERO tree_edit / tree_correct calls ... Do NOT expect, or rewar... |
| `eval/tests/unit/record-extraction/census-1850-subject-as-child-creates-sibling-stubs.json` | `tree_edit` | suppressed | negative mention | record-extraction is ASSERTION-ONLY ... `mcp__genealogy__tree_edit` is not in its frontmatter; it makes ZERO tree_edit / tree_correct calls ... Do NOT expect, or rewar... |
| `eval/tests/unit/record-extraction/census-sex-assertion-for-gender.json` | `materialize_facts` | suppressed | cross-owner | WHY it matters (context for the judge, not a second check): materialize_facts reads a persona's sex/gender assertions to set the gender of any tree person person-evide... |
| `eval/tests/unit/record-extraction/positive-extract-and-route-image-ark.json` | `image_read` | suppressed | negative mention | Do NOT grade whether the router called image_read directly in the main context - that guard is enforced mechanically by the harness |
| `eval/tests/unit/record-extraction/rubric.md` | `materialize_facts` | suppressed | cross-owner | Minting a household's sibling stubs and writing their `ParentChild`/spouse edges is **person-evidence's** household-skeleton step (`materialize_facts` create-or-enrich... |
| `eval/tests/unit/record-extraction/rubric.md` | `tree_correct` | suppressed | negative mention | record-extraction ... does **not** hold `tree_edit`/`tree_correct`. It writes **no** tree persons, names, or relationships ... do not reward, and do not penalize the a... |
| `eval/tests/unit/record-extraction/rubric.md` | `tree_edit` | suppressed | negative mention | record-extraction ... does **not** hold `tree_edit`/`tree_correct`. It writes **no** tree persons, names, or relationships ... do not reward, and do not penalize the a... |
| `eval/tests/unit/record-extraction/sets-record-persona-id.json` | `record_search` | suppressed | descriptive | search-records already logged this search as log_001 (a record_search entry whose sidecar holds the gedcomx) |
| `eval/tests/unit/record-extraction/suspect-required-name-confirm-via-image.json` | `image_read` | suppressed | negative mention | The router must NOT call image_read directly in the main context - image reading is the image-reader subagent's job |
| `eval/tests/unit/research-exhaustiveness/already-declared-no-redeclare.json` | `validate_research_schema` | suppressed | not-needed | Since no changes are being made to research.json, calling validate_research_schema is not required |
| `eval/tests/unit/research-exhaustiveness/child-link-marriage-not-sufficient.json` | `validate_research_schema` | suppressed | not-needed | this is a decline/review response - Claude is not expected to call validate_research_schema |
| `eval/tests/unit/research-exhaustiveness/declare-exhaustive-complete.json` | `validate_research_schema` | suppressed | not-needed | Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist ... Do NOT ... |
| `eval/tests/unit/research-exhaustiveness/decline-incomplete-research.json` | `validate_research_schema` | suppressed | not-needed | this is a decline/review response - Claude is not expected to call validate_research_schema |
| `eval/tests/unit/research-exhaustiveness/direct-declare-exhaustive-complete.json` | `validate_research_schema` | suppressed | not-needed | Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist ... Do NOT ... |
| `eval/tests/unit/research-exhaustiveness/direct-refuse-while-in-progress.json` | `validate_research_schema` | suppressed | not-needed | If Claude does call validate_research_schema that is acceptable but not required since no changes were made |
| `eval/tests/unit/research-exhaustiveness/exhaustiveness-decisive-record-gate.json` | `validate_research_schema` | suppressed | not-needed | this is a decline/review response - Claude is not expected to call validate_research_schema |
| `eval/tests/unit/research-exhaustiveness/honest-early-termination.json` | `validate_research_schema` | suppressed | not-needed | Claude does not need to call validate_research_schema - it is not in this skill's allowed-tools, and per SKILL.md, research_append validates-before-persist ... Do NOT ... |
| `eval/tests/unit/research-exhaustiveness/refuse-while-in-progress.json` | `validate_research_schema` | suppressed | not-needed | If Claude does call validate_research_schema that is acceptable but not required since no changes were made |
| `eval/tests/unit/research-exhaustiveness/sealed-record-not-a-gap.json` | `validate_research_schema` | suppressed | not-needed | if the skill declares, it writes via research_append (and may call validate_research_schema) |
| `eval/tests/unit/research-exhaustiveness/tentative-value-alternative-record-gate.json` | `validate_research_schema` | suppressed | not-needed | this is a decline/review response - Claude is not expected to call validate_research_schema |
| `eval/tests/unit/research-exhaustiveness/ut_research_exhaustiveness_011.json` | `validate_research_schema` | suppressed | negative mention | The correct outcome is routing to proof-conclusion, with no exhaustive_declaration changes and no validate_research_schema call |
| `eval/tests/unit/research-plan/locality-survey-first-plan.json` | `place_population` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/research-plan/locality-survey-first-plan.json` | `wiki_place_page` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/research-plan/locality-survey-first-plan.json` | `wiki_search` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json` | `place_population` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json` | `wiki_place_page` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/research-plan/plan-danish-parentage-includes-levy-rolls.json` | `wiki_search` | suppressed | negative mention | it should NOT call wiki_search / wiki_place_page / place_population (research-plan no longer holds those tools - the know-how comes from the localities entry). Do NOT ... |
| `eval/tests/unit/search-full-text/parentage-compound-surname-cooccurrence.json` | `record_search` | suppressed | negative mention | Should NOT scope the full-text search to a record `collectionId` guessed from record_search or a collections survey |
| `eval/tests/unit/search-images/browse-unindexed-probate.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/direct-browse-unindexed-probate.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/direct-happy-path-browse.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/image-group-listing.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/negative-indexed-search.json` | `record_search` | suppressed | cross-owner | A log entry from search-records itself (tool: record_search) is the CORRECT route working and is not a violation |
| `eval/tests/unit/search-images/rubric.md` | `image_read` | suppressed | negative mention | The agent does not call `image_read` and does not hold it: `image_read` returns the page inline as base64 and a volume browse accumulates enough of it to overflow the ... |
| `eval/tests/unit/search-images/volume-mixed-item-sections.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/volume-selection-multi-candidate.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-images/volume-split-across-films.json` | `image_read` | suppressed | negative mention | the agent reads pages itself with image_transcribe - it must NOT call image_read (it has no such tool: image_read returns the page inline and a volume browse overflows... |
| `eval/tests/unit/search-records/live-callee-external-sites-escalation.json` | `external_links_search` | suppressed | cross-owner | search-external-sites RUNS FOR REAL here - it is not stubbed. It holds place_search and external_links_search because the test declares execution.run_skills ... its to... |
| `eval/tests/unit/search-records/live-callee-external-sites-escalation.json` | `place_search` | suppressed | cross-owner | search-external-sites RUNS FOR REAL here - it is not stubbed. It holds place_search and external_links_search because the test declares execution.run_skills ... its to... |
| `eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json` | `collections_search` | suppressed | negative mention | Do NOT penalize the skill for not calling place_search or collections_search - recordCountry Norway is a sufficient anchor for the church search |
| `eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json` | `place_search` | suppressed | negative mention | Do NOT penalize the skill for not calling place_search or collections_search - recordCountry Norway is a sufficient anchor for the church search |
| `eval/tests/unit/search-records/patronymic-drop-farmname-anchor-on-parent.json` | `validate_research_schema` | suppressed | not-needed | a validate_research_schema call is acceptable if made |
| `eval/tests/unit/search-records/pivot-to-fulltext-on-lowindex-probate.json` | `fulltext_search` | suppressed | negative mention | search-records must NOT run or delegate the full-text search ... Do NOT require `fulltext_search` in the tool calls |
| `eval/tests/unit/search-records/search-continue-authorized-in-message.json` | `extraction_append` | suppressed | descriptive | this harness's per-test tool allowlist does not extend ToolSearch/extraction_append to a sub-agent invoked this way -- a scoping artifact, not a production behavior |
| `eval/tests/unit/tree-edit/add-occupation-fact-with-place.json` | `validate_research_schema` | suppressed | not-needed | Should NOT need a separate validate_research_schema call ... and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward callin... |
| `eval/tests/unit/tree-edit/correct-typo-death-date.json` | `validate_research_schema` | suppressed | not-needed | Should NOT need a separate validate_research_schema call ... and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward callin... |
| `eval/tests/unit/tree-edit/create-sibling-with-parentchild.json` | `materialize_facts` | suppressed | cross-owner | materializing sourced facts onto a tree person is person-evidence's materialize_facts (record-extraction is assertion-only), not this ad-hoc tree-edit call |
| `eval/tests/unit/tree-edit/create-sibling-with-parentchild.json` | `validate_research_schema` | suppressed | not-needed | Should NOT need a separate validate_research_schema call ... and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward callin... |
| `eval/tests/unit/tree-edit/guardian-after-remarriage-step-hypothesis.json` | `project_context` | suppressed | not-needed | if the run DOES attempt ANY tool - a writer, or a reader such as `project_context` probing for a project - and the call fails BECAUSE NO PROJECT EXISTS (`no_project`),... |
| `eval/tests/unit/tree-edit/person-merge-stub-into-fs-person.json` | `validate_research_schema` | suppressed | not-needed | Should NOT need a separate validate_research_schema call ... and the tool is not in this skill's allowed-tools. Do not score down for omitting it; do not reward callin... |
| `eval/tests/unit/tree-edit/rubric.md` | `materialize_facts` | suppressed | cross-owner | A fact, name, or relationship edge extracted from a source lands on a tree person as research proceeds (at identity-link time, normally via person-evidence's `material... |
| `eval/tests/unit/tree-edit/rubric.md` | `validate_research_schema` | suppressed | not-needed | `merge_tree_persons` validates before persisting, so a separate `validate_research_schema` call is neither required nor available to this skill (SKILL.md Validation) |
| `packages/engine/plugin/agents/gps-mentor.md` | `fulltext_search` | suppressed | negative mention | You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`) |
| `packages/engine/plugin/agents/gps-mentor.md` | `person_read` | suppressed | negative mention | You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`) |
| `packages/engine/plugin/agents/gps-mentor.md` | `record_search` | suppressed | negative mention | You do NOT have search tools (`record_search`, `fulltext_search`, `person_read`) |
| `packages/engine/plugin/agents/image-reader.md` | `record_read` | suppressed | cross-owner | The pivot recommendation: read the **indexed** record for this image (`record_read` / `record_search` / `search-full-text`)'; its description line says 'Do NOT use for... |
| `packages/engine/plugin/agents/image-reader.md` | `record_search` | suppressed | cross-owner | The pivot recommendation: read the **indexed** record for this image (`record_read` / `record_search` / `search-full-text`)'; its description line says 'Do NOT use for... |
| `packages/engine/plugin/agents/person-evidence.md` | `record_search` | suppressed | descriptive | A persona is reachable when the assertion came from `record_read` ... or from a `record_search` with a retained sidecar (`results_ref` present in the log entry) |
| `packages/engine/plugin/agents/person-evidence.md` | `validate_research_schema` | suppressed | not-needed | The persistence tools validate before writing, so no separate `validate_research_schema` pass is needed |
| `packages/engine/plugin/agents/proof-conclusion.md` | `collections_search` | suppressed | descriptive | Only describe a source as having an accessible or digitized image when the record data actually contains an image reference (e.g. an `imageId`/`artifacts` field on the... |
| `packages/engine/plugin/agents/proof-conclusion.md` | `volume_search` | suppressed | descriptive | Only describe a source as having an accessible or digitized image when the record data actually contains an image reference (e.g. an `imageId`/`artifacts` field on the... |
| `packages/engine/plugin/agents/record-extractor.md` | `research_append` | suppressed | cross-owner | Its `record_role` is the literal "absent", which `research_append` enforces |
| `packages/engine/plugin/agents/record-extractor.md` | `tree_edit` | suppressed | negative mention | Never predict an id; never call `tree_edit` for the source; never write `research.json` or `tree.gedcomx.json` directly |
| `packages/engine/plugin/agents/research-exhaustiveness.md` | `fulltext_search` | suppressed | descriptive | nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts |
| `packages/engine/plugin/agents/research-exhaustiveness.md` | `image_search` | suppressed | descriptive | nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts |
| `packages/engine/plugin/agents/research-exhaustiveness.md` | `record_search` | suppressed | descriptive | nil across `record_search` / `fulltext_search` / `image_search` / external sites after the bounded search-records attempts |

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
