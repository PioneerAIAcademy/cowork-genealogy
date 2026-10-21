# Attached records baseline: extract, link and timeline a person in code, and close the plan item

**Status:** PR C is split. C1 (PR #3670, Emruthwill) is everything in § PR C except `timeline_build`, and is in review. C2 (`timeline_build`) and PR D are not started; Gennecis owns them. They build on PR A (PR #3616) and PR B (PR #3613), whose checklists live on those PRs. Work order: issue #3516, which absorbs issue #3525 and issue #3585. Each PR says "Part of issue #3516"; only PR D closes it. Delete this file when PR D merges.

**Priority:** quality, and a prerequisite of step mode, not Beta's speed critical path (lead, 2026-10-20). PR B comes first, because step mode's "not exhaustive" choice, its wrap-up and its one-question rule all need searched plan items closed (`docs/plan/research-step-mode.md`, prerequisites).

## What this builds

- **A baseline step, all code.** `extraction_append({ projectPath, personId })` extracts every indexed record FamilySearch has attached to a person and links each one to that person as `speculative`. `timeline_build({ projectPath, personId })` then builds the person's timeline from those links. No agent runs.
- **Where it runs.** In a /research job, once per subject after init-project and before the first question-selection. "Create a timeline for <PID>" is a bounded ask that runs both and stops. The timeline agent runs `extraction_append` once itself when nothing is linked (decision 16).

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
14. **Census years come from a census table in code, never from the catalog (lead, 2026-10-21).** A census gap means FamilySearch likely holds a record that could be attached and is not. A false `high` gap is worse than a missed one. The catalog cannot tell a fragment from a full census, and the place a collection is filed under is not the area it covers, so `timeline_build` reads the table (§ The census table) and never fetches the catalog. A named list of fragments stays out of the table. A country the table does not list produces no census gap. ADR-0012 is amended to match.
15. **ferber-marriage's f2 stays required.** Its notes keep the attached 1900 census as an anchor the research starts from, so extracting it at setup is the intended path, not a leak.
16. **With nothing linked, the timeline agent extracts once.** When `timeline_build` returns `no_linked_evidence`, the agent calls `extraction_append({ projectPath, personId })` once, then `timeline_build` again. If still nothing is linked, it says that no record yet places the person. It never hands back.
17. **Attached records are checked only on request.** A /research job runs person-evidence on attachment-linked assertions only where the unlinked-proof gate needs it: when a question's assertions have no other live link (project_context's rung, through the router's widened person-evidence row), or when the gate refuses a proof that cites them because none of its supporting assertions has a live link that is not speculative (person-evidence Step 1's refused-proof route). Otherwise they stay speculative, and a proof may cite them beside an assertion whose link is not speculative. The other personas in an attached record are linked only once a question's search re-finds that record (decision 7). Checking them otherwise is a separate request (decision 3).

**One narrowing of the 2026-10-19 ruling, confirmed by the lead on 2026-10-20.** project_context's "none linked → person-evidence" rung ignores only links that carry `ATTACHMENT_LINK_RATIONALE`, not every speculative link. person-evidence itself writes a speculative link when the researcher confirms a weak match, and ignoring those would send the question back to person-evidence to ask again. The unlinked-proof gate still ignores every speculative link.

## PR A and PR B

Both are Emruthwill's, and their checklists live on the PRs.

- **PR A is PR #3616:** the allow-list of attached starting evidence, a leak check that fails when a record an expected finding cites is attached to the fixture's subject and not allow-listed, and the record-hint tree guard. PR D's acceptance run reads its allow-list.
- **PR B is PR #3613:** `extraction_append` completes the plan item behind the records it extracts, and a question that finds a record already extracted claims it (decisions 6–9). PR C lands after it.

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
  - skip an assertion whose (assertion, person) pair `rejected_links` names (`isRejectedPair`, `src/utils/rejected-links.ts`), and count it in the summary;
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

### The census table

The developer has Claude fill the table, from the live catalog (`dev/probe-census-placeids.ts` lists every single-year census collection with its record count) and what it knows of each country's censuses. It covers every country in North America, South America, Europe and Australia with an indexed FamilySearch census, which may be more than 25. It is a good guess, fixed row by row as rows prove wrong (lead, 2026-10-21).

