# Attached records baseline: extract, link and timeline a person in code, and close the plan item

**Status:** PR B is in progress (PR #3613, Emruthwill). PRs A, C and D start once this plan merges. Work order: issue #3516, which absorbs issue #3525 and issue #3585. One senior developer. Each PR says "Part of issue #3516"; only PR D closes it. Delete this file when PR D merges.

**Priority:** quality, and a prerequisite of step mode, not Beta's speed critical path (lead, 2026-10-20). PR B comes first, because step mode's "not exhaustive" choice, its wrap-up and its one-question rule all need searched plan items closed (`docs/plan/research-step-mode.md`, prerequisites).

## What this builds

- **A baseline step, all code.** `extraction_append({ projectPath, personId })` extracts every indexed record FamilySearch has attached to a person and links each one to that person as `speculative`. `timeline_build({ projectPath, personId })` then builds the person's timeline from those links. No agent runs.
- **Where it runs.** In a /research job, once per subject after init-project and before the first question-selection. "Create a timeline for <PID>" is a bounded ask that runs both and stops.
- **Plan items close in code.** `extraction_append` completes the plan item behind the records it extracts, and a question that finds a record already extracted claims it.
- **The benchmark stays honest.** A leak check fails when a record an expected finding cites is attached to the fixture's subject, unless an allow-list names it as starting evidence.

Not in this plan: verifying attachments (issue #3584, parked), the hints plan item (issue #3153), and the unit snapshot rule (issue #3568).

## Decisions

Carried from issue #3516 (lead, 2026-10-19 and 2026-10-20):

1. A timeline is never built from tree facts. In person mode, unsourced tree facts become gaps, never events.
2. The first step is all code and assumes every attachment is correct: `speculative` links with a fixed rationale, no agent and no `same_person` gate.
3. Verifying attachments is a separate request (issue #3584).
4. The timeline is built in code by `timeline_build`. The timeline agent keeps travel feasibility, chronology anomalies and hypothesis mode (Mode B). The military and immigration gap rules stay in Mode B; person timelines do not apply them.
5. "Create a timeline for <PID>" is a bounded ask. A /research job runs the step and `timeline_build` before its first question-selection.

Carried from issue #3525 (lead, 2026-10-19):

6. An `in_progress` item completes once ANY of its plan-tied positive or partial searches has an extracted record. One extraction meets "evidence in hand" (lead, 2026-08-23).

Added (lead, 2026-10-20):

7. **A question claims a record extracted before it existed.** When `extraction_append` is asked to extract a record it already has, and the call carries `questionIds`, it adds those ids to that record's assertions. Ids only grow.
8. **Completion is read off the saved search results.** An `in_progress` item on an active plan completes when any of its plan-tied positive or partial `record_search` entries lists, in its sidecar (`results[].recordId`), a record that now has an assertion. That covers fresh extractions, reused reads, re-sends, and a record two items both found. Tagging the fresh `record_read` entry with the item's id (issue #3525, Part 1.2) is not built.
9. **A search that ran is never marked skipped.** `research_append` refuses `skipped` on an item with a tied `record_search`, `fulltext_search` or `image_search` entry that did not error, or a tied `external_site` entry whose capture arrived. Completing an item whose searches all found nothing is research-plan's Dispose, widened in the step-mode plan. **Proposed exemption, pending the lead (asked on issue #3516):** an `inaccessible` or `user_declined` skip stands where capture-pending would refuse `completed`. That is search-records' escalation with no user present, which otherwise leaves the item with no terminal status.
10. **ADR-0006 is amended.** A mode may reach a further section only where code composes the whole entry. `extraction_append` writes `person_evidence` only in `personId` mode (speculative, null score, the fixed rationale), plan-item status only `in_progress` → `completed` under rule 8, and assertions only by growing `extracted_for_question_ids`. No input field reaches any of these writes.
11. **Relationship-level attachments are never linked**, because 32 of 42 in the e2e trees name the other party. They are not extracted for now either. The step reads person-, name- and fact-level refs, and so does the leak check.
12. **The acceptance run is joao-sousa-death.** It is adjudicated, and its three attached records that findings cite are starting evidence (PR A). carel-kolbe-death is still a draft pending adjudication (PR #3517).
13. **maria-bracero-marriage's f2 becomes non-required.** Her attached 1973 death record answers it without the hint. The required marriage finding still needs the hint.
14. **Census years come from FamilySearch's catalog, for any country.** A year counts when a single-year census collection covers the residence place or an enclosing jurisdiction. A year whose collections are tiny next to that place's other census years is a fragment and is dropped, so no list names destroyed years. ADR-0012 is amended to match. A census FamilySearch does not hold produces no gap, and the timeline's summary says its census years come from FamilySearch's collections.
15. **ferber-marriage's f2 stays required.** Its notes keep the attached 1900 census as an anchor the research starts from, so extracting it at setup is the intended path, not a leak.

**One narrowing of the 2026-10-19 ruling, confirmed by the lead on 2026-10-20.** project_context's "none linked → person-evidence" rung ignores only links that carry `ATTACHMENT_LINK_RATIONALE`, not every speculative link. person-evidence itself writes a speculative link when the researcher confirms a weak match, and ignoring those would send the question back to person-evidence to ask again. The unlinked-proof gate still ignores every speculative link.

## PR A — the allow-list and two fixture guards

Free tier. A genealogist reviews the reason lines and the f2 edit.

- [ ] **maria-bracero-marriage.** In `expected-findings.json`, set f2 `required: false` (decision 13), and add a dated changelog line to its README saying why.
- [ ] **The allow-list.** Create `eval/tests/e2e/attached-evidence-allowlist.json` as `{ "<fixture>": { "<bare 1:1 id>": "<reason>" } }`, with the 12 entries below. Use the bare record id, never the tree source id.
- [ ] **Leak check** (a pytest under `eval/harness/tests/unit/`, run by `make harness-test`). For every `eval/tests/e2e/*/` fixture:
  - fail when a `1:1:` record id cited in `expected-findings.json` is the `url` of a source attached to a `subject_person_ids` person in `starting-tree.gedcomx.json` by a person-, name- or fact-level ref, unless the allow-list names that id for that fixture;
  - match the `1:1:<id>` token, not a substring of the file;
  - fail on a stale entry: an allow-listed id that is no longer attached or no longer cited.
- [ ] **Record-hint equality.** Add it to `validate_fixture.lint_fixture`, beside its unstripped-tree checks, as a hard error: a `"genre": "record-hint"` fixture whose `starting-tree.gedcomx.json` differs from `unstripped-tree.gedcomx.json` fails. That makes `make e2e-validate` and the corpus test (`test_committed_fixture_passes_the_hard_gates`) agree with `author.py validate`. All 95 record-hint fixtures pass it today.
- [ ] **`docs/specs/e2e-test-spec.md`.**
  - In §6.1's "The block is necessary but not sufficient" callout, name the leak check and the allow-list. Say what an entry means, and that a record answering a required finding is the lead's call, not an entry.
  - In §3.4, add decision 13 as a third use of `required: false`.
- [ ] **Prove each guard both ways:**
  - a cited id planted on a subject fails, naming the fixture and the id;
  - an allow-listed id, and a cited id attached only to a relative, pass;
  - a stale allow-list entry fails;
  - a stripped scratch copy fails the equality check, and a reformatted one passes.
- Done when: `make harness-test` and `make e2e-validate` exit 0, and `git diff --stat` shows only these files and the spec.

Reason lines. These are drafts from the 2026-10-20 review; check each against its fixture's README.

| fixture | id | reason |
|---|---|---|
| fernando-suarez-marriage | 6DDW-L7XF | Fernando's persona in daughter Julia Rosa's 1896 baptism. f1 needs the 1891 hint marriage QG2B-LVHQ. This record also answers non-required f2, the bride's parents. |
| grigory-kokosha-death | FNGV-JL3 | Grigory's 1843 marriage. f1 needs the 1846 hint death KX55-44K. |
| grigory-kokosha-death | KXPB-DG6 | Daughter Anna's 1844 baptism. f1 needs the 1846 hint death KX55-44K. |
| joao-sousa-death | 6NGD-BL9Q | The subject's own 1852 baptism; the index names only his mother. f1 turns on the 1919 hint death 6YP6-D37M (copy 6B9P-F8GR). |
| joao-sousa-death | X911-WXWP | The elder namesake brother's 1865 marriage: evidence for f1's competing candidate. f1 still turns on the 1919 hint death. |
| joao-sousa-death | X91B-LBSN | The elder brother's son Francisco's 1905 marriage, in the same role as X911-WXWP. |
| maria-bracero-marriage | QVJX-8L5R | Maria's 1973 death registration, which names her father Juan Bracero and supports her mother's name Juana. It answers only f2, non-required since 2026-10-20. f1 still needs the 1907 hint marriage QVJH-YRN1. |
| nancy-davis-marriage | MDZF-Q7C | The subject's 1850 census, her only source. f1 and f2 need evidence that the 1868 bride was born about 1853. |
| nicola-domenichelli-death | 6ZYD-6L8N | Nicola's 1946 marriage. f1 needs the 1981 hint death 6ZB1-TVLX. |
| thomas-hanrahan-marriage | MZF2-Y55 | The Saratoga Thomas's 1880 census. f2 needs the Ballylooby hint 6267-W22Q rejected on the New York records. |
| thomas-hanrahan-marriage | F5GR-QBN | Thomas's father persona in an Irish child's 1871 birth entry, attached to the Saratoga Thomas where the live tree merged two families. f2 still needs the hint rejected. |
| thomas-hanrahan-marriage | F5YK-84C | The same, in the 1872 birth entry. |

## PR B — extraction_append closes plan items and claims re-found records

Free tier. In progress on PR #3613; it lands after this plan.

- [ ] **ADR-0006:** put decision 10 in its Decision section, and say its "Revisit when" condition ("a second lane needs narrowing") has fired.
- [ ] **Lanes per call.** In `extraction-append.ts`, replace the single `EXTRACTION_SECTIONS` set with allowed sections per call. Update the pinned "writes exactly {sources, assertions}" test and the tool description's "and no others".
- [ ] **Question tie (decision 7)** in both re-send paths, the recordIds resend skip and the documents one.
  - With `questionIds`, union them into every assertion of that record, and return "already extracted as <src>; tied to <q>".
  - The update arm re-validates the merged entry. `validateInformantQualityFloor` must run on an update only when the update sets `informant_proximity` or `information_quality`, as `validateRelationshipDirection` already does. Otherwise a record from an older project whose assertions carry unknown proximity with primary or secondary quality can never be tied, and its question loops on "extraction". The committed e2e runs hold 266 such assertions.
  - Vitest: a tie on an unknown/secondary assertion succeeds.
- [ ] **Completion (decisions 6 and 8).**
  - Make each item its own `researchAppend` call after the extraction writes. The project lock is not re-entrant, and one refused item would fail a shared batch.
  - Evaluate only the items on an active plan whose plan-tied positive or partial `record_search` sidecars list a record this call extracted, reused or tied.
  - A refused completion is reported in the result (`planItems.errors`) and never fails the extraction.
  - It must pass `planItemLogAttributionInvariants`; the `record_search` entry names the item.
  - Keep the lookup to `record_search` sidecars, since a full-text result carries an image ARK and never a record id.
  - Add a comment at the completion check stating the ANY rule and its reason.
- [ ] **A search that ran is never skipped (decision 9).** A new precondition in `research-append.ts`, in both the `plan_items` arm and the `plans` arm's inline-items loop.
  - Its refusal names the entry and says to set `completed`.
  - Under the proposed exemption, it stands aside for an `inaccessible` or `user_declined` skip where capture-pending would refuse `completed`. For any other `skip_category` there, the refusal names those two categories, not only "wait for the capture", since with no user present no capture comes.
  - Before merge, measure the rule over the committed runs (ADR-0011). PR #3613 found 60 of 476 skipped items with a search that ran, 59 of them legacy skips with no category.
- [ ] **A completed item stays completed.** An `in_progress` write on a `completed` item is a no-op with a warning, in both arms. search-records' status step writes `in_progress` after every search it logs.
- [ ] **Reuse a read (issue #3525, Part 1.1).** When `research.json` has an uncited `record_read` entry for the record whose sidecar still holds it, cite that entry and skip the live read. For a census, reuse only a sidecar that carries `indexFields`.
- [ ] **documents mode (issue #3525, Part 1.3).** Accept a finalized `results/<log_id>.json` whose log entry exists, and cite it instead of writing a new `user_provided` entry.
- [ ] **Unit-plane ownership check** (`eval/harness/validators/test_universal.py`). There are two `extraction_append` predicates, each judging a whole section delta, with free cases in `test_universal_validators.py`:
  - **`plans`:** the only change is an item's `status` moving from `in_progress` to `completed`.
  - **`assertions`:** existing entries are unchanged, except that `extracted_for_question_ids` grows (ids only appended) and, on those entries only, the update arm's normalizer fields. New entries may be appended.
  - Free cases: a tie alone passes; a tie plus a new record passes; removing an id or changing `record_basis` fails.
- [ ] **`docs/specs/schemas/ownership.json`:**
  - add `extraction_append` to `writerTools` and `toolAuthorized` on the `plans` and `plan_items` rows; `plans` is the one that binds on the unit plane;
  - rewrite the `requires` text on both;
  - rewrite the `assertions` row's text, since a re-found record gains question ids;
  - correct the `RETIRED` comment in `eval/harness/tests/unit/test_ownership_manifest.py`.
- [ ] **Docs that go false:**
  - `docs/specs/research-append-tool-spec.md`:
    - the extraction section's opening ("not reachable");
    - the recordIds section;
    - the documents section's `transcriptionRef` row and its resend-skip sentence;
    - the last sentence of the `questions` stop-gate row;
    - two new `plan_items` precondition rows: the searched-skip refusal, and the completed-item no-op;
  - `docs/specs/guardrail-enforcement-spec.md`: a row for the searched-skip refusal. In the "Plan completeness before a declaration" row, items with an extracted positive result now have an exit, while items whose searches all found nothing still need Dispose;
  - `docs/specs/research-schema-spec.md`: the ANY rule beside `plan_items.status`, and who writes `items[].status` in its ownership table;
  - `docs/architecture.md`: extraction_append's sections;
  - `docs/skill-dataflow.md`:
    - row 7;
    - "Stated twice, differently" item 1, which is rewritten, not deleted. FamilySearch items now complete in code, but nil-only items still wait for Dispose, and search-full-text's "extraction will complete it" stays untrue because completion reads only `record_search` sidecars;
  - the tool description's "Each is read live", which is false once a prior read is reused;
  - the `planCompleteInvariants` docstring ("Issue #1821 owns that fix").
- [ ] **Bodies that now meet the refusal.**
  - research-plan's Termination skips `in_progress` items that cannot run. It is fixed in the step-mode plan's research-plan prep PR.
  - search-images' status step offers "completed // or skipped" after a browse it logged. Issue #3549 already edits that body and pays its suite's run, so put the fix on that issue.
- [ ] **One read, recorded in the PR body.** research-exhaustiveness's "if any is still `planned` or `in_progress`, refuse" and its decline rules still hold under decisions 8 and 9. Edit them only if they are wrong.
- [ ] **Vitest** (`tests/tools/extraction-append.test.ts`, `extraction-append-documents.test.ts`, `research-append.test.ts`):
  - an item with one positive entry completes when its record is extracted;
  - an item with two positive entries completes when one is extracted;
  - a record found by two items' searches completes both;
  - re-sending an already-extracted record with `questionIds` ties it and completes its item;
  - a reused read makes no live read and cites the existing entry;
  - a nil-only item, a `planned` item and an item on a superseded plan are untouched;
  - a refused completion leaves the extraction written;
  - skipping a searched item is refused in both arms; skipping a never-run item is accepted, and so is an external hand-off with no capture;
  - under the exemption: a nil `record_search` and then a deferred `external_site` entry under one item. `skipped`/`inaccessible` is accepted, `skipped` with another category is refused with a message naming `inaccessible`, and `completed` is refused;
  - `in_progress` on a `completed` item leaves it `completed`, in both arms;
  - documents mode cites a finalized results ref.
- Done when: `make engine-test`, `make engine-test-pg`, `make typecheck` and `make harness-test` are green. No paid run is owed: `extraction_append` is a live tool, so check_runlogs warns rather than blocks. Say in the PR body that graded behaviour changes anyway, in project_context's next step and in research_append's refusals.

## PR C — the baseline step and timeline_build

Free tier, plus one `make hook-smoke` run and one `make engine-smoke-http` run. Land it after PR B and after PR #3583. It shares the score gate, the reused-hint code, ADR-0009's same_person constraint and the guardrail row with issue #3552, so whichever lands second rebases.

### `extraction_append({ projectPath, personId })`

- [ ] **A fourth mode,** exclusive with the other three (`MODES`, and the "send exactly one" error in `runExtractionAppend`).
- [ ] **Shared lookups.** Move `findAnchor` (from `person-warnings.ts`; `census-children-gap.ts` imports it too) and `collectSourceRefs` (from `project-context.ts`) into a new `src/utils/` module. A util must not import a tool.
- [ ] **Which records.** Take only this person's person-, name- and fact-level refs (decision 11), and map each to its tree source's `url`. Keep `1:1:` ARKs, and count the rest as skipped ("N attached sources are not indexed records; not extracted").
- [ ] **No attachment.** A person with no `1:1:` attachment returns `ok: true` with nothing extracted or linked, the skipped count, and a summary saying no attached indexed record exists. It never enters the recordIds path with an empty list, which returns `ok: false`.
- [ ] **Extract** through the recordIds path, with no `questionIds`.
- [ ] **One record, whichever persona requested it.** "Already extracted" means the record, not the persona that was requested, unless PR B already did this.
  - A requested ARK counts as already extracted when it matches any `persons[].ark` in the `record_read` sidecar of a record that already has assertions.
  - Ties and rule 8 match on the same thing.
  - Nothing in the committed runs re-finds a record through another persona today, but extracting every attachment up front makes it likely.
- [ ] **Reuse the imported source entry.**
  - Stamp the import's `S` id as `gedcomx_source_description_id` on the source op, and omit `sourceDescription`, which research_append refuses alongside it.
  - Match on the bare ARK id, never the URL string: the import's url is `familysearch.org/…/1:1:<id>`, while the record's own is often `1:2:`.
  - This avoids a duplicate `S`. It does not make `same_person`'s leave-one-out work, because imported facts cite S1.
- [ ] **Link.** For each record:
  - find the persona whose `persons[].ark` names the attached ARK, take that persona's `id`, then take the assertions carrying it as `record_persona_id`. Persona ids are `p_…`, never the ARK id;
  - write each `person_evidence` row with `confidence: "speculative"`, `match_score: null` and `rationale: ATTACHMENT_LINK_RATIONALE`, an exported constant: "Linked because FamilySearch has this record attached to this person; not verified.";
  - a record already extracted is linked from its existing sidecar, with no re-read, when none of its persona's assertions has a live link;
  - leave an assertion already linked to anyone alone;
  - a record whose assertions carry no persona id is extracted but not linked, and its outcome says so.
- [ ] **Score-gate exemption.** Let this path past `personEvidenceScoreInvariants` with an internal option on `researchAppend`, never an input field.
  - Test that an MCP `research_append` writing the same unscored speculative link is still refused.
  - Also refuse any update to a live link whose stored rationale is `ATTACHMENT_LINK_RATIONALE` unless it sets only `superseded_by`. Otherwise raising its confidence in place skips `same_person`, because the score gate checks an update only when it writes `match_score`, `assertion_id` or `person_id`. The refusal names the route: score with `same_person`, append a new link, then supersede this one.
  - Vitest: raising an attachment link to probable is refused; superseding it is accepted.
  - Docs that go false: the score-gate row in `research-append-tool-spec.md`, the recorded-score row in `guardrail-enforcement-spec.md`, and ADR-0009's write-boundary constraint 2.
- [ ] **Lane and ownership.** Add `person_evidence` to this mode's allowed sections (decision 10). Update the `person_evidence` row in `ownership.json`: `writerTools`, `toolAuthorized`, `requires` and notes.
- [ ] **Return** counts (extracted, linked, skipped) and one code-written summary line for the whole call, not a summary per record.
- [ ] **Spec the mode** as a new subsection of `research-append-tool-spec.md`'s extraction section. Cover:
  - the `personId` input;
  - person-, name- and fact-level refs only, and why relationship refs are excluded (decision 11);
  - the `1:1:` filter and the skipped count;
  - reuse of the import's `S`;
  - the persona match through `persons[].ark`;
  - the attachment link and its score-gate exemption (decision 2);
  - the return.

  Rewrite the extraction section's opening again, and add the fourth call shape to `docs/catalog.md`'s extraction_append row.
- [ ] **Sites that say extraction never writes `person_evidence`:**
  - `extraction-append.ts`'s header and description;
  - ADR-0006, `docs/architecture.md` and `docs/skill-dataflow.md`;
  - two comments in `hooks/guard_project_files.py`. A `hooks/` edit owes `make hook-smoke`;
  - `eval/harness/harness/skill_invocation.py`: the "SOLE tool that creates person_evidence" comment, and `find_effects_without_invocation`, which must not count a link carrying the constant as person-evidence's work;
  - `eval/harness/harness/ownership.py`.
- [ ] **Mock** (`_make_extraction_append_handler` in `eval/harness/harness/mock_mcp.py`): with `personId`, stage every loaded `record_read` fixture, and match bare ids.
- [ ] **`project_context`:** add `subjectPersonIds` from `research.project.subject_person_ids`, with its spec and a test.
- [ ] **Vitest** (`tests/tools/extraction-append.test.ts`):
  - a tree id and a FamilySearch id both resolve;
  - person-, name- and fact-level refs count, and a relationship-level ref does not;
  - a memory or artifact source is skipped and counted;
  - a relative's sources are not taken;
  - the import's `S` is reused;
  - the persona mapping, on a captured live fixture (`tests/fixtures/record-extract/`), not a hand-built one, which gives a persona the ARK as its id;
  - a record extracted earlier with no live link is linked without a re-read;
  - an assertion already linked is left alone;
  - no attachment gives `ok: true` with nothing written;
  - `personId` together with `recordIds` is refused;
  - a record re-sent through another persona's ARK is tied, not re-extracted.

### A speculative link is not proof

- [ ] **Two predicates in one `src/utils/` module.** The one for PR #3583's `unlinkedProofInvariants` counts a live link (`superseded_by` null) only when it is not speculative. The one for its `noneLinked` rung counts every live link except those carrying `ATTACHMENT_LINK_RATIONALE` (the narrowing above). A Vitest case pins the difference: a researcher-confirmed speculative link satisfies the rung and not the gate.
- [ ] **Docs.** Update the two texts PR #3583 adds: `project-context-tool-spec.md`'s "Evidence nobody has linked to a person" paragraph (an attachment-only link counts as none), and `research-append-tool-spec.md`'s unlinked-proof row (a speculative link does not count). Update the gate's refusal text to match.
- [ ] **Re-count**, and record in the PR body, how many committed e2e proofs above `not_proved` rest only on speculative links, which the gate now refuses. There were 2 on 2026-10-20: cruz-corona-ancestry ps_001 (proved) and robert-lord-children ps_001 (disproved).

### `timeline_build({ projectPath, personId })`

- [ ] **Add the tool** in `src/tools/timeline-build.ts`. It does the timeline agent's Mode A Steps 2–4 and 7 in code. Also add:
  - its schema in `allToolSchemas` (`src/tool-schemas.ts`), its dispatch arm in `src/server.ts`, and its name in `manifest.json` `tools`;
  - its name in `OK_FALSE_IS_FAILURE` (`src/tool-result.ts`), with the `server.ts` arm returning `writerToolResult(…)`. `no_linked_evidence` returns `ok: true`;
  - `NoProjectError` → `noProjectResult()`, and a `CALLS` row in `tests/tools/no-project.test.ts`;
  - its name in `FS_TOOLS` (`apps/server/proto/worker/options.py`), since it reaches the FamilySearch token through `collections-search.ts`;
  - a row in `dev/smoke-calls.ts`, `src/types/timeline-build.ts`, `dev/try-timeline-build.ts`, a new `docs/specs/timeline-build-tool-spec.md`, and a `docs/catalog.md` entry.
- [ ] Resolve `personId` with the shared `findAnchor`.
- [ ] **Events come from live `person_evidence` links only** (`superseded_by` null). Never use a tree fact or `diedByYear`.
  - Merge the assertions one record makes about one event into a single event, listing every id in `assertion_ids`.
  - Event types, the date-certainty subset, the before/after conversion and the sort key follow timeline.md Step 3.
  - Copy `standard_place` from the assertion. When it is absent, resolve the assertion's `place` text once per distinct place.
  - Set `distance_from_previous_km` with `haversineDistance` (`src/tools/distance.ts`). Look up each distinct place once, and compute each unordered pair once. A place that does not resolve leaves the distance null.
  - If every link behind an event is `speculative`, start its `description` with "Unverified attachment:" when every rationale is `ATTACHMENT_LINK_RATIONALE`, and with "Unverified:" otherwise.
  - For a resolved conflict, take the preferred assertions only and set `conflict_ids`, as timeline.md Step 7 says.
- [ ] **Gaps.** Copy `start` and `end` from the bounding events, and never pad them. The tool writes four kinds:
  - **Census, `high`.** The span runs from the first record-backed event to the last, or to a linked death. Each missing census year is one `expected_events` entry naming its year ("1870 census"). The years come from the collections catalog through `collectionCoverage` (`src/tools/collections-search.ts`), with three fixes made in the function itself. Each was measured against the live catalog on 2026-10-20:
    - **Match on place ids, not titles.** Ohio, Hamilton County and Cincinnati each return `[]` today, because the federal censuses are filed under the United States only. `collectionCoverage` stays pure and takes resolved place ids as a parameter. The caller resolves the residence place and each enclosing level once, with `standardPlaceToPlaceId` on each comma suffix (cached). Do not walk the title match up to "United States", which matches every "United States, <state>, …" collection.
    - **Count censuses under any facet.** US 1790, 1830 and 1870, and England and Wales 1841 and 1881, are filed as `MISCELLANEOUS`. Take every single-year collection whose title names a census.
    - **Drop fragments by record count (decision 14).** With the facet test gone, US 1890's 6,285 records would count against 40 million in 1870. Drop a census year whose collections hold a small fraction of the median of that place's census years. Measure the threshold on the live catalog in this PR, and record it with its evidence in the tool's spec.
  - **Marriage, `high`.** A linked assertion names a child of the person, and no marriage event comes before the first child's birth.
  - **Twenty or more years between consecutive events, `high`.**
  - **Death without burial, or burial without death, `medium`.**

  Question-selection reads only `high` gaps.
- [ ] **`tree_gaps` gets the fixes too**, since it shares `collectionCoverage`.
  - It resolves place ids inside its remaining catalog wait, and keeps the title match for a place that does not resolve in time.
  - Update `docs/specs/tree-gaps-tool-spec.md`'s Coverage section, including its "Not done" placeId paragraph, and `tests/tools/tree-gaps.test.ts`'s coverage case.
  - Do not change the tool descriptions of `collections_search`, `tree_gaps`, `person_warnings` or `record_read`. Each blocks the suites that serve it from fixtures, under check_runlogs' rule 2c.
- [ ] **ADR-0012:** amend its Decision, "What stays in the plugin" and Last updated. `timeline_build` takes census years from FamilySearch's catalog, and drops fragments by record count rather than by a per-country list. The wiki read stays the agent's for Mode B.
- [ ] **Budget.** Every network leg runs under one deadline below 60 s, Cowork's per-call cap, as `tree_gaps` does. If the catalog is late or fails, write the timeline without census gaps, and say so in `summary`.
- [ ] **Write** through `researchAppend`. With no person timeline yet, append one. Otherwise update this person's timeline (the one with no `hypothesis_id`) in place, and restamp `generated`. Never touch a hypothesis timeline. Every event cites assertions, so PR #3573's warning for events that cite no record never fires on these.
- [ ] **Ownership.**
  - In `ownership.json`'s `timelines` row, add `timeline_build` to `writerTools` and `toolAuthorized`, and name it in `requires` and `remedy`.
  - `test_universal.py`'s tool-identity arms are written for merge_tree_persons and extraction_append only, so add a `timeline_build` arm. Appending a person timeline and updating the person's own timeline pass, and editing a hypothesis timeline fails. Without it, the research suite's job-row test fails ownership.
  - Add `timeline_build` to `PROJECT_WRITER_TOOLS` in `test_universal.py`, with a free case beside `test_hand_edit_detector_passes_when_writer_tool_called` (`eval/harness/tests/unit/test_validator_runner.py`). After PR D a Mode A timeline run's only writer is `timeline_build`.
  - Add it to `UNMODELLED_WRITERS` in `eval/harness/harness/replay.py`.
- [ ] **Nothing linked:** write nothing and return `status: "no_linked_evidence"` with `ok: true`.
- [ ] **Return** `{ ok, status, timelineId, events, unverifiedEvents, gaps: { high, medium, low }, summary }`. `summary` is one code-written sentence the main thread relays. It gives how many events there are, how many come from unchecked attachments and how many `high` gaps, and says that checking the attachments is a separate request.
- [ ] **Unit harness.** `timeline_build` is a live tool, served like `extraction_append`.
  - Add it to `LIVE_TOOLS` and to `LIVE_MODULES` in `eval/harness/harness/instrument.py`; `test_instrument.py` asserts the two match. Also add it to `OK_FALSE_IS_FAILURE_LIVE` in `mock_mcp.py` and to its docstring's live-tool list.
  - Add a `_make_timeline_build_handler` in `mock_mcp.py`, dispatched from `_make_live_handler`. It runs the compiled tool against the workspace with injected deps:
    - coordinates from the test's `place_search` fixtures, taken from the response whose first result's `standardPlace` matches;
    - place ids, and a raw catalog in FamilySearch's shape (`entries[].content.gedcomx.collections[]` with `searchMetadata`), from files the test or scenario supplies. Name their home outside `eval/fixtures/mcp/`, which holds only tool-response fixtures;
    - anything absent answers null (no census gaps, null distance), and the handler never makes a request.
  - Free cases in `test_mock_mcp.py`: one attachment link yields one event; no link yields `no_linked_evidence` and no write.
  - Joining `LIVE_TOOLS` moves `tools.live` for every suite, which check_runlogs only warns on.
- [ ] **Vitest** (`tests/tools/timeline-build.test.ts`):
  - a tree id and a FamilySearch id both resolve;
  - a tree fact with no link becomes no event;
  - one record's assertions about one event merge into one event;
  - both unverified prefixes;
  - a census gap names its year, and a year with no catalog collection is not expected;
  - `collectionCoverage`: US 1870 and England 1881 are census years, and US 1890 is dropped as a fragment; Ohio gets the federal years; an Ohio place gets no year from a "United States, Kentucky, …" collection;
  - a raw `place` with no `standard_place` is resolved;
  - a late catalog gives a timeline with no census gaps and a summary that says so;
  - no padded boundary;
  - nothing linked writes nothing;
  - a rerun updates in place and leaves a hypothesis timeline alone.
- Done when:
  - `make engine-test`, `make engine-test-pg`, `make typecheck`, `make harness-test` and `make server-test` are green;
  - `make hook-smoke` (live and billed) has run after the hook-comment edit;
  - `make engine-smoke-http` has run once for the new smoke row. No CI job runs it.

  No paid unit run is owed.

## PR D — the plugin side

Paid: the timeline, research, question-selection and person-evidence suites, each with a genealogist annotation. Lands after PR A, whose allow-list the acceptance run's leak check reads.

### `agents/timeline.md`

- [ ] **Mode A:** replace Steps 2–4 and 7 with one `timeline_build({ projectPath, personId })` call. Keep Step 5 (travel feasibility, chronology anomalies) and Step 8, working from the timeline the tool wrote. Add `timeline_build` to `tools:` under all three spellings, which changes the permission snapshot in `agent-tool-names.test.ts`.
- [ ] **Mode C** (refresh by `timelineId`). On a person timeline (no `hypothesis_id`) it calls `timeline_build`, which updates the timeline in place. On a hypothesis timeline it keeps the agent's steps.
- [ ] **Mode B (hypothesis)** never hands back, and keeps all of Step 4, the military and immigration rules included. Rewrite its Step 2, whose "no `assertionId` filter" predates that filter. It reads only the hypothesis persons' linked assertions (`research_query` by `assertionId`, at most 50 per call), never the unfiltered assertions section, which whole-record extraction makes much larger.
- [ ] Add `attachmentsLinked` to the invocation contract. It is `yes` when the caller has just run `extraction_append({ personId })` for this person.
- [ ] When `timeline_build` returns `no_linked_evidence` and `attachmentsLinked` is absent, make no claim about the person's life. Return these lines:
  `Hand-back: extraction_append — no record is linked to <personId> yet`
  `1. extraction_append({ projectPath, personId: "<personId>" })`
  `2. @plugin:timeline — projectPath, personId <personId>, attachmentsLinked: yes`
  Then `---`, and a `summary_for_user` saying nothing has been checked against a record yet, and what happens next.
- [ ] With `attachmentsLinked: yes` and still `no_linked_evidence`, say that no record yet places the person anywhere. Never hand back twice.
- [ ] `summary_for_user` gives the tool's `unverifiedEvents` count, and says that checking the attached sources is a separate request.

### `agents/person-evidence.md`

- [ ] **Step 1: an attachment-only link means unlinked.** An assertion whose only live link carries `ATTACHMENT_LINK_RATIONALE` counts as unlinked. Score it with `same_person`, append the new link (Step 4), then set `superseded_by` on the attachment link (Step 6). The rule against a second `pe_` for a pair that is already linked does not apply to an attachment link.
- [ ] Without this, the rung and the proof gate send a question resting on attachment links to person-evidence, which sees them as linked and does nothing, so the router loops. Add a unit test under `eval/tests/unit/person-evidence/`: a question-tied assertion with only an attachment link gets a scored append, and its attachment link is superseded.

### `skills/research/SKILL.md`

- [ ] **Bounded list:** add "a timeline for a person". Its owner goes in the "Hand a bounded request straight to…" sentence: `extraction_append({ projectPath, personId })` (with `@plugin:init-project` first when there is no project), then `timeline_build({ projectPath, personId })`, relaying its `summary`. The bounded section's own close ends the ask. It never goes to question-selection or the timeline agent.
- [ ] **Job:** put the two calls at the front of today's "Objective but no questions" row: for each `project_context` `subjectPersonIds` entry, `extraction_append({ projectPath, personId })` then `timeline_build({ projectPath, personId })`; then `@plugin:question-selection`. Re-running either call is cheap: the resend skip reads nothing, linked assertions are left alone, and `timeline_build` updates in place. The row stays tool calls only, so step mode never splits it.
- [ ] **research/SKILL.md never names `@plugin:timeline`,** so a timeline.md edit keeps staling only the timeline suite.
- [ ] **The "Assertions not yet linked to persons" row:**
  - widen its trigger to assertions linked only by an attachment link (`ATTACHMENT_LINK_RATIONALE`), matching the rung;
  - add one exception to its "You never write `person_evidence` entries… Extraction never links": the speculative attachment links `extraction_append({ personId })` writes.
- [ ] **Re-check the six research tests** the new calls reach:
  - on `empty-project-just-created`: `route-no-questions`, `autonomous-is-always-a-job`, `bounded-ask-not-a-job`, `open-ask-still-a-job`, `route-shortcut-guard`;
  - on `driscoll-source-audit`: `attached-before-searching`.

  Neither subject cites an indexed source, so the calls write nothing. Rewrite the judge_context line naming the first row in `route-no-questions` and `route-shortcut-guard`: the row now runs the two calls first, which write nothing there, then question-selection.
- [ ] Name the new step, with its measured cost, in `docs/architecture.md`'s orchestration description.

### Tests and fixtures

- [ ] **A new scenario** under `eval/fixtures/scenarios/`, with `project.objective`, `project.subject_person_ids: [<subject>]` and a README. Its subject has tree facts, two person-level `1:1` sources, one memory source, no assertions and no questions.
  - Its two `record_read` fixtures use `p_…` persona ids, with the ARK only in `persons[].ark`.
  - Add the catalog file and the place-id table `timeline_build`'s handler reads.
- [ ] **Two more states:**
  - (i) the same project after the step, its subject's assertions linked by speculative rows carrying `ATTACHMENT_LINK_RATIONALE`, for timeline (b);
  - (ii) an objective, no questions, and a person timeline with a `high` gap whose events cite linked assertions, for the question-selection test.
- [ ] **Rework the existing timeline suite for Mode A in code:**
  - `england-census-timeline`:
    - drop the `census-from-wiki` tag and its wiki-read fixtures;
    - serve `timeline_build` an England catalog;
    - derive the expected census years from that catalog;
    - rewrite its judge_context.
  - `eval/harness/validators/test_timeline.py`:
    - delete `test_census_years_read_from_wiki`, or keep it only beside a non-US Mode B test tagged `census-from-wiki`;
    - give test (a) a `no-timeline-write` tag that skips `test_positive_produces_timeline`, plus a tag-gated validator asserting `timelines` is unchanged and the reply carries a `Hand-back:` line.
  - `eval/tests/unit/timeline/rubric.md`: rewrite "Tool usage — place resolution and distance", "Gap detection" and "Geographic feasibility", so that a Mode A place, distance or census year written by `timeline_build` passes. The ledger rule applies to Mode B only.
  - Rewrite the ledger and `place_distance` lines in the judge_context of `build-patrick-timeline`, `geographic-infeasibility`, `impossibility-after-death` and `timeline-with-multi-conflict`.
- [ ] **`eval/tests/unit/timeline/`:**
  - (a) zero links and no flag gives the hand-back and no `timelines` write;
  - (b) attachment links present (state i) gives events labelled unverified;
  - (c) a hypothesis delegation with zero links, on `first-plan-migration-hypothesis`, gives no hand-back.
- [ ] **`eval/tests/unit/research/`:**
  - (a) "create a timeline for <PID>" runs `extraction_append`, then `timeline_build`, and never question-selection or the timeline agent. Do not assert `research_delivered`: whether step mode keeps it is open (`docs/plan/research-step-mode.md`, "Open, for Praise");
  - (b) a job on the new scenario, with question-selection stubbed and `execution.stop_at_stub: true`. A tag-gated validator in `test_research.py` asserts an `extraction_append` call with `personId` and, after it in `tool_calls`, a `timeline_build` call. Prove the validator fails on a run without them.
- [ ] **`eval/tests/unit/question-selection/`:** on state (ii), the first question still restates the objective. Tag it `selection-basis-objective-decomposition` and `objective-scope-match`. Priority 3 (`timeline_gap`) ranks above the fresh-project default, and nothing tests which one wins today.
  - Run question-selection first. If the test fails and you edit `agents/question-selection.md`, re-run question-selection, and run research only after that edit, because research's snapshot embeds question-selection.md.
- [ ] **`eval/tests/unit/person-evidence/`:** the attachment-link test above.
- Done when: `make eval-skill SKILL=timeline`, `SKILL=research`, `SKILL=question-selection` and `SKILL=person-evidence` have landed with their annotations, and `check_runlogs.py` passes.

### Acceptance e2e

Before PR D merges, post its worktree path and `make e2e-run TEST=joao-sousa-death` on issue #3516; the lead runs it. PR D's body carries the report, and the tool's spec carries `timeline_build`'s figures. Report:

- the records extracted and the assertions linked;
- the result size and tool time of `extraction_append({ personId })` and of `timeline_build`, and the main-thread turns they add;
- the run's `wall_clock_seconds` and `total_cost_usd`, with the price basis stated;
- the findings grade, and that the leak check passed.

No comparable baseline exists: joao-sousa-death's only committed run predates PR #3312. Say so rather than compare.

## What nothing checks

Before PR D merges, comment each item below on the open `nothing-checks` issue that covers it, or file one with that label, and name the issue here.

- Whether the main thread obeys the timeline agent's hand-back outside /research. The unit tests grade only the hand-back text.
- Most of the step in e2e: 27 of 167 starting trees cite an indexed source on the subject, and none of the four panel fixtures does.
- PR B and PR C change graded behaviour while check_runlogs only warns.
- The leak check sees only `1:1:` ARK citations. 6 of the 27 fixtures with an indexed attachment on a subject cite no record id at all (carel-kolbe-death, claudia-almada-birth, ferber-grandparents, ferber-marriage, konrad-grubenmann-burial, william-ferber-parents). ferber-marriage's required f1 and f2 cite its attached 1900 census by title, which decision 15 accepts.
- An item whose positive searches kept no sidecar never completes in code; it goes to Dispose. That was 28 of 613 such items in the committed e2e final states.
- A census that FamilySearch does not hold never produces a gap (decision 14).

## Collisions

- **PR #3613** (Emruthwill): PR B, in progress.
- **PR #3583** (open): the "speculative link is not proof" work edits its gate and rung, so PR C lands after it.
- **Issue #3552:** same score gate, reused-hint code, ADR-0009 constraint and guardrail row. Its step 1 turns PR C's "extracted, not linked" case into a link.
- **PR #3567** (open). It edits the `plans` and `plan_items` callers in `ownership.json`. It also edits `hooks/guard_project_files.py`, `eval/harness/harness/skill_invocation.py`, `docs/skill-dataflow.md` and `docs/architecture.md`, all of them PR C sites. Whichever lands second rebases.
- **PR #3577** (open). It edits `ownership.json`, `research-append.ts`, `test_universal.py`, `test_ownership_manifest.py`, `guard_project_files.py`, `agent-tool-names.test.ts`, and four of the docs PR B and PR C edit. Check it before touching `ownership.json`, and rebase.
- **`skills/research/SKILL.md`** is also edited by PR #3567, PR #3577, PR #3507, issue #3526 and issue #3153. Whichever lands second re-runs research.
- **Issue #3153.** Its hints item completes through search-hints' own lane, not rule 8, because a `person_record_matches` entry has no `record_search` sidecar. It also edits:
  - the `plans` row, `test_ownership_manifest.py`, and `research-schema-spec.md`'s ownership table;
  - `guard_project_files.py`, with its own `make hook-smoke`;
  - `catalog.md`, `skill-dataflow.md` and `agent-tool-names.test.ts`;
  - `question-state.ts`, where PR C edits the `noneLinked` rung.
- **Issue #3568:** its opt-in edits stale the research suite. Whichever of it and PR D lands second re-runs research.
- **Issue #3549:** it edits `agents/search-images.md`, whose "or skipped" now meets PR B's refusal.
- **Step mode** (`docs/plan/research-step-mode.md`): PR B is a prerequisite. Completing items whose searches all found nothing, routing a refused declaration's `in_progress` items to Dispose, and research-plan's Termination are in its research-plan prep PR and PR 2.
- **Issue #3584** (parked): this plan's source reuse does not unblock it.

## Costs

- PR A and PR B owe no paid unit run. PR C owes one `make hook-smoke` and one `make engine-smoke-http`.
- PR D owes four paid runs, about $2.15 for timeline, $5.70 for research, $3.44 for question-selection and $7.79 for person-evidence at the last runs' prices, plus four annotations. Then one e2e run, which the lead does.
- At run time, a job gains one or two main-thread tool calls. On a subject with attached records it also gains 4.5–7.2 s of record reads for 14–16 records (live, 2026-10-20), and the extraction summary in context.
