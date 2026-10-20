# Attached records baseline: extract, link and timeline a person in code, and close the plan item

**Status:** PR A (PR #3616) and PR B (PR #3613), both Emruthwill, are on hold until this plan merges; each section below says what it still owes. PRs C and D start once it merges. Work order: issue #3516, which absorbs issue #3525 and issue #3585. One senior developer. Each PR says "Part of issue #3516"; only PR D closes it. Delete this file when PR D merges.

**Priority:** quality, and a prerequisite of step mode, not Beta's speed critical path (lead, 2026-10-20). PR B comes first, because step mode's "not exhaustive" choice, its wrap-up and its one-question rule all need searched plan items closed (`docs/plan/research-step-mode.md`, prerequisites).

## What this builds

- **A baseline step, all code.** `extraction_append({ projectPath, personId })` extracts every indexed record FamilySearch has attached to a person and links each one to that person as `speculative`. `timeline_build({ projectPath, personId })` then builds the person's timeline from those links. No agent runs.
- **Where it runs.** In a /research job, once per subject after init-project and before the first question-selection. "Create a timeline for <PID>" is a bounded ask that runs both and stops. The timeline agent runs `extraction_append` once itself when nothing is linked (decision 16).
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
9. **A search that ran is never marked skipped.** `research_append` refuses `skipped` on an item with a tied `record_search`, `fulltext_search` or `image_search` entry that did not error, or a tied `external_site` entry whose capture arrived. Completing an item whose searches all found nothing is research-plan's Dispose, widened in the step-mode plan. **Exemption (lead, 2026-10-20):** an `inaccessible` or `user_declined` skip stands where capture-pending would refuse `completed`. That is search-records' escalation with no user present, which otherwise leaves the item with no terminal status.
10. **ADR-0006 is amended.** A mode may reach a further section only where code composes the whole entry. `extraction_append` writes `person_evidence` only in `personId` mode (speculative, null score, the fixed rationale), plan-item status only `in_progress` → `completed` under rule 8, and assertions only by growing `extracted_for_question_ids`. No input field reaches any of these writes.
11. **Relationship-level attachments are never linked**, because 32 of 42 in the e2e trees name the other party. They are not extracted for now either. The step reads person-, name- and fact-level refs, and so does the leak check.
12. **The acceptance run is joao-sousa-death.** It is adjudicated, and its three attached records that findings cite are starting evidence (PR A). carel-kolbe-death is still a draft pending adjudication (PR #3517).
13. **maria-bracero-marriage's f2 becomes non-required.** Her attached 1973 death record answers it without the hint. The required marriage finding still needs the hint.
14. **Census years come from FamilySearch's catalog, for any country.** A year counts when a single-year census collection covers the person's place at that time or an enclosing jurisdiction. A year whose collections are tiny next to the full years filed under the same catalog place is a fragment and is dropped, so no list names destroyed years. ADR-0012 is amended to match. A census FamilySearch does not hold produces no gap, and the timeline's summary says its census years come from FamilySearch's collections.
15. **ferber-marriage's f2 stays required.** Its notes keep the attached 1900 census as an anchor the research starts from, so extracting it at setup is the intended path, not a leak.
16. **With nothing linked, the timeline agent extracts once.** When `timeline_build` returns `no_linked_evidence`, the agent calls `extraction_append({ projectPath, personId })` once, then `timeline_build` again. If still nothing is linked, it says that no record yet places the person. It never hands back.
17. **Attached records are checked only on request.** A /research job runs person-evidence on attachment-linked assertions only when a question rests on them alone, which the unlinked-proof gate needs. A question with any other live link leaves its attachment-only assertions speculative, and its proof may cite them. Checking them otherwise is a separate request (decision 3).

**One narrowing of the 2026-10-19 ruling, confirmed by the lead on 2026-10-20.** project_context's "none linked → person-evidence" rung ignores only links that carry `ATTACHMENT_LINK_RATIONALE`, not every speculative link. person-evidence itself writes a speculative link when the researcher confirms a weak match, and ignoring those would send the question back to person-evidence to ask again. The unlinked-proof gate still ignores every speculative link.

## PR A — the allow-list and two fixture guards

Free tier. On hold on PR #3616 until this plan merges. A genealogist reviews the reason lines and the f2 edit.

**Still owed on PR #3616:**
- Move the record-hint equality from `test_e2e_fixture_corpus.py` into `validate_fixture.lint_fixture`, which `test_committed_fixture_passes_the_hard_gates` already calls, and keep PR #3616's `tmp_path` cases. One of them makes a record-hint fixture with no unstripped tree a hard error, so make `author.py validate`'s warning for that case an error too.
- Add the two `e2e-test-spec.md` edits below that it does not have yet. Fold PR #3616's §3.6 leak-check bullet into the §6.1 callout edit, so the rule is stated once, and make its corpus-test sentence name `make e2e-validate` too.
- Take the maria-bracero reason line from the table below. The table's thomas-hanrahan lines are PR #3616's own.

The full checklist:

- [ ] **maria-bracero-marriage.** In `expected-findings.json`, set f2 `required: false` (decision 13), and add a dated changelog line to its README saying why.
- [ ] **The allow-list.** Create `eval/tests/e2e/attached-evidence-allowlist.json` as `{ "<fixture>": { "<bare 1:1 id>": "<reason>" } }`, with the 12 entries below. Use the bare record id, never the tree source id.
- [ ] **Leak check** (a pytest under `eval/harness/tests/unit/`, run by `make harness-test`). For every `eval/tests/e2e/*/` fixture:
  - fail when a `1:1:` record id cited in `expected-findings.json` is the `url` of a source attached to a `subject_person_ids` person in `starting-tree.gedcomx.json` by a person-, name- or fact-level ref, unless the allow-list names that id for that fixture;
  - match the `1:1:<id>` token, not a substring of the file;
  - fail on a stale entry: an allow-listed id that is no longer attached or no longer cited.
- [ ] **Record-hint equality** in `validate_fixture.lint_fixture`, beside its unstripped-tree checks, as a hard error. A `"genre": "record-hint"` fixture whose `starting-tree.gedcomx.json` differs from `unstripped-tree.gedcomx.json` fails. Then `make e2e-validate` and the corpus test agree with `author.py validate`. All 114 record-hint fixtures pass it today.
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
| thomas-hanrahan-marriage | MZF2-Y55 | The Saratoga Thomas's 1880 census, the New York evidence the rejection rests on. f1 (avoid) and f2 turn on rejecting the Ballylooby hint 6267-W22Q. |
| thomas-hanrahan-marriage | F5GR-QBN | The Irish Thomas's father persona in daughter Mary's 1871 Tipperary birth entry, attached to the Saratoga Thomas where the live tree merged two families. f1 (avoid) and f2 turn on rejecting the Ballylooby hint 6267-W22Q. |
| thomas-hanrahan-marriage | F5YK-84C | The same, in son John's 1872 Ardfinnan birth entry. f1 (avoid) and f2 turn on rejecting the Ballylooby hint 6267-W22Q. |

## PR B — extraction_append closes plan items and claims re-found records

Free tier. On hold on PR #3613 until this plan merges.

**Done on PR #3613:**
- the lanes, and both re-send ties;
- one completion write per item, with `planItems.errors`;
- the searched-skip rule in both arms, with the exemption, and the corpus measurement (60 of 476 skipped items had a search that ran, 59 of them legacy skips with no category);
- kept-completed in the `plan_items` arm;
- read reuse with the `indexFields` guard, and the documents citation;
- both unit-plane predicates, the ownership rows, ADR-0006's plan-item and assertion clauses, and the docs, except the texts item 4 names.

**Still owed on PR #3613:**
1. **Gate the informant floor on ties.** Run `validateInformantQualityFloor` on an update only when the update sets `informant_proximity` or `information_quality`, as `validateRelationshipDirection` already does. Keep the per-assertion retry for other refusals.
   - Without the gate, a record whose assertions all carry unknown proximity with primary or secondary quality is never tied. Its question holds no assertions, and `pendingExtraction` sends it back to extraction on every pass. That is 18 records in the committed e2e final states.
   - Make "ties the other assertions when one written before a later rule refuses the update" use a legacy shape the update arm still refuses, such as `record_basis: "absent"` with a non-`absent` role.
   - Add a case: a tie on an unknown/primary assertion succeeds.
2. **Let capture-pending answer the exempt case.** Where capture-pending would refuse `completed`, `planItemSearchedSkipInvariants` returns no error for any `skip_category`. Capture-pending already refuses a non-exempt skip in the same call, with a message naming `inaccessible` and `user_declined`.
   - Delete the "Leave it 'in_progress' until its external capture arrives" remedy from the code and the spec row.
   - Make the "does not name completed…" test assert a single error, capture-pending's.
3. **Add the kept-completed no-op to the `plans` arm's inline items,** as every other plan-item rule is. No committed run writes items through a `plans` update today.
4. **Seven texts:**
   - the last sentence of `research-append-tool-spec.md`'s `questions` stop-gate row ("which no skill can do on the FamilySearch path today");
   - `skill-dataflow.md`'s "Who may write what" `plans` / `plan_items` row: `extraction_append` joins its writer tools and its writers of `items[].status`, `in_progress` → `completed` only, by tool identity;
   - `skill-dataflow.md`'s "Stated twice, differently" item 1. Rewrite it, don't delete it: FamilySearch items now complete in code, nil-only items still wait for Dispose, and search-full-text's "extraction will complete it" stays untrue because completion reads only `record_search` sidecars;
   - for item 1, `research-append-tool-spec.md`'s §5 informant-floor row and `research-schema-spec.md`'s `informant_proximity` row ("Refused by `research_append` on append and update"). Make both say the update arm checks the merged entry only when the op sets `informant_proximity` or `information_quality`. That still catches a flip to `unknown` over a stale `secondary`, but a question tie on a legacy pair is not re-checked;
   - the comment above the floor call in `research-append.ts`'s update arm, to match;
   - `extraction_append`'s description, whose "Each is read live" an earlier read's reuse now makes untrue.
5. **One read for the PR body.** research-exhaustiveness's "if any is still `planned` or `in_progress`, refuse" and its decline rules still hold under decisions 8 and 9. If PR #3564 lands first, read its text.
6. **Run the `plans` free cases as the research suite,** not search-hints. Issue #3153 adds search-hints to the `plans` row's callers, which turns those cases red or makes them vacuous.
7. **The PR body.** Replace its "Needs the lead" section with the decided exemption (lead, 2026-10-20), as item 2 leaves it. Replace its "What nothing checks" bullet on search-hints with: no unit run reaches the `plans` completion predicate. Every positive research test is stubbed, so `test_ownership_table` skips it, and no search-hints scenario has a plan-tied `record_search` with a sidecar. The free cases, run as research (item 6), are its only check.

Also noted for PR #3613:
- research-plan's Termination skips `in_progress` items that cannot run. It is fixed in the step-mode plan's research-plan prep PR.
- search-images' "completed // or skipped" after a logged browse is on issue #3549.
- PR #3612 (draft) builds the same documents-mode citation. Whichever of PR #3612 and PR #3613 lands second drops its copy, and one of the two tests.

## PR C — the baseline step and timeline_build

Free tier, plus one `make hook-smoke` run and one `make engine-smoke-http` run. Land it after PR B. It shares the score gate, the reused-hint code, ADR-0009's same_person constraint and the guardrail row with issue #3552, so whichever lands second rebases.

### The shared module

- [ ] A new `src/utils/` module holds `findAnchor` (moved from `person-warnings.ts`; `census-children-gap.ts` imports it too), `collectSourceRefs` (moved from `project-context.ts`), the two link predicates below, and `ATTACHMENT_LINK_RATIONALE`: "Linked because FamilySearch has this record attached to this person; not verified." `extraction-append.ts`, `research-append.ts`, `question-state.ts` and `timeline-build.ts` import from it. A util must not import a tool.
- [ ] The constant's text is also a literal in `eval/harness/harness/skill_invocation.py` (PR C), in the Step 1 quote in `agents/person-evidence.md` (PR D), and in the `person_evidence` rows of PR D's state (i) and its person-evidence copy. PR C adds a drift test beside `tests/packaging/relationship-direction-drift.test.ts` that pins `skill_invocation.py` to the constant, and shows it fails on a reworded copy. PR D extends it.

### `extraction_append({ projectPath, personId })`

- [ ] **A fourth mode,** exclusive with the other three (`MODES`, and the "send exactly one" error in `runExtractionAppend`).
- [ ] **Which records.** Take only this person's person-, name- and fact-level refs (decision 11), and map each to its tree source's `url`. Keep `1:1:` ARKs, and count the rest as skipped ("N attached sources are not indexed records; not extracted").
- [ ] **No attachment.** A person with no `1:1:` attachment returns `ok: true` with nothing extracted or linked, the skipped count, and a summary saying no attached indexed record exists. It never enters the recordIds path with an empty list, which returns `ok: false`.
- [ ] **Extract** through the recordIds path, with no `questionIds`.
- [ ] **One record, whichever persona requested it.** PR #3613 keys "already extracted" on the requested persona's ARK. Change the resend skip, `tieRecordToQuestions` and the extracted filter in `completePlanItems` to match the record through its `record_read` sidecar's `persons[].ark`. Nothing in the committed runs re-finds a record through another persona today, but extracting every attachment up front makes it likely.
  - Make the match in `extraction-append.ts`. Before the lookup, widen each requested ARK to every `persons[].ark` of a `record_read` sidecar that lists it, and pass that set to `sourceIdsForRecordIds`, which stays as it is.
  - Then rewrite the steps of `research-append-tool-spec.md`'s batch call shape (its "Extractor mode" section). Step 1 skips a record re-found through another persona's ARK, and loses "the one derivation of 'already extracted' that §3.4.1's reuse detection also uses". Also rewrite the tie paragraph and step 6, where "lists that record" means any of its persona ARKs, and the `sourceIdsForRecordIds` JSDoc's "so the two cannot disagree".
- [ ] **Reuse the imported source entry.**
  - Stamp the import's `S` id as `gedcomx_source_description_id` on the source op, and omit `sourceDescription`, which research_append refuses alongside it.
  - Match on the bare ARK id, never the URL string: the import's url is `familysearch.org/…/1:1:<id>`, while the record's own is often `1:2:`.
  - This avoids a duplicate `S`. It does not make `same_person`'s leave-one-out work, because imported facts cite S1.
- [ ] **Link.** For each record:
  - find the persona whose `persons[].ark` names the attached ARK, take that persona's `id`, then take the assertions carrying it as `record_persona_id`. Persona ids are `p_…`, never the ARK id;
  - write each `person_evidence` row with `confidence: "speculative"`, `match_score: null` and `rationale: ATTACHMENT_LINK_RATIONALE`;
  - a record already extracted is linked from its existing sidecar, with no re-read, when none of its persona's assertions has a live link;
  - leave an assertion already linked to anyone alone;
  - skip an assertion whose (assertion, person) pair `rejected_links` names (`isRejectedPair`, once PR #3577 is in), and count it in the summary;
  - write the links so one refused pair never sinks the record's other links;
  - a record whose assertions carry no persona id is extracted but not linked, and its outcome says so.
- [ ] **Score-gate exemption.** Let this path past `personEvidenceScoreInvariants` with an internal option on `researchAppend`, never an input field.
  - Test that an MCP `research_append` writing the same unscored speculative link is still refused.
  - Also refuse any update to a live link whose stored rationale is `ATTACHMENT_LINK_RATIONALE` unless it sets only `superseded_by`. Otherwise raising its confidence in place skips `same_person`, because the score gate checks an update only when it writes `match_score`, `assertion_id` or `person_id`. The refusal names the route: score with `same_person`, append a new link, then supersede this one. person-evidence's Step 6 sets only `superseded_by`, so it is unaffected.
  - Vitest: raising an attachment link to probable is refused; superseding it is accepted.
  - Docs that go false: the score-gate row in `research-append-tool-spec.md`, the recorded-score row in `guardrail-enforcement-spec.md`, and ADR-0009's write-boundary constraint 2. Add a §5 row in both specs for the attachment-link update refusal; it refuses 0 committed links, since none carries the constant yet.
- [ ] **Lane and ownership.**
  - Add `person_evidence` to this mode's allowed sections (decision 10), and ADR-0006's `person_evidence` clause.
  - Update the `person_evidence` row in `ownership.json`: `writerTools`, `toolAuthorized`, `requires` and notes.
  - In `research-schema-spec.md`'s ownership table, the `person_evidence` row gains `extraction_append` (attachment links, by tool identity) and the note "an attachment link is only ever superseded".
- [ ] **Return** counts (extracted, linked, skipped) and one code-written summary line for the whole call, not a summary per record.
- [ ] **Spec the mode** as a new subsection of `research-append-tool-spec.md`'s extraction section. Cover:
  - the `personId` input;
  - person-, name- and fact-level refs only, and why relationship refs are excluded (decision 11);
  - the `1:1:` filter and the skipped count;
  - reuse of the import's `S`;
  - the persona match through `persons[].ark`;
  - the attachment link, its score-gate exemption (decision 2), and the update refusal;
  - the return.

  Rewrite the extraction section's opening again, and add the fourth call shape to `docs/catalog.md`'s extraction_append row.
- [ ] **Sites that say extraction never writes `person_evidence`,** and two that say the timeline agent writes only `timelines`:
  - `extraction-append.ts`'s header and description;
  - the error-contract example in `research-append-tool-spec.md`'s extraction section, which names `person_evidence` as a section `extraction_append` cannot write. Use a section no mode writes (`conflicts`), and say its parenthetical lists that call's own lane;
  - `docs/architecture.md` and `docs/skill-dataflow.md`;
  - three comments in `hooks/guard_project_files.py`. The third is the `timeline` lane's "writes nothing else in research.json". Say instead that timeline's `research_append` writes stay in `timelines`, and that its `timeline_build` and `extraction_append` writes are authorized by tool identity, which holds before and after PR D. A `hooks/` edit owes `make hook-smoke`;
  - `eval/harness/harness/skill_invocation.py`: the "SOLE tool that creates person_evidence" comment, its `timeline` comment "It writes one `timelines` entry", reworded the same way, and `find_effects_without_invocation`, which must not count a link carrying the constant as person-evidence's work;
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
  - a rejected pair is not re-linked, and the record's other assertions still are;
  - no attachment gives `ok: true` with nothing written;
  - `personId` together with `recordIds` is refused;
  - a record re-sent through another persona's ARK is tied, not re-extracted, and the item whose search listed that ARK completes.

### A speculative link is not proof

- [ ] **Two predicates, in the shared module.** The one for PR #3583's `unlinkedProofInvariants` counts a live link (`superseded_by` null) only when it is not speculative. The one for its `noneLinked` rung counts every live link except those carrying `ATTACHMENT_LINK_RATIONALE` (the narrowing above). A Vitest case pins the difference: a researcher-confirmed speculative link satisfies the rung and not the gate.
- [ ] **Docs.**
  - Update the two texts PR #3583 added: `project-context-tool-spec.md`'s "Evidence nobody has linked to a person" paragraph (an attachment-only link counts as none), and `research-append-tool-spec.md`'s unlinked-proof row (a speculative link does not count).
  - Update the gate's refusal text to match.
  - Replace that row's "None-linked refuses 3" with 5: the 3 proofs with no live link, plus the 2 below.
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
  - Every linked assertion with a date makes or joins an event, whatever its `fact_type`. One whose `fact_type` has no event type in timeline.md Step 3, such as `relationship`, joins its record's event with the same date, or else makes an `other` event. mid-research-flynn's a_010 is its record's only 1860 assertion.
  - An undated linked assertion joins the event its record and party (`record_persona_id`, else `record_role`) make for the same `fact_type`. Code extraction splits a derived birth into a place half and a date half (`record-extract.ts`), and this joins them. One that joins no event makes none.
  - Event types, the date-certainty subset, the before/after conversion and the sort key follow timeline.md Step 3.
  - **Dates are written year-first:** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, prefixed `~` when approximate, read from the assertion's `date` with `stdDate` (`src/utils/date-standardize.ts`) and `getDayRange` (`src/utils/date-helpers.ts`). Events sort by that string with a leading `~` ignored, which is how `test_events_chronologically_ordered` compares them. The record's own wording ("12 March 1908") sorts before "1850" as text, so it stays in `description`. Say so in `timeline-build-tool-spec.md`, and in `research-schema-spec.md`'s note that event dates are as encountered in records.
  - Copy `standard_place` from the event's assertions. When none carries one, resolve an assertion's `place` text once per distinct place.
  - Set `distance_from_previous_km` with `haversineDistance` (`src/tools/distance.ts`). Look up coordinates with `lookupPlaceCoords` (`src/utils/place-coords.ts`), passing the time left to the deadline as its budget. It looks each distinct place up once and takes an injectable `PlaceCoordsResolver` the mock handler can serve. Compute each unordered pair once. A place that does not resolve leaves the distance null.
  - If every link behind an event is `speculative`, start its `description` with "Unverified attachment:" when every rationale is `ATTACHMENT_LINK_RATIONALE`, and with "Unverified:" otherwise.
  - **A resolved conflict with a winner** (`resolution_kind: "competitor"`, or no kind and a non-null `preferred_assertion_id`, the shape of a conflict resolved before the kind existed): keep the preferred assertion, drop the conflict's other competing assertions from the events, and set `conflict_ids`, as timeline.md Step 7 says.
  - **Any other resolved conflict** (a deferral with no preferred assertion, or `tree` or `synthesis`): drop nothing, and treat its events as for an unresolved conflict, with a `conflict_note` quoting `resolved_value` when set, else `resolution_rationale`. 12 of the 69 resolved conflicts in the committed e2e final states name no preferred assertion. **A `moot` conflict** marks nothing.
  - **An unresolved conflict:** put its id in `conflict_ids` on every event that cites one of its `competing_assertion_ids`. When a competing assertion is on no event, for example a name-only identity conflict like flynn-multi-conflict's c_002 on a_001, put it on each event built from that assertion's `record_id` and `record_role`. Write a code-built `conflict_note`. For an identity conflict (`isIdentityConflict`, `question-state.ts`) it quotes the `identity_question`; otherwise it names the other competing assertions and their values.
- [ ] **Gaps.** Copy `start` and `end` from the bounding events, and never pad them. The tool writes four kinds:
  - **Census, `high`.** A census year in which any event falls is in hand, whatever the event's type. Each other year the rules below expect is one `expected_events` entry. It names the year and the jurisdiction whose catalog collection supplied that year, with that name just before "census" ("1870 United States census", "1855 New York census", "1890 Denmark census"), so that `timelineCensus1890Invariants` keeps a non-US 1890 census. The jurisdiction is the first segment of the most specific comma suffix of the earlier place whose place id that year's collection is filed under. When a collection filed under the country's own id also covers the year, use the country's name.
    - **Which years:** judge them per interval, strictly between consecutive events that carry a `standard_place`. A year inside an interval counts only when both events are in the same country (the last comma segment), and it is checked against the earlier event's place and that place's comma suffixes. A year between events in two countries expects no census; the 20-year rule covers a long gap there. The span ends at the last record-backed event, or at a linked death.
    - **Where the years come from:** the collections catalog, through `collectionCoverage` (`src/tools/collections-search.ts`). Make three fixes in the function itself; each was measured against the live catalog on 2026-10-20.
    - **Fix 1, match on place ids, not titles.** Ohio, Hamilton County and Cincinnati each return `[]` today, because the federal censuses are filed under the United States only.
      - `collectionCoverage` stays pure and takes resolved place ids as a parameter. The caller resolves each place and its comma suffixes once, with `standardPlaceToPlaceId` (cached), which returns the Primary place id.
      - `collectionCoverage` also returns, for each census year, the catalog place ids it is filed under. `tree_gaps` drops that field before spreading the result into `coverage`, so its output and its coverage test's `toEqual` stand.
      - First confirm on the live catalog that those ids match `searchMetadata.placeIds` for Alabama, Ohio and England, and record the check in `timeline-build-tool-spec.md`, with the level the England and Wales censuses are filed under, which sets their label. If the ids do not match, put it to the lead before building Fix 1.
      - Then correct both places in `collections-search-tool-spec.md` that say the ids differ: the "Place ID mismatch (design note)" and the Key API details bullet. Say that `searchMetadata.placeIds` are Places API Primary ids, the ids `standardPlaceToPlaceId` returns, and give the measured ids as evidence. 351 was Alabama's rep id. The `collections_search` tool still matches by title; `collectionCoverage` matches on place ids.
      - Do not walk the title match up to "United States", which matches every "United States, <state>, …" collection.
    - **Fix 2, count censuses under any facet.** US 1790, 1830 and 1870, and England and Wales 1841 and 1881, are filed as `MISCELLANEOUS`. Take every single-year collection whose title names a census.
    - **Fix 3, drop fragments by record count (decision 14).** Group census collections by the catalog place id they are filed under, so a state census is compared only with that state's other years. Within a group, drop a year whose collections are tiny next to the group's full years.
      - Do not use the median. Four of Ireland's six catalog census years (1821, 1831, 1841, 1851) are fragments filed as `CENSUS`, so Ireland's median is itself a fragment count.
      - Measure the statistic and the threshold on the live catalog, and record both with their margins in the spec. US 1890 and Ireland 1821–1851 fall below it; US 1790 (heads of household only) and the smallest state census year kept sit above it.
      - If no single threshold separates them, put it to the lead before building, since decision 14 rules out a list of destroyed years.
    - **The 1890 check.** Before the write, test each census `expected_events` entry with `timelineCensus1890Invariants` (`research-append.ts`). Drop any entry it refuses, note the drop in that gap's `notes`, and drop a gap left with no entry. Otherwise one refused entry refuses the whole timeline write.
  - **Marriage, `high`.** A linked assertion names a child of the person, and no marriage event comes before the first child's birth.
  - **Twenty or more years between consecutive events, `high`.**
  - **Death without burial, or burial without death, `medium`.**

  Every gap names what fills it, and none has an empty `expected_events`. When a 20-year gap overlaps a census gap, write one `high` gap from the earlier start to the later end, listing the missing census years, then "residence". The two rules walk different events, since only the census rule skips an unplaced one. A 20-year gap with no census year names "residence" alone. The marriage gap names "marriage", and the death/burial gap names the missing one, as timeline.md Step 4 says.

  Question-selection reads only `high` gaps.
- [ ] **`tree_gaps` gets the fixes too**, since it shares `collectionCoverage`.
  - It resolves place ids inside its remaining catalog wait, and keeps the title match for a place that does not resolve in time.
  - Route the new Places calls in `tests/tools/tree-gaps.test.ts`, whose router throws on an unrouted URL, and update its coverage case.
  - Update `docs/specs/tree-gaps-tool-spec.md`'s Coverage section, including its "Not done" placeId paragraph.
  - Do not change the tool descriptions of `collections_search`, `tree_gaps`, `person_warnings` or `record_read`. Each blocks the suites that serve it from fixtures, under check_runlogs' rule 2c.
- [ ] **ADR-0012:** amend its Decision, "What stays in the plugin" and Last updated. `timeline_build` takes census years from FamilySearch's catalog, and drops fragments by record count rather than by a per-country list. The wiki read stays the agent's for Mode B.
- [ ] **Budget.** Start the catalog fetch first, and wait for it until one deadline of about 50 s. That is under Cowork's 60 s per-call cap, and much longer than `tree_gaps`' 15 s catalog wait, because a cold catalog takes 33–36 s. If the catalog misses the deadline or fails, write the timeline without census gaps, and say so in `summary`. Every Places leg (raw place text, place ids for each comma suffix, coordinates) starts as soon as its input is known and must finish by the same deadline. A lookup still open then answers null, and `summary` names the census and distance checks it skipped. Record cold and warm tool time in the spec.
- [ ] **Write** through `researchAppend`. With no person timeline yet, append one. Otherwise update this person's timeline (the one with no `hypothesis_id`) in place, and restamp `generated`. Never touch a hypothesis timeline. Every event cites assertions, so PR #3573's warning for events that cite no record never fires on these.
- [ ] **Ownership.**
  - In `ownership.json`'s `timelines` row, add `timeline_build` to `writerTools` and `toolAuthorized`, and name it in `requires` and `remedy`.
  - In `research-schema-spec.md`'s ownership table, the `timelines` row gains `timeline_build` (person timelines, by tool identity), and so does `skill-dataflow.md`'s "Who may write what" `timelines` row.
  - `test_universal.py`'s tool-identity arms are written for merge_tree_persons and extraction_append only, so add a `timeline_build` arm. Appending a person timeline and updating the person's own timeline pass, and editing a hypothesis timeline fails. No committed unit run reaches the arm: `test_ownership_table` skips every stubbed run, every research test is stubbed, and the timeline suite's subject owns `timelines`. Its free cases are its check.
  - Add `timeline_build` to `PROJECT_WRITER_TOOLS` in `test_universal.py`, with a free case beside `test_hand_edit_detector_passes_when_writer_tool_called` (`eval/harness/tests/unit/test_validator_runner.py`). After PR D, a Mode A timeline run's only writer is `timeline_build`.
  - Add it to `UNMODELLED_WRITERS` in `eval/harness/harness/replay.py`. Also report as unmodelled every `extraction_append` call the replay cannot apply whole: a `personId` call, and any call whose response carries `planItems` or a tie. Neither main's generic path, which reads a call with no `ops` as one log entry, nor PR #3564's log-id read-back applies PR B's completions and question ids.
- [ ] **Nothing linked:** write nothing, and return `status: "no_linked_evidence"`, `ok: true` and the `summary` "No record yet places this person; no timeline was written." The bounded ask and the timeline agent both relay it.
- [ ] **Return** `{ ok, status, timelineId, events, unverifiedEvents, gaps: { high, medium, low }, summary }`. `summary` is one code-written sentence the main thread relays. It gives how many events there are, how many come from unchecked attachments and how many `high` gaps, and says that checking the attachments is a separate request. Whenever the census check ran, it also says the census years come from FamilySearch's collections, so a census FamilySearch does not hold is never expected (decision 14), with or without a census gap.
- [ ] **Unit harness.** `timeline_build` is a live tool, served like `extraction_append`.
  - Add it to `LIVE_TOOLS` and to `LIVE_MODULES` in `eval/harness/harness/instrument.py`; `test_instrument.py` asserts the two match. Also add it to `OK_FALSE_IS_FAILURE_LIVE` in `mock_mcp.py`, and to its docstring's live-tool list.
  - Add a `_make_timeline_build_handler` in `mock_mcp.py`, dispatched from `_make_live_handler`. It runs the compiled tool against the workspace with injected deps:
    - raw place text resolves to the first result's `standardPlace` from the test's `place_search` fixture whose predicate matches it as `placeName`, as `_place_table` does for `project_create`;
    - coordinates come from those same fixtures (`latitude`/`longitude`);
    - place ids, and a raw catalog in FamilySearch's shape (`entries[].content.gedcomx.collections[]` with `searchMetadata`), come from files the test or scenario supplies. Name their home outside `eval/fixtures/mcp/`, which holds only tool-response fixtures;
    - anything absent answers null (no census gaps, null distance), and the handler never makes a request.
  - Free cases in `test_mock_mcp.py`: one attachment link yields one event; no link yields `no_linked_evidence` and no write.
  - Joining `LIVE_TOOLS` moves `tools.live` for every suite, which check_runlogs only warns on.
- [ ] **Vitest** (`tests/tools/timeline-build.test.ts`):
  - a tree id and a FamilySearch id both resolve;
  - a tree fact with no link becomes no event;
  - one record's assertions about one event merge into one event;
  - both unverified prefixes;
  - an unresolved conflict puts `conflict_ids` and a note on each competing event, a name-only identity conflict marks the events of its persona's record, and an identity conflict's note quotes its `identity_question`;
  - a resolved conflict with no preferred assertion keeps its competing events, each carrying its id;
  - a census gap names its year and the jurisdiction its collection is filed under, and a year with no catalog collection is not expected;
  - a New York interval spanning 1855 expects "1855 New York census", never "1855 United States census";
  - on england-census-timeline's links, 1841, 1861 and 1871 are expected and 1851 is not; on the links PR D's flynn copy carries, a_010 makes the 1860 event, and the 1860–1908 interval expects 1870, 1880 and 1900 only;
  - `extractRecord` on `tests/fixtures/record-extract/census-1870-no-relationship-column.json` (p_260900945: Birth 1845 Pennsylvania, Census 1870 Carbon, Pennsylvania) gives one birth event placed in Pennsylvania, and with the 1870 census as the next placed event, 1850 and 1860 are expected;
  - Ohio events in 1850 and 1880 expect the 1860 and 1870 censuses; an 1852 Madeira event and an 1890 São Paulo event expect neither country's census between them;
  - Danish events in 1885 and 1893 and a later US event keep "1890 Denmark census";
  - a placed 1850 event, an unplaced 1852 event and a placed 1880 event give one `high` 1850–1880 gap naming the 1860 and 1870 censuses, then "residence", and no gap has an empty `expected_events`;
  - assertions dated "abt 1845", "1850" and "12 March 1908" give event dates "~1845", "1850" and "1908-03-12", in order once a leading `~` is ignored;
  - with the catalog answering, a timeline with a census gap and one with none (two events in a country with no census collection) both have a summary naming FamilySearch's collections as the source of their census years;
  - a Places lookup that never answers leaves its census years and distances out, and the call still returns before the deadline;
  - on a captured catalog excerpt carrying real ids and record counts:
    - US 1790, 1870 and England 1881 are census years;
    - US 1890 and Ireland 1821–1851 are dropped, and Ireland 1901 and 1911 kept;
    - Ohio gets the federal years, and a state census year counts for a place in that state;
    - an Ohio place gets no year from a "United States, Kentucky, …" collection;
  - a US subject alive across 1890, with a catalog holding the 1890 fragments and the Union veterans schedule: the timeline is written, and no entry names an 1890 census;
  - a raw `place` with no `standard_place` is resolved;
  - a late catalog gives a timeline with no census gaps and a summary that says so;
  - no padded boundary;
  - nothing linked writes nothing and returns that summary;
  - a rerun updates in place and leaves a hypothesis timeline alone.
- Done when:
  - `make engine-test`, `make engine-test-pg`, `make typecheck`, `make harness-test` and `make server-test` are green;
  - `make hook-smoke` (live and billed) has run after the hook-comment edit;
  - `make engine-smoke-http` has run once for the new smoke row. No CI job runs it.

  No paid unit run is owed.

## PR D — the plugin side

Paid: the timeline, research, question-selection and person-evidence suites, each with a genealogist annotation. Lands after PR A, whose allow-list the acceptance run's leak check reads.

### `agents/timeline.md`

- [ ] **Mode A:** replace Steps 2–4 and 7 with one `timeline_build({ projectPath, personId })` call. Keep Step 5 (travel feasibility, chronology anomalies) and Step 8, working from the timeline the tool wrote. Step 5 loses its sentence about referencing conflicts, because `timeline_build` writes `conflict_ids` and `conflict_note`. Add `timeline_build` and `extraction_append` to `tools:` under all three spellings, which changes the permission snapshot in `agent-tool-names.test.ts`. Keep the inlined places guidance verbatim; `tests/packaging/skill-guidance.test.ts` pins it.
- [ ] **Mode C** (refresh by `timelineId`). On a person timeline (no `hypothesis_id`) it calls `timeline_build`, which updates the timeline in place. On a hypothesis timeline it keeps the agent's steps.
- [ ] **Nothing linked, in Modes A and C (decision 16).** When `timeline_build` returns `no_linked_evidence`, call `extraction_append({ projectPath, personId })` once, then `timeline_build` again. If it still returns `no_linked_evidence`, make no claim about the person's life, and relay the tool's `summary`. The body names only the `personId` call to `extraction_append`.
- [ ] **Mode B (hypothesis)** never calls `extraction_append`, and keeps all of Step 4, the military and immigration rules included.
  - Rewrite its Step 2, whose "no `assertionId` filter" predates that filter. It reads only the hypothesis persons' linked assertions (`research_query` by `assertionId`, at most 50 per call), never the unfiltered assertions section, which whole-record extraction makes much larger.
  - With no linked assertion for the hypothesis, Mode B writes nothing and says that no linked record bears on it yet.
- [ ] `summary_for_user` gives the tool's `unverifiedEvents` count, and says that checking the attached sources is a separate request and, when the tool's summary says so, that the census years come from FamilySearch's collections.
- [ ] **Re-invocation behavior:** replace "Writes only `timelines[]`". In Mode A, and Mode C on a person timeline, `timeline_build` writes the person timeline and updates it in place; on `no_linked_evidence`, the one `extraction_append({ personId })` call writes the person's attached records and their attachment links. Mode B, and Mode C on a hypothesis timeline, write `timelines[]` through `research_append`.

### `agents/person-evidence.md`

- [ ] **Step 1: an attachment-only link on a named assertion means unlinked.**
  - The router names the assertion ids: a question's assertions, or a refused proof's supporting ones. A named assertion whose only live link carries the attachment rationale (quote the constant's text) counts as unlinked.
  - Score it with `same_person`, append the new link (Step 4), then set `superseded_by` on the attachment link (Step 6).
  - An attachment-linked assertion the delegation does not name is left alone, so a job never re-verifies every attachment (decisions 2 and 3).
  - Extend PR C's drift test to the quoted text and to every `person_evidence[].rationale` in state (i) and its person-evidence copy, which hold only attachment links. Show it fails on a reworded quote, and on a fixture row reworded at its first word.
- [ ] **Step 0 says the same:** a delegation naming assertion ids whose only live link is an attachment link is linking mode, whatever verb it uses. Otherwise "confirm these attachments" reads as review-only mode, which writes nothing, under Step 0's "an audit verb beats a linking object".
- [ ] **The same exception in two more places.** "Important rules" (one `pe_` per pair) and "Re-invocation behavior": an attachment link is superseded, never refined in place.

### `skills/research/SKILL.md`

- [ ] **Bounded list:** add "a timeline for a person". Its owner goes in the "Hand a bounded request straight to…" sentence: `extraction_append({ projectPath, personId })` (with `@plugin:init-project` first when there is no project), then `timeline_build({ projectPath, personId })`, relaying its `summary`.
  - Add the timeline ask to that sentence's no-hand-off exception, beside the status question, and beside the transcription once PR #3612 is in.
  - The bounded section's own close ends the ask. It never goes to question-selection or the timeline agent.
- [ ] **Job:** put the two calls at the front of today's "Objective but no questions" row: for each `project_context` `subjectPersonIds` entry, `extraction_append({ projectPath, personId })` then `timeline_build({ projectPath, personId })`; then `@plugin:question-selection`. Re-running either call is cheap: the resend skip reads nothing, linked assertions are left alone, and `timeline_build` updates in place. The row stays tool calls only, so step mode never splits it.
- [ ] **`allowed-tools`:** add `timeline_build`, beside `extraction_append`.
- [ ] **research/SKILL.md never names `@plugin:timeline`,** so a timeline.md edit keeps staling only the timeline suite.
  - Add `["research -> timeline", ""]` to `PROSE_MENTIONS` in `tests/packaging/agent-delegation-framing.test.ts`. Its tokenizer reads `timeline_build` and "a timeline for a person" as naming the agent.
  - Keep "**always the agent, never inline.**" in the person-evidence row verbatim; that test pins it.
- [ ] **The "Assertions not yet linked to persons" row:**
  - keep its trigger, and widen it with "or `project_context`'s `nextStep` for a question names person-evidence". In that case spawn `@plugin:person-evidence` with that question's assertion ids in a linking request. person-evidence, which carries the quote, tells the attachment links apart, so no router text quotes the constant;
  - add one exception to its "You never write `person_evidence` entries… Extraction never links": the speculative attachment links `extraction_append({ personId })` writes.

  A question whose assertions include a live link that is not an attachment link gets no rung, and its attachment-only assertions stay speculative (decision 17).
- [ ] **Two more statements PR C and PR D make false.**
  - The Exhaustiveness/proof-conclusion contract header: add "or the attachment links `extraction_append({ personId })` writes" after `@plugin:person-evidence`.
  - "Re-invocation behavior": "**Writes:** nothing directly except the `extraction_append` batch" gains `timeline_build`. "**Do not duplicate:**" says those two skip a record already extracted and update the timeline in place, instead of "the orchestrator creates no entries of its own".
- [ ] **Re-check the six research tests** the new calls reach:
  - on `empty-project-just-created`: `route-no-questions`, `autonomous-is-always-a-job`, `bounded-ask-not-a-job`, `open-ask-still-a-job`, `route-shortcut-guard`;
  - on `driscoll-source-audit`: `attached-before-searching`.

  Neither subject cites an indexed source, so the calls write nothing. Rewrite the judge_context line naming the first row in `route-no-questions` and `route-shortcut-guard`: the row now runs the two calls first, which write nothing there, then question-selection.
- [ ] **Re-check the row's two routing tests** too: `route-unlinked-assertions-to-person-evidence` (ut_research_pe7) and `route-cowork-unlinked-baptisms-to-person-evidence` (ut_research_szk). In pe7's flynn-household-skeleton one of seven assertions is linked, so its `nextStep` reads "research-exhaustiveness, then proof-conclusion", and only the kept trigger routes it.
- [ ] Name the new step, with its measured cost, in `docs/architecture.md`'s orchestration description.
- [ ] **`docs/skill-dataflow.md`:**
  - the `research` row's Writes ("The `extraction_append({ recordIds })` batch … Nothing else") gains the job row's and the bounded ask's `extraction_append({ personId })` and `timeline_build` calls;
  - the flow diagram: init-project leads to those two calls, then question-selection;
  - the `timeline` row's Reads and Writes gain `timeline_build`, and `extraction_append` with `personId` on `no_linked_evidence`;
  - rewrite "`timelines` stays empty unless the main thread delegates to it on a hand-back": a job now writes each subject's person timeline before its first question-selection.

  Also rewrite the first sentence of `ownership.json`'s `timelines` notes, which counts zero e2e writes and says no e2e run has ever routed to it.

### `agents/question-selection.md`

- [ ] **Priority 3 fires only once a question at the objective's scope exists,** in both its table row and its detail paragraph. Otherwise the job row's timeline, written before the first question-selection, sends the first question to a census year: the ladder ranks Priority 3 above Priority 4, and the fresh-project default applies only with "no clear gaps".
  - Rename the "Fresh project, no clear gaps" edge case to "Fresh project", and add that a timeline's gaps never displace Priority 4 there. Keep its decomposition and premise-verification rules.
  - `ut_question_selection_006` still holds, because flynn-census-exhausted's q_001 is at the objective's scope. No open PR edits this file; step mode's PR 2 also rewrites Priority 3, in either order (Collisions).
  - This stays prose: which question restates the objective is a judgement the decomposition and premise rules make.

### Tests and fixtures

- [ ] **A new scenario** under `eval/fixtures/scenarios/`, with `project.objective`, `project.subject_person_ids: [<subject>]` and a README. Its subject has tree facts, two person-level `1:1` sources, one memory source, no assertions and no questions.
  - Its two `record_read` fixtures use `p_…` persona ids, with the ARK only in `persons[].ark`.
  - Add the catalog file and the place-id table `timeline_build`'s handler reads.
- [ ] **Two more states:**
  - (i) the same project after the step, its subject's assertions linked by speculative rows carrying `ATTACHMENT_LINK_RATIONALE`, for timeline (b);
  - (ii) an objective, no questions, and a person timeline with a `high` gap whose events cite linked assertions, for the question-selection test.
- [ ] **Rework the existing timeline suite for Mode A in code:**
  - **`build-patrick-timeline` and `timeline-with-multi-conflict`.** In `mid-research-flynn` and `flynn-multi-conflict`, I1's birth, residence and death assertions are unlinked, so a links-only tool cannot build what these tests grade.
    - Copy both scenarios into timeline-only scenarios. In the copies, also link I1 to the one-party assertions of the three personas already linked to it (a_002, a_003, a_008, a_009, a_011, a_012), and point the two tests at the copies.
    - Do not edit the originals: mid-research-flynn backs 21 suites, and `ut_person_evidence_027` needs a_011 and a_012 unlinked.
    - Serve the copies a US catalog and a place-id table for Schuylkill, Pennsylvania, United States.
    - Rewrite build-patrick-timeline's gap line to what `timeline_build` writes there: one `high` 1860–1908 gap naming the 1870, 1880 and 1900 United States censuses, then residence. Drop "marriage": no linked assertion names a child of I1, so no marriage gap is written. timeline-with-multi-conflict's "same as the seed test" then follows it.
  - **`geographic-infeasibility`** has the same gap. In `flynn-distant-events`, I1's only live links are a_001, a_004, a_010, a_013 and a_014, so `timeline_build` writes three events ending in 1860, with no 1908 death and no gap.
    - The scenario backs only that test, so edit it in place. Link I1 to a_002, a_003, a_008, a_009, a_011 and a_012, and say so in its README, which the judge reads since there is no judge-brief.md.
    - Serve it the same US catalog and Schuylkill place-id table. Its 25 May / 1 June 1850 pair stays consecutive, and it regains the ~1845 birth, the 1908 death and the 1860–1908 gap.
  - **`england-census-timeline`:**
    - drop the `census-from-wiki` tag and its wiki-read fixtures;
    - serve `timeline_build` an England catalog and a place-id table for Canterbury, Kent, England and its enclosing levels;
    - derive the expected census years from that catalog;
    - rewrite its judge_context.
  - **`impossibility-after-death`:** its judge_context's Mode-C line no longer holds. The delegation is Mode A, so `timeline_build` appends a person timeline beside `t_001`, which is h_001's hypothesis timeline and stays unchanged. Grade the new timeline.
  - **`eval/harness/validators/test_timeline.py`:**
    - delete `test_census_years_read_from_wiki`, or keep it only beside a non-US Mode B test tagged `census-from-wiki`. If it goes, delete `eval/harness/tests/unit/test_timeline_census_wiki_validator.py`'s `check_census_from_wiki` and `_census_year_of_entry` cases with it, and keep that module's two 1890-backstop cases;
    - rewrite `test_us_1890_never_expected`'s attribution, which reads only fetched census pages: with no page read, flag an 1890 census entry only when it names the United States, a US place, or no jurisdiction. Prove it passes "1890 Denmark census" and fails "1890 United States census" on a run with no wiki read;
    - add two tags. `no-project-write` skips `test_positive_produces_timeline` and asserts `research.json` is unchanged. `extraction-calls-<n>` asserts exactly `n` `extraction_append` calls, each carrying `personId`; with `n` = 1, the call falls between two `timeline_build` calls in `tool_calls`.
    - Prove each fails: `no-project-write` on a run that writes a timeline, `extraction-calls-1` on a run with no extraction call and on one with two, and `extraction-calls-0` on a run with one.
    - Put every fail-proof in this plan, these and the research and person-evidence validators', under `eval/harness/tests/unit/`: nothing under `validators/` is collected.
  - **`eval/tests/unit/timeline/rubric.md`:** rewrite "Tool usage — place resolution and distance", "Gap detection" and "Geographic feasibility", so that a Mode A place, distance or census year written by `timeline_build` passes. The ledger rule applies to Mode B only. The opening rule becomes "scored on the value actually written by `timeline_build` or `research_append`".
  - Rewrite the ledger and `place_distance` lines in the judge_context of `build-patrick-timeline`, `geographic-infeasibility`, `impossibility-after-death` and `timeline-with-multi-conflict`.
- [ ] **`eval/tests/unit/timeline/`:**
  - (a1) zero links on the new scenario, whose subject has attachments: one extraction, then events labelled unverified. Tag: `extraction-calls-1`. Its `test_ownership_table` run is the one unit check of the `person_evidence` row's new `extraction_append` entry;
  - (a2) zero links and no attachment, on `empty-project-just-created`: one extraction that writes nothing, then no claim about the person and no write. Tags: `extraction-calls-1`, `no-project-write`;
  - (b) attachment links present (state i) gives events labelled unverified. Tag: `extraction-calls-0`;
  - (c) a hypothesis delegation with zero links, on `first-plan-migration-hypothesis`, gives no write. Tags: `extraction-calls-0`, `no-project-write`.
- [ ] **`eval/tests/unit/research/`:**
  - (a) "create a timeline for <PID>" on the new scenario runs `extraction_append`, then `timeline_build`, and never question-selection or the timeline agent. Stub question-selection and timeline in `execution.stub_skills` (an agent name stubs its spawn), as every positive research test is stubbed; `routes-to:stop` still sees a stubbed hand-off, because the hook records it before denying. Tags: `routing`, `routes-to:stop`, and (b)'s order tag. Do not assert `research_delivered`: whether step mode keeps it is open (`docs/plan/research-step-mode.md`, "Open, for Praise");
  - (b) a job on the new scenario, with question-selection stubbed and `execution.stop_at_stub: true`. A tag-gated validator in `test_research.py` asserts an `extraction_append` call with `personId` and, after it in `tool_calls`, a `timeline_build` call. Prove the validator fails on a run without them.
- [ ] **`eval/tests/unit/question-selection/`:** on state (ii), the first question still restates the objective. Tag it `selection-basis-objective-decomposition` and `objective-scope-match`. It tests the question-selection.md edit above.
- [ ] **`eval/tests/unit/person-evidence/`:**
  - run the test on a copy of state (i) that adds a question q_001 and lists it in the `extracted_for_question_ids` of one attached record's subject assertions only. The delegation names only those ids;
  - load one `same-person-<subject>.json` fixture (`assertionId: "~"`, `treePersonId: <subject>`) whose response is a match (a score and `matched: true`, as in `same-person-flynn-strong.json`). `same_person` carries no record id, so per-record fixtures cannot be told apart;
  - give it a new tag that gates a validator in `test_person_evidence.py`, asserting both halves. Each named assertion gains a new `pe_` with a non-null `match_score`, and its attachment link's `superseded_by` names that `pe_`. Each of the other record's subject assertions gains no `pe_`, and its attachment link keeps `superseded_by` null;
  - prove the validator fails on a run that leaves a named link live, and on a run that re-links the other record.
- [ ] **Run order.** Run person-evidence and question-selection first. Run research last, after the final edit to person-evidence.md, question-selection.md and research/SKILL.md, because research's snapshot embeds both agent bodies.
- Done when: `make engine-test` and `make harness-test` are green, and `make eval-skill SKILL=timeline`, `SKILL=research`, `SKILL=question-selection` and `SKILL=person-evidence` have landed with their annotations, and `check_runlogs.py` passes.

### Acceptance e2e

Before PR D merges, post its worktree path and `make e2e-run TEST=joao-sousa-death` on issue #3516; the lead runs it. PR D's body carries the report, and the tool's spec carries `timeline_build`'s figures. Report:

- the records extracted and the assertions linked;
- the result size and tool time of `extraction_append({ personId })` and of `timeline_build`, and the main-thread turns they add;
- the run's `wall_clock_seconds` and `total_cost_usd`, with the price basis stated;
- the findings grade, and that the leak check passed.

No comparable baseline exists: joao-sousa-death's only committed run predates PR #3312. Say so rather than compare.

## What nothing checks

Before PR D merges, comment each item below on the open `nothing-checks` issue that covers it, or file one with that label, and name the issue here.

- Most of the step in e2e: 46 of 186 starting trees cite an indexed source on the subject, and none of the four panel fixtures does.
- PR B and PR C change graded behaviour while check_runlogs only warns.
- The leak check sees only `1:1:` ARK citations. Once PR #3607 and PR #3517 land, 22 of the 46 fixtures with an indexed attachment on a subject cite no record id at all: ferber-grandparents, ferber-marriage, william-ferber-parents, and the 19 drafts PR #3618 added, until their findings are adjudicated. ferber-marriage's required f1 and f2 cite its attached 1900 census by title, which decision 15 accepts.
- The leak check skips relationship-level refs (decision 11). umbelina-azevedo-death cites three records attached to its subject only through ParentChild refs, so reading relationship refs later would leak them with the check green.
- An item whose positive searches kept no sidecar never completes in code; it goes to Dispose. That was 28 of 613 such items in the committed e2e final states.
- A census that FamilySearch does not hold never produces a gap (decision 14).

## Collisions

- **PR #3616 and PR #3613** (Emruthwill): PR A and PR B, on hold until this plan merges.
- **PR #3583** merged 2026-10-20 (2630a8578). PR C edits its gate, its rung and its two spec texts, which are on main as cited.
- **PR #3564** (open). It edits `replay.py`, where PR C reports `timeline_build`, the `personId` call and PR B's completions and ties as unmodelled, `research-exhaustiveness.md`, which PR B's item 5 reads, and `research-schema-spec.md`. Whichever lands second rebases.
- **PR #3476** (open). It edits `research-append.ts`, `research-append-tool-spec.md`, `research-schema-spec.md` and `research-append.test.ts`, as PR #3613 does. Whichever lands second rebases.
- **Issue #3552:** same score gate, reused-hint code, ADR-0009 constraint and guardrail row. Its step 1 turns PR C's "extracted, not linked" case into a link.
- **PR #3567** (open). It edits the `plans` and `plan_items` callers in `ownership.json`. It also edits `hooks/guard_project_files.py`, `eval/harness/harness/skill_invocation.py`, `docs/skill-dataflow.md` and `docs/architecture.md`, all of them PR C sites. Whichever lands second rebases.
- **PR #3577** (open). It edits `ownership.json`, `research-append.ts`, `test_universal.py`, `test_ownership_manifest.py`, `guard_project_files.py`, `agent-tool-names.test.ts`, and four of the docs PR B and PR C edit. It also adds `rejected_links` and refuses any `person_evidence` append onto a rejected pair, which PR C's link writes meet too. Check it before touching `ownership.json`, and rebase.
- **PR #3612** (draft): it builds PR B's documents-mode citation too. It also rewrites the bounded sentence PR D extends, and edits these PR C and PR D sites:
  - `bounded-ask-not-a-job.json`;
  - `mock_mcp.py`, `skill_invocation.py`, `test_universal.py`, `test_research.py`, `test_mock_mcp.py`;
  - `server.ts`, `smoke-calls.ts`, `no-project.test.ts`;
  - `architecture.md`, `catalog.md`, `skill-dataflow.md`, ADR-0009;
  - `agent-tool-names.test.ts`, `agent-delegation-framing.test.ts`.

  Whichever lands second rebases and re-checks that test.
- **PR #3610 and PR #3605** (open): both edit `validate_fixture.py` and `e2e-test-spec.md` §3.6, which PR A edits.
- **`agents/person-evidence.md` and its suite** are also edited by issue #3552, issue #3363, issue #3544, issue #2537, step mode's PR 2, and PR #3577, which already commits person-evidence run logs. Whichever lands second re-runs `make eval-skill SKILL=person-evidence`. PR D's $7.79 is its own run, and it is owed again if any of these lands after it.
- **`skills/research/SKILL.md`** is also edited by PR #3567, PR #3577, PR #3507, PR #3612, issue #3526, issue #3153, and step mode's prep PRs and PR 2. PRs that edit an agent research names stale it too: PR #3476, PR #3500 and PR #3564. Whichever lands second re-runs research.
- **Issue #3153.** Its hints item completes through search-hints' own lane, not rule 8, because a `person_record_matches` entry has no `record_search` sidecar. It also edits:
  - the `plans` row, `test_ownership_manifest.py`, and `research-schema-spec.md`'s ownership table;
  - `guard_project_files.py`, with its own `make hook-smoke`;
  - `catalog.md`, `skill-dataflow.md` and `agent-tool-names.test.ts`;
  - `question-state.ts`, where PR C edits the `noneLinked` rung.

  Its `plans`-row caller entry would turn PR B's search-hints free cases red; PR B runs them as research instead.
- **Issue #3568:** its opt-in edits stale the research suite. Whichever of it and PR D lands second re-runs research.
- **Issue #3549:** it edits `agents/search-images.md`, whose "or skipped" now meets PR B's refusal (noted on that issue).
- **Step mode** (`docs/plan/research-step-mode.md`): PR B is a prerequisite. Completing items whose searches all found nothing, routing a refused declaration's `in_progress` items to Dispose, and research-plan's Termination are in its research-plan prep PR and PR 2.
  - One of step mode's prep PRs edits `agents/timeline.md`, and its PR 2 edits `person-evidence.md`, `question-selection.md` and `research/SKILL.md`. So all four of PR D's suites overlap, and whichever lands second re-runs them.
  - PR D and step mode's PR 2 land in either order; of this plan's PRs, only PR B gates PR 2. If PR D lands first, PR 2's Priority 3 rewrite deletes PR D's gate and the "Fresh project" timeline sentence PR D adds, and keeps PR D's first-question test passing. If PR 2 lands first, PR D drops its `agents/question-selection.md` edit, because Priority 3 is already gone, and keeps the test. It also adds to the router's setup-step report what the attached records show (events, how many are unverified, the high gaps), which step mode's "What the researcher sees" names and PR 2 had nothing to report from.
- **Issue #3584** (parked): this plan's source reuse does not unblock it.

## Costs

- PR A and PR B owe no paid unit run. PR C owes one `make hook-smoke` and one `make engine-smoke-http`.
- PR D owes four paid runs, about $2.15 for timeline, $5.70 for research, $3.44 for question-selection and $7.79 for person-evidence at the last runs' prices, plus four annotations. Then one e2e run, which the lead does.
- At run time, a job's first pass gains two main-thread tool calls per subject (two in every e2e fixture), plus:
  - `timeline_build`'s catalog fetch, 33–36 s when cold, unless its 1-hour in-process cache is warm;
  - on a subject with attached records, 4.5–7.2 s of record reads for 14–16 records (live, 2026-10-20), and the extraction summary in context.
- A timeline agent spawn on a person with nothing linked adds one `extraction_append` call and a second `timeline_build` call (decision 16).