- [ ] **`src/data/census-table.ts`**, a typed constant, so it needs no file read. One row per census a FamilySearch index covers:
  - `year`;
  - `label`, the jurisdiction named in the gap ("United States", "New York", "Canada");
  - `covers`, the standard-place suffix it covers ("United States", "New York, United States"). A national census FamilySearch holds only in part is one row per province or state it covers;
  - `collection_id`, the FamilySearch collection holding its index;
  - `heads_only`, true where the census names only the head of household (US 1790–1840).
- [ ] **Which rows.** A census with no indexed FamilySearch collection gets no row. Countries elsewhere get rows later.
- [ ] **The named fragment list** sits beside the table: US 1890; Ireland 1821, 1831, 1841 and 1851; New South Wales 1841. A Vitest case fails when any table row names a listed year for its place.
- [ ] **`dev/check-census-table.ts`** checks every row against the live catalog: its `collection_id` exists, its record count is above 0, and its title names the row's year. Run it when the table changes, and record the run in the PR body. No CI job runs it.
- [ ] **What the live catalog showed on 2026-10-21** (`dev/probe-census-placeids.ts`, PR #3670), for the spec:
  - Record counts do not separate fragments from full censuses. US 1790 is 0.26% of the US maximum and the US 1890 veterans schedule 0.55%, while Ireland 1821 is 6.27% and England and Wales 1851, a partial index, 4.09%.
  - The filing place is not the coverage. About ten French département censuses are filed under France's id; Canada's national 1871, 1881, 1891, 1901 and 1911 censuses are each filed under one province (Ontario, British Columbia, New Brunswick, Northwest Territories, Nova Scotia).
  - Six Fribourg years, Denmark 1834, Albania 1930 and Slovakia 1869 have no indexed records.
- [ ] **Correct `collections-search-tool-spec.md`'s** "Place ID mismatch (design note)" and Key API details bullet: `searchMetadata.placeIds` are the Primary ids `standardPlaceToPlaceId` returns (Alabama 33, Ohio 43, New York 22, England 1986340), and a filing place is not a coverage area.

### `timeline_build({ projectPath, personId })`

- [ ] **Add the tool** in `src/tools/timeline-build.ts`. It does the timeline agent's Mode A Steps 2–4 and 7 in code. Also add:
  - its schema in `allToolSchemas` (`src/tool-schemas.ts`), its dispatch arm in `src/server.ts`, and its name in `manifest.json` `tools`;
  - its name in `OK_FALSE_IS_FAILURE` (`src/tool-result.ts`), with the `server.ts` arm returning `writerToolResult(…)`. `no_linked_evidence` returns `ok: true`;
  - `NoProjectError` → `noProjectResult()`, and a `CALLS` row in `tests/tools/no-project.test.ts`;
  - not in `FS_TOOLS` (`apps/server/proto/worker/options.py`): it needs no FamilySearch token, since it reads no catalog and the Places calls are anonymous;
  - a row in `dev/smoke-calls.ts`, `src/types/timeline-build.ts`, `dev/try-timeline-build.ts`, a new `docs/specs/timeline-build-tool-spec.md`, and a `docs/catalog.md` entry.
- [ ] Resolve `personId` with the shared `findAnchor`.
- [ ] **Events come from live `person_evidence` links only** (`superseded_by` null). Never use a tree fact or `diedByYear`.
  - Merge the assertions one record makes about one event into a single event, listing every id in `assertion_ids`.
  - Every linked assertion with a date makes or joins an event, whatever its `fact_type`. One whose `fact_type` has no event type in timeline.md Step 3, such as `relationship`, joins its record's event with the same date, or else makes an `other` event. mid-research-flynn's a_010 is its record's only 1860 assertion.
  - An undated linked assertion joins the event its record and party (`record_persona_id`, else `record_role`) make for the same `fact_type`. Code extraction splits a derived birth into a place half and a date half (`record-extract.ts`), and this joins them. One that joins no event makes none.
  - Event types, the date-certainty subset, the before/after conversion and the sort key follow timeline.md Step 3.
  - **Dates are written year-first:** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Pass the assertion's `date` through `stdDate` (`src/utils/date-standardize.ts`) and parse the result with `parseSingle` (`src/utils/date-helpers.ts`, exported for this), which gives its modifier, day, month and year; `getDayRange` widens `Abt 1845` to 1844–1846 and gives no parts. Prefix `~` when the date reads `Abt` or the assertion's `date_certainty` is `approximate`. A `Bet X and Y` date is written `YYYY-YYYY` from its two years, timeline.md Step 3's range form, and takes `date_certainty` `estimated`. A date `stdDate` returns `""` for counts as undated. Events sort by that string with a leading `~` ignored, which is how `test_events_chronologically_ordered` compares them. The record's own wording ("12 March 1908") sorts before "1850" as text, so it stays in `description`. Say so in `timeline-build-tool-spec.md`, and in `research-schema-spec.md`'s note that event dates are as encountered in records.
  - Copy `standard_place` from the event's assertions. When none carries one, resolve an assertion's `place` text once per distinct place.
  - Set `distance_from_previous_km` with `haversineDistance` (`src/tools/distance.ts`). Look up coordinates with `lookupPlaceCoords` (`src/utils/place-coords.ts`), passing the time left to the deadline as its budget. It looks each distinct place up once and takes an injectable `PlaceCoordsResolver` the mock handler can serve. Compute each unordered pair once. A place that does not resolve leaves the distance null.
  - If every link behind an event is `speculative`, start its `description` with "Unverified attachment:" when every rationale is `ATTACHMENT_LINK_RATIONALE`, and with "Unverified:" otherwise.
  - **A resolved conflict with a winner** (`resolution_kind: "competitor"`, or no kind and a non-null `preferred_assertion_id`, the shape of a conflict resolved before the kind existed): keep the preferred assertion, drop the conflict's other competing assertions from the events, and set `conflict_ids`, as timeline.md Step 7 says.
  - **Any other resolved conflict** (a deferral with no preferred assertion, or `tree` or `synthesis`): drop nothing, and treat its events as for an unresolved conflict, with a `conflict_note` quoting `resolved_value` when set, else `resolution_rationale`. 12 of the 69 resolved conflicts in the committed e2e final states name no preferred assertion. **A `moot` conflict** marks nothing.
  - **An unresolved conflict:** put its id in `conflict_ids` on every event that cites one of its `competing_assertion_ids`. When a competing assertion is on no event, for example a name-only identity conflict like flynn-multi-conflict's c_002 on a_001, put it on each event built from that assertion's `record_id` and `record_role`. Write a code-built `conflict_note`. For an identity conflict (`isIdentityConflict`, `question-state.ts`) it quotes the `identity_question`; otherwise it names the other competing assertions and their values.
- [ ] **Gaps.** Copy `start` and `end` from the bounding events, and never pad them. The tool writes four kinds:
  - **Census, `high`.** A census year in which any event falls is in hand, whatever the event's type. Each other year the rules below expect is one `expected_events` entry. It names the year and the table row's jurisdiction label just before "census" ("1870 United States census", "1855 New York census", "1890 Denmark census"), so that `timelineCensus1890Invariants` keeps a non-US 1890 census. When a national row and a state or provincial row both cover a year, use the national label.
    - **Which years:** judge them per interval, strictly between consecutive events that carry a `standard_place`. A year inside an interval counts only when both events are in the same country (the last comma segment) and a table row for that year covers the earlier event's place. A row covers a place when its `covers` value is one of that place's comma suffixes, compared as standard-place text. A year between events in two countries expects no census; the 20-year rule covers a long gap there. The span ends at the last record-backed event, or at a linked death.
    - **Heads-only years.** A row marked `heads_only` is expected only when the tree person is male and a linked birth event puts him at 21 or older that year. With no linked birth, the year is not expected.
    - **The 1890 check.** Before the write, test each census `expected_events` entry with `timelineCensus1890Invariants` (`research-append.ts`). Drop any entry it refuses, note the drop in that gap's `notes`, and drop a gap left with no entry. Otherwise one refused entry refuses the whole timeline write.
  - **Marriage, `high`.** A linked assertion names a child of the person, and no marriage event comes before the first child's birth.
  - **Twenty or more years between consecutive events, `high`.**
  - **Death without burial, or burial without death, `medium`.**

  Every gap names what fills it, and none has an empty `expected_events`. A 20-year gap whose two events both lie at or between one census gap's two bounding events folds into that census gap: one `high` gap with the census gap's `start` and `end`, listing its missing census years, then "residence". A 20-year gap that starts at a census gap's `end` event, or ends at its `start` event, stays separate. The two rules walk different events, since only the census rule skips an unplaced one. A 20-year gap with no census year names "residence" alone. The marriage gap names "marriage", and the death/burial gap names the missing one, as timeline.md Step 4 says.

  Question-selection reads only `high` gaps.
- [ ] **`tree_gaps` and `collectionCoverage` are unchanged.** Do not change the tool descriptions of `collections_search`, `tree_gaps`, `person_warnings` or `record_read`. Each blocks the suites that serve it from fixtures, under check_runlogs' rule 2c.
- [ ] **ADR-0012:** amend its Decision, "What stays in the plugin" and Last updated. `timeline_build` takes census years from the census table in code, with a named fragment list, and never from the catalog or the wiki. The wiki read stays the agent's for Mode B.
- [ ] **Budget.** One deadline of about 50 s, under Cowork's 60 s per-call cap. Every Places leg (raw place text, coordinates) starts as soon as its input is known and must finish by it. A lookup still open then answers null: an event with no `standard_place` is checked for no census year, its distance is null, and `summary` names the checks it skipped. Record cold and warm tool time in the spec.
- [ ] **Write** through `researchAppend`. With no person timeline yet, append one. Otherwise update this person's timeline (the one with no `hypothesis_id`) in place, and restamp `generated`. Never touch a hypothesis timeline. Every event cites assertions, so PR #3573's warning for events that cite no record never fires on these.
- [ ] **Ownership.**
  - In `ownership.json`'s `timelines` row, add `timeline_build` to `writerTools` and `toolAuthorized`, and name it in `requires` and `remedy`.
  - In `research-schema-spec.md`'s ownership table, the `timelines` row gains `timeline_build` (person timelines, by tool identity), and so does `skill-dataflow.md`'s "Who may write what" `timelines` row.
  - `test_universal.py`'s tool-identity arms are written for merge_tree_persons and extraction_append only, so add a `timeline_build` arm. Appending a person timeline and updating the person's own timeline pass, and editing a hypothesis timeline fails. No committed unit run reaches the arm: `test_ownership_table` skips every stubbed run, every research test is stubbed, and the timeline suite's subject owns `timelines`. Its free cases are its check.
  - Add `timeline_build` to `PROJECT_WRITER_TOOLS` in `test_universal.py`, with a free case beside `test_hand_edit_detector_passes_when_writer_tool_called` (`eval/harness/tests/unit/test_validator_runner.py`). After PR D, a Mode A timeline run's only writer is `timeline_build`.
  - Add it to `UNMODELLED_WRITERS` in `eval/harness/harness/replay.py`. Also report as unmodelled every `extraction_append` call the replay cannot apply whole: a `personId` call, any call whose `args` carry `questionIds`, which can tie a re-found record, and any call whose response carries `planItems`. Neither main's generic path, which reads a call with no `ops` as one log entry, nor PR #3564's log-id read-back applies PR B's completions and question ids. Make `replay_remnant` (`eval/harness/scripts/prune_runlogs.py`) keep a `planItems` marker, as it keeps `no_project`, with a case in `eval/harness/tests/unit/test_strip_e2e_captures.py`; otherwise the 14-day strip drops it.
- [ ] **Nothing linked:** write nothing, and return `status: "no_linked_evidence"`, `ok: true` and the `summary` "No record yet places this person; no timeline was written." The bounded ask and the timeline agent both relay it.
- [ ] **Return** `{ ok, status, timelineId, events, unverifiedEvents, gaps: { high, medium, low }, summary }`. `summary` is one code-written sentence the main thread relays. It gives how many events there are, how many come from unchecked attachments and how many `high` gaps, and says that checking the attachments is a separate request. It also says the census years expected are those FamilySearch has indexed, and names any country in the timeline the census table does not list as one where no census was checked (decision 14).
- [ ] **Unit harness.** `timeline_build` is a live tool, served like `extraction_append`.
  - Add it to `LIVE_TOOLS` and to `LIVE_MODULES` in `eval/harness/harness/instrument.py`; `test_instrument.py` asserts the two match. Also add it to `OK_FALSE_IS_FAILURE_LIVE` in `mock_mcp.py`, and to its docstring's live-tool list.
  - Add a `_make_timeline_build_handler` in `mock_mcp.py`, dispatched from `_make_live_handler`. It runs the compiled tool against the workspace with injected deps:
    - raw place text resolves to the first result's `standardPlace` from the test's `place_search` fixture whose predicate matches it as `placeName`, as `_place_table` does for `project_create`;
    - coordinates come from those same fixtures (`latitude`/`longitude`);
    - census years come from the compiled table, as in production;
    - anything absent answers null (no `standard_place`, null distance), and the handler never makes a request.
  - Free cases in `test_mock_mcp.py`: one attachment link yields one event; no link yields `no_linked_evidence` and no write.
  - Joining `LIVE_TOOLS` moves `tools.live` for every suite, which check_runlogs only warns on.
- [ ] **Vitest** (`tests/tools/timeline-build.test.ts`):
  - a tree id and a FamilySearch id both resolve;
  - a tree fact with no link becomes no event;
  - one record's assertions about one event merge into one event;
  - both unverified prefixes;
  - an unresolved conflict puts `conflict_ids` and a note on each competing event, a name-only identity conflict marks the events of its persona's record, and an identity conflict's note quotes its `identity_question`;
  - a resolved conflict with no preferred assertion keeps its competing events, each carrying its id;
  - a census gap names its year and its table row's label, and a year with no row is not expected;
  - a New York interval spanning 1855 expects "1855 New York census", never "1855 United States census";
  - on england-census-timeline's links, 1841, 1861 and 1871 are expected and 1851 is not; on the links PR D's flynn copy carries, a_010 makes the 1860 event, and the 1860–1908 interval expects 1870, 1880 and 1900 only;
  - `extractRecord` on `tests/fixtures/record-extract/census-1870-no-relationship-column.json` (p_260900945: Birth 1845 Pennsylvania, Census 1870 Carbon, Pennsylvania) gives one birth event placed in Pennsylvania, and with the 1870 census as the next placed event, 1850 and 1860 are expected;
  - Ohio events in 1850 and 1880 expect the 1860 and 1870 censuses; an 1852 Madeira event and an 1890 São Paulo event expect neither country's census between them;
  - Danish events in 1885 and 1893 and a later US event keep "1890 Denmark census";
  - a placed 1850 event, an unplaced 1852 event and a placed 1880 event give one `high` 1850–1880 gap naming the 1860 and 1870 censuses, then "residence", and no gap has an empty `expected_events`;
  - placed US events in 1845, 1870 and 1905 give two `high` gaps, 1845–1870 naming the 1850 and 1860 censuses and 1870–1905 naming the 1880 and 1900 censuses, each then "residence", and no 1845–1905 gap;
  - assertions dated "abt 1845", "1850" and "12 March 1908" give event dates "~1845", "1850" and "1908-03-12", in order once a leading `~` is ignored;
  - "between 1836 and 1848" gives an event dated "1836-1848" with certainty `estimated`, and an assertion dated "17 May" joins its record and party's event of the same `fact_type` or makes none;
  - two events in a country the table does not list give no census gap, and a summary naming that country as unchecked;
  - a Places lookup that never answers leaves its census years and distances out, and the call still returns before the deadline;
  - against the table:
    - Ohio gets the federal years, and a state census year counts for a place in that state, never for a place in another state;
    - a US man born 1800 expects 1830 and 1840; a US woman, and a man with no linked birth, expect neither;
    - Ireland expects 1901 and 1911, and never 1821–1851;
    - an Ontario place expects the 1891 Canada census;
  - a US subject alive across 1890: the timeline is written, and no entry names an 1890 census;
  - a raw `place` with no `standard_place` is resolved;
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
- [ ] When `timeline_build` wrote a timeline, `summary_for_user` gives the tool's `unverifiedEvents` count, and says that checking the attached sources is a separate request, and relays the tool's census sentence. On `no_linked_evidence`, `summary_for_user` is the tool's summary alone.
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
- [ ] **If step mode's PR 2 is already on main** (Collisions): the setup step's report relays each subject's `timeline_build` summary, the attached-records line that step mode's "What the researcher sees" setup row names.
- [ ] **`allowed-tools`:** add `timeline_build`, beside `extraction_append`.
- [ ] **research/SKILL.md never names `@plugin:timeline`,** so a timeline.md edit keeps staling only the timeline suite.
  - Add `["research -> timeline", ""]` to `PROSE_MENTIONS` in `tests/packaging/agent-delegation-framing.test.ts`. Its tokenizer reads `timeline_build` and "a timeline for a person" as naming the agent.
  - Keep "**always the agent, never inline.**" in the person-evidence row verbatim; that test pins it.
- [ ] **The "Assertions not yet linked to persons" row:**
  - keep its trigger, scoped to a question's assertions with no live link, and widen it with "or `project_context`'s `nextStep` for a question names person-evidence". Either way, spawn `@plugin:person-evidence` with that question's assertion ids in a linking request. person-evidence, which carries the quote, tells the attachment links apart, so no router text quotes the constant;
  - add one exception to its "You never write `person_evidence` entries… Extraction never links; its output ALWAYS flows through person-evidence next": `extraction_append({ personId })` writes speculative attachment links, and its output, which carries no question ids, goes to `timeline_build` next, never to person-evidence.

  A question whose assertions include a live link that is not an attachment link gets no rung. Its attachment-only assertions stay speculative unless the gate refuses a proof that cites them (decision 17). The scoping keeps both routing tests below: pe7's and szk's unlinked assertions all carry their question's id.
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
  - rewrite "`timelines` stays empty unless the main thread delegates to it on a hand-back": a job now writes a person timeline, through `timeline_build`, before its first question-selection for each subject with a linked record (in practice, an indexed attachment). For any other subject, `timelines` stays empty unless the main thread delegates to the agent.

  Also rewrite the first sentence of `ownership.json`'s `timelines` notes, which counts zero e2e writes and says no e2e run has ever routed to it.

### `agents/question-selection.md`

- [ ] **Priority 3 fires only once a question at the objective's scope exists,** in both its table row and its detail paragraph. Otherwise the job row's timeline, written before the first question-selection, sends the first question to a census year: the ladder ranks Priority 3 above Priority 4, and the fresh-project default applies only with "no clear gaps".
  - Rename the "Fresh project, no clear gaps" edge case to "Fresh project", and add that a timeline's gaps never displace Priority 4 there. Keep its decomposition and premise-verification rules.
  - `ut_question_selection_006` still holds, because flynn-census-exhausted's q_001 is at the objective's scope. No open PR edits this file; step mode's PR 2 also rewrites Priority 3, in either order (Collisions).
  - This stays prose: which question restates the objective is a judgement the decomposition and premise rules make.

### Tests and fixtures

- [ ] **A new scenario** under `eval/fixtures/scenarios/`, with `project.objective`, `project.subject_person_ids: [<subject>]` and a README. Its subject has tree facts, two person-level `1:1` sources, one memory source, no assertions and no questions.
  - Its two `record_read` fixtures use `p_…` persona ids, with the ARK only in `persons[].ark`.
- [ ] **Two more states:**
  - (i) the same project after the step, its subject's assertions linked by speculative rows carrying `ATTACHMENT_LINK_RATIONALE`, for timeline (b);
  - (ii) an objective, no questions, and a person timeline with a `high` gap whose events cite linked assertions, for the question-selection test.
- [ ] **Rework the existing timeline suite for Mode A in code:**
  - **`build-patrick-timeline` and `timeline-with-multi-conflict`.** In `mid-research-flynn` and `flynn-multi-conflict`, I1's birth, residence and death assertions are unlinked, so a links-only tool cannot build what these tests grade.
    - Copy both scenarios into timeline-only scenarios. In the copies, also link I1 to the one-party assertions of the three personas already linked to it (a_002, a_003, a_008, a_009, a_011, a_012), and point the two tests at the copies.
    - Do not edit the originals: mid-research-flynn backs 21 suites, and `ut_person_evidence_027` needs a_011 and a_012 unlinked.
    - Rewrite build-patrick-timeline's gap line to what `timeline_build` writes there: one `high` 1860–1908 gap naming the 1870, 1880 and 1900 United States censuses, then residence. Drop "marriage": no linked assertion names a child of I1, so no marriage gap is written. timeline-with-multi-conflict's "same as the seed test" then follows it.
  - **`geographic-infeasibility`** has the same gap. In `flynn-distant-events`, I1's only live links are a_001, a_004, a_010, a_013 and a_014, so `timeline_build` writes three events ending in 1860, with no 1908 death and no gap.
    - The scenario backs only that test, so edit it in place. Link I1 to a_002, a_003, a_008, a_009, a_011 and a_012, and say so in its README, which the judge reads since there is no judge-brief.md.
    - Its 25 May / 1 June 1850 pair stays consecutive, and it regains the ~1845 birth, the 1908 death and the 1860–1908 gap.
  - **`england-census-timeline`:**
    - drop the `census-from-wiki` tag and its wiki-read fixtures;
    - derive the expected census years from the census table;
    - rewrite its judge_context.
  - **`impossibility-after-death`:** its judge_context's Mode-C line no longer holds. The delegation is Mode A, so `timeline_build` appends a person timeline beside `t_001`, which is h_001's hypothesis timeline and stays unchanged. Grade the new timeline.
  - **`eval/harness/validators/test_timeline.py`:**
    - delete `test_census_years_read_from_wiki`, or keep it only beside a non-US Mode B test tagged `census-from-wiki`. If it goes, delete `eval/harness/tests/unit/test_timeline_census_wiki_validator.py`'s `check_census_from_wiki` and `_census_year_of_entry` cases with it, and keep that module's two 1890-backstop cases;
    - rewrite `test_us_1890_never_expected`'s attribution, which reads only fetched census pages. With no page read, read the entry's jurisdiction as `timelineCensus1890Invariants` does: its US regexes, `TIMELINE_NAMES_OTHER_JURISDICTION_RE`, and the words of the timeline's US-placed events. Flag the entry unless it names a jurisdiction outside the United States. Unlike the engine, flag an entry naming no jurisdiction whether or not an event is in the US, as the kept `1890_census` case requires. Prove it passes "1890 Denmark census" and fails "1890 United States census", "1890 Federal census" and, on a Pennsylvania timeline, "1890 Pennsylvania census", on a run with no wiki read;
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
  - (b) a job on the new scenario, with question-selection stubbed and `execution.stop_at_stub: true`. A tag-gated validator in `test_research.py` asserts an `extraction_append` call with `personId` and, after it in `tool_calls`, a `timeline_build` call. Prove the validator fails on a run without them. Tag it `routing` and `routes-to:question-selection` too, as `route-no-questions` is, so that a person-evidence spawn before question-selection fails `test_routes_to_expected_skill`.
- [ ] **`eval/tests/unit/question-selection/`:** on state (ii), the first question still restates the objective. Tag it `selection-basis-objective-decomposition` and `objective-scope-match`. It tests the question-selection.md edit above.
- [ ] **`eval/tests/unit/person-evidence/`:**
  - run the test on a copy of state (i) that adds a question q_001 and lists it in the `extracted_for_question_ids` of one attached record's subject assertions only. The delegation names only those ids;
  - load one `same-person-<subject>.json` fixture (`assertionId: "~"`, `treePersonId: <subject>`) whose response is a match (a score and `matched: true`, as in `same-person-flynn-strong.json`). `same_person` carries no record id, so per-record fixtures cannot be told apart;
  - give it a new tag that gates a validator in `test_person_evidence.py`, asserting both halves. Each named assertion gains a new `pe_` with a non-null `match_score`, and its attachment link's `superseded_by` names that `pe_`. Each of the other record's subject assertions gains no `pe_`, and its attachment link keeps `superseded_by` null;
  - prove the validator fails on a run that leaves a named link live, and on a run that re-links the other record.
- [ ] **Run order.** Run person-evidence and question-selection first. Run research last, after the final edit to question-selection.md and research/SKILL.md, because research's snapshot embeds question-selection's full body (`ut_research_rpn` runs it live). It holds only person-evidence's frontmatter, so a body-only edit to person-evidence.md after the research run does not stale it; a `description` or `tools` edit does.
- Done when: `make engine-test` and `make harness-test` are green, and `make eval-skill SKILL=timeline`, `SKILL=research`, `SKILL=question-selection` and `SKILL=person-evidence` have landed with their annotations, and `check_runlogs.py` passes.

### Acceptance e2e

Before PR D merges, post its worktree path and `make e2e-run TEST=joao-sousa-death` on issue #3516; the lead runs it. PR D's body carries the report, and the tool's spec carries `timeline_build`'s figures. Report:

- the records extracted and the assertions linked;
- the result size and tool time of `extraction_append({ personId })` and of `timeline_build`, and the main-thread turns they add;
- the run's `wall_clock_seconds` and `total_cost_usd`, with the price basis stated;
- the findings grade, and that the leak check passed;
- that no person-evidence spawn ran between the setup calls and the first question-selection (decision 17).

No comparable baseline exists: joao-sousa-death's only committed run predates PR #3312. Say so rather than compare.

## What nothing checks

Before PR D merges, comment each item below on the open `nothing-checks` issue that covers it, or file one with that label, and name the issue here.

- Most of the step in e2e: 46 of 186 starting trees cite an indexed source on the subject, and none of the four panel fixtures does.
- PR C changes graded behaviour while check_runlogs only warns.
- A census FamilySearch indexes after the table was written produces no gap until someone adds its row, and a country the table does not list produces none at all (decision 14).
- The table's collection ids are checked only by `dev/check-census-table.ts`, which no CI job runs.

## Collisions

- **PR #3564** edits `replay.py`, where PR C reports `timeline_build`, the `personId` call and PR B's completions and ties as unmodelled, and `research-schema-spec.md`. Whichever lands second rebases.
- **PR #3476** edits `research-append.ts`, `research-append-tool-spec.md`, `research-schema-spec.md` and `research-append.test.ts`, as PR C does. Whichever lands second rebases.
- **Issue #3552:** same score gate, reused-hint code, ADR-0009 constraint and guardrail row. Its step 1 turns PR C's "extracted, not linked" case into a link.
- **PR #3567** edits the `plans` and `plan_items` callers in `ownership.json`. It also edits `hooks/guard_project_files.py`, `eval/harness/harness/skill_invocation.py`, `docs/skill-dataflow.md` and `docs/architecture.md`, all of them PR C sites. Whichever lands second rebases.
- **PR #3612** rewrites the bounded sentence PR D extends, and edits these PR C and PR D sites:
  - `bounded-ask-not-a-job.json`;
  - `mock_mcp.py`, `skill_invocation.py`, `test_universal.py`, `test_research.py`, `test_mock_mcp.py`;
  - `server.ts`, `smoke-calls.ts`, `no-project.test.ts`;
  - `architecture.md`, `catalog.md`, `skill-dataflow.md`, ADR-0009;
  - `agent-tool-names.test.ts`, `agent-delegation-framing.test.ts`.

  Whichever lands second rebases and re-checks that test.
- **`agents/person-evidence.md` and its suite** are also edited by issue #3552, issue #3363, issue #3544, issue #2537 and step mode's PR 2. Whichever lands second re-runs `make eval-skill SKILL=person-evidence`. PR D's $7.79 is its own run, and it is owed again if any of these lands after it.
- **`skills/research/SKILL.md`** is also edited by PR #3567, PR #3507, PR #3612, issue #3526, issue #3153, and step mode's prep PRs and PR 2. A PR that edits any agent's frontmatter stales it too, and so does a body edit to an agent a research test runs live (research-plan, question-selection, research-exhaustiveness, search-images). Whichever lands second re-runs research.
- **Issue #3153.** Its hints item completes through search-hints' own lane, not rule 8, because a `person_record_matches` entry has no `record_search` sidecar. It also edits:
  - the `plans` row, `test_ownership_manifest.py`, and `research-schema-spec.md`'s ownership table;
  - `guard_project_files.py`, with its own `make hook-smoke`;
  - `catalog.md`, `skill-dataflow.md` and `agent-tool-names.test.ts`;
  - `question-state.ts`, where PR C edits the `noneLinked` rung.
- **Issue #3568:** its opt-in edits stale the research suite. Whichever of it and PR D lands second re-runs research.
- **Step mode** (`docs/plan/research-step-mode.md`): PR B is a prerequisite. Completing items whose searches all found nothing, routing a refused declaration's `in_progress` items to Dispose, and research-plan's Termination are in its research-plan prep PR and PR 2.
  - One of step mode's prep PRs edits `agents/timeline.md`, and its PR 2 edits `person-evidence.md`, `question-selection.md` and `research/SKILL.md`. So all four of PR D's suites overlap, and whichever lands second re-runs them.
  - PR D and step mode's PR 2 land in either order; of this plan's PRs, only PR B gates PR 2. If PR D lands first, PR 2's Priority 3 rewrite deletes PR D's gate and the "Fresh project" timeline sentence PR D adds, and keeps PR D's first-question test passing. If PR 2 lands first, PR D drops its `agents/question-selection.md` edit, because Priority 3 is already gone, and keeps the test. It also adds to the router's setup-step report what the attached records show (events, how many are unverified, the high gaps), which step mode's "What the researcher sees" names and PR 2 had nothing to report from.
- **Issue #3584** (parked): this plan's source reuse does not unblock it.

## Costs

- PR C owes one `make hook-smoke` and one `make engine-smoke-http`, and no paid unit run.
- PR D owes four paid runs, about $2.15 for timeline, $5.70 for research, $3.44 for question-selection and $7.79 for person-evidence at the last runs' prices, plus four annotations. Then one e2e run, which the lead does.
- At run time, a job's first pass gains two main-thread tool calls per subject (two in every e2e fixture), plus:
  - `timeline_build`'s Places lookups, with no catalog fetch;
  - on a subject with attached records, 4.5–7.2 s of record reads for 14–16 records (live, 2026-10-20), and the extraction summary in context.
- A timeline agent spawn on a person with nothing linked adds one `extraction_append` call and a second `timeline_build` call (decision 16).
