# Attached records baseline: extract, link and timeline a person in code, and close the plan item

**Status:** Not started. Work order: issue #3516, which absorbs issue #3525 and issue #3585. One senior developer. Each PR says "Part of issue #3516"; only PR D closes it. Delete this file when PR D merges.

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
4. The timeline is built in code by `timeline_build`. The timeline agent keeps travel feasibility, chronology anomalies and hypothesis mode (Mode B).
5. "Create a timeline for <PID>" is a bounded ask. A /research job runs the step and `timeline_build` before its first question-selection.

Carried from issue #3525 (lead, 2026-10-19):

6. An `in_progress` item completes once ANY of its plan-tied positive or partial searches has an extracted record. One extraction meets "evidence in hand" (lead, 2026-08-23).

Added (lead, 2026-10-20):

7. **A question claims a record extracted before it existed.** When `extraction_append` is asked to extract a record it already has, and the call carries `questionIds`, it adds those ids to that record's assertions. Ids only grow.
8. **Completion is read off the saved search results.** An `in_progress` item on an active plan completes when any of its plan-tied positive or partial `record_search` entries lists, in its sidecar (`results[].recordId`), a record that now has an assertion. That covers fresh extractions, reused reads, re-sends, and a record two items both found. Tagging the fresh `record_read` entry with the item's id (issue #3525, Part 1.2) is not built.
9. **A search that ran is never marked skipped.** `research_append` refuses `skipped` on an item that has a plan-tied search entry that ran: a `record_search`, `fulltext_search` or image search with any outcome but `error`, or an `external_site` entry with `capture_received: true`. Completing an item whose searches all found nothing is research-plan's Dispose, widened in the step-mode plan.
10. **ADR-0006 is amended.** A mode may reach a further section only where code composes the whole entry. `extraction_append` writes `person_evidence` only in `personId` mode (speculative, null score, the fixed rationale), plan-item status only `in_progress` → `completed` under rule 8, and assertions only by growing `extracted_for_question_ids`. No input field reaches any of these writes.
11. **Relationship-level attachments are never linked**, because 32 of 42 in the e2e trees name the other party. They are not extracted for now either. The step reads person-, name- and fact-level refs, and so does the leak check.
12. **The acceptance run is joao-sousa-death.** It is adjudicated, and its three attached records that findings cite are starting evidence (PR A). carel-kolbe-death is still a draft pending adjudication (PR #3517).
13. **maria-bracero-marriage's f2 becomes non-required.** Her attached 1973 death record answers it without the hint. The required marriage finding still needs the hint.

One narrowing of the 2026-10-19 ruling, confirmed by the lead on 2026-10-20: project_context's "none linked → person-evidence" rung ignores only links that carry `ATTACHMENT_LINK_RATIONALE`, not every speculative link. person-evidence itself writes a speculative link when the researcher confirms a weak match, and ignoring those would send the question back to person-evidence to ask again. The unlinked-proof gate still ignores every speculative link.

## PR A — the allow-list and two fixture guards

Free tier. Start now. A genealogist reviews the reason lines.

- [ ] `eval/tests/e2e/maria-bracero-marriage/expected-findings.json`: set f2 `required: false`, and add one README line saying why (decision 13).
- [ ] `eval/tests/e2e/attached-evidence-allowlist.json` (new): `{ "<fixture>": { "<bare 1:1 id>": "<reason>" } }`, with the 12 entries below. Use the bare record id, never the tree source id.
- [ ] **Leak check** (a pytest under `eval/harness/tests/unit/`, run by `make harness-test`). For every `eval/tests/e2e/*/` fixture:
  - fail when a `1:1:` record id cited in `expected-findings.json` is the `url` of a source attached to a `subject_person_ids` person in `starting-tree.gedcomx.json` by a person-, name- or fact-level ref, unless the allow-list names that id for that fixture;
  - match the `1:1:<id>` token, not a substring of the file;
  - fail on a stale entry: an allow-listed id that is no longer attached or no longer cited.
- [ ] **Record-hint equality in CI.** `eval/harness/tests/unit/test_e2e_fixture_corpus.py` fails a `"genre": "record-hint"` fixture whose `starting-tree.gedcomx.json` differs from `unstripped-tree.gedcomx.json`. It is the comparison `author.py validate` makes. All 95 record-hint fixtures pass it today.
- [ ] Prove each guard both ways:
  - a cited id planted on a subject fails, naming the fixture and the id;
  - an allow-listed id, and a cited id attached only to a relative, pass;
  - a stale allow-list entry fails;
  - a stripped scratch copy fails the equality check, and a reformatted one passes.
- Done when: `make harness-test` and `make e2e-validate` exit 0, and `git diff --stat` shows only these files.

Reason lines. These are drafts from the 2026-10-20 review; check each against its fixture's README.

| fixture | id | reason |
|---|---|---|
| fernando-suarez-marriage | 6DDW-L7XF | Fernando's persona in daughter Julia Rosa's 1896 baptism. f1 needs the 1891 hint marriage QG2B-LVHQ. This record also answers non-required f2, the bride's parents. |
| grigory-kokosha-death | FNGV-JL3 | Grigory's 1843 marriage. f1 needs the 1846 hint death KX55-44K. |
| grigory-kokosha-death | KXPB-DG6 | Daughter Anna's 1844 baptism. f1 needs the 1846 hint death KX55-44K. |
| joao-sousa-death | 6NGD-BL9Q | The subject's own 1852 baptism; the index names only his mother. f1 turns on the 1919 hint death 6YP6-D37M (copy 6B9P-F8GR). |
| joao-sousa-death | X911-WXWP | The elder namesake brother's 1865 marriage: evidence for f1's competing candidate. f1 still turns on the 1919 hint death. |
| joao-sousa-death | X91B-LBSN | The elder brother's son Francisco's 1905 marriage, in the same role as X911-WXWP. |
| maria-bracero-marriage | QVJX-8L5R | Maria's 1973 death registration, which names her father. It answers only f2, non-required since 2026-10-20. f1 still needs the 1907 hint marriage QVJH-YRN1. |
| nancy-davis-marriage | MDZF-Q7C | The subject's 1850 census, her only source. f1 and f2 need evidence that the 1868 bride was born about 1853. |
| nicola-domenichelli-death | 6ZYD-6L8N | Nicola's 1946 marriage. f1 needs the 1981 hint death 6ZB1-TVLX. |
| thomas-hanrahan-marriage | MZF2-Y55 | The Saratoga Thomas's 1880 census. f2 needs the Ballylooby hint 6267-W22Q rejected on the New York records. |
| thomas-hanrahan-marriage | F5GR-QBN | Thomas's father persona in an Irish child's 1871 birth entry, attached to the Saratoga Thomas where the live tree merged two families. f2 still needs the hint rejected. |
| thomas-hanrahan-marriage | F5YK-84C | The same, in the 1872 birth entry. |

## PR B — extraction_append closes plan items and claims re-found records

Free tier. Start now (PR #3558 has merged).

- [ ] **ADR-0006:** put decision 10 in its Decision section, and say its "Revisit when" condition ("a second lane needs narrowing") has fired.
- [ ] **`extraction-append.ts`:** replace the single `EXTRACTION_SECTIONS` set with allowed sections per call. Update the pinned test in `extraction-append.test.ts` ("writes exactly {sources, assertions}") and the tool description's "and no others".
- [ ] **Question tie (decision 7)** in both re-send paths, the recordIds resend skip and the documents one. With `questionIds`, union them into every assertion of that record, and return "already extracted as <src>; tied to <q>". The internal update path already merges any field, so `research-append.ts` needs no change for this.
- [ ] **Completion (decisions 6 and 8).** Make it a second `researchAppend` call after the extraction writes, because the project lock is not re-entrant.
  - Only items on an active plan.
  - A refused completion is reported in the result and never fails the extraction.
  - It must pass `planItemLogAttributionInvariants`; the `record_search` entry names the item.
  - Keep the lookup to `record_search` sidecars, since a full-text result carries an image ARK and never a record id.
- [ ] **A search that ran is never skipped (decision 9).** Add a new `plan_items` precondition in `research-append.ts`. Its refusal names the entry and says to set `completed`.
- [ ] **A completed item stays completed.** An `in_progress` write on a `completed` item is a no-op with a warning. search-records' status step writes `in_progress` after every search it logs.
- [ ] **Reuse a read (issue #3525, Part 1.1).** When `research.json` has a `record_read` entry for the record (`arkToBareId`) whose sidecar exists, cite that entry and skip `deps.readRecord`. Generalise `acceptedHintLogId` rather than writing a second finder. For a census, reuse only a sidecar that carries `indexFields`; otherwise read live, as today.
- [ ] **documents mode (issue #3525, Part 1.3).** Accept a finalized `results/<log_id>.json` whose log entry exists, and cite it instead of writing a new `user_provided` entry.
- [ ] **Unit-plane ownership check** (`eval/harness/validators/test_universal.py`). Add two narrow `extraction_append` paths beside `_explained_by_appends`, each with a free case in `eval/harness/tests/unit/test_universal_validators.py`:
  - `plans`: only `items[].status` changes, and only from `in_progress` to `completed`;
  - `assertions`: only `extracted_for_question_ids` grows.

  Removing an id or changing `record_basis` still fails.
- [ ] **`docs/specs/schemas/ownership.json`:**
  - add `extraction_append` to `writerTools` and `toolAuthorized` on the `plans` and `plan_items` rows; `plans` is the one that binds on the unit plane;
  - rewrite the `requires` text on both;
  - rewrite the `assertions` row's text, since a re-found record gains question ids;
  - correct the `RETIRED` comment in `eval/harness/tests/unit/test_ownership_manifest.py`.
- [ ] **Docs that go false:**
  - `docs/specs/research-append-tool-spec.md`: the extraction section's opening ("not reachable") and its recordIds section, not the documents section;
  - `docs/specs/research-schema-spec.md`: the ANY rule beside `plan_items.status`, and who writes `items[].status` in its ownership table;
  - `docs/specs/guardrail-enforcement-spec.md`: the "Plan completeness before a declaration" row. Items with an extracted positive result now have an exit; items whose searches all found nothing still need Dispose;
  - `docs/architecture.md`: extraction_append's two sections;
  - the `planCompleteInvariants` docstring ("Issue #1821 owns that fix").
- [ ] **Vitest** (`tests/tools/extraction-append.test.ts`, `extraction-append-documents.test.ts`, `research-append.test.ts`):
  - an item with one positive entry completes when its record is extracted;
  - an item with two positive entries completes when one is extracted;
  - a record found by two items' searches completes both;
  - re-sending an already-extracted record with `questionIds` ties it and completes its item;
  - a reused read makes no live read and cites the existing entry;
  - a nil-only item, a `planned` item and an item on a superseded plan are untouched;
  - a refused completion leaves the extraction written;
  - skipping a searched item is refused; skipping a never-run item is accepted, and so is an external hand-off with no capture;
  - `in_progress` on a `completed` item leaves it `completed`;
  - documents mode cites a finalized results ref.
- Done when: `make engine-test`, `make engine-test-pg`, `make typecheck` and `make harness-test` are green. No paid run is owed: `extraction_append` is a live tool, so check_runlogs warns rather than blocks. Say in the PR body that graded behaviour changes anyway, in project_context's next step and in research_append's refusals.

## PR C — the baseline step and timeline_build

Free tier, plus one `make hook-smoke` run. Land it after PR B and after PR #3583, or speculative links count as identity under PR #3583's gate. It shares the score gate, the reused-hint code, ADR-0009's same_person constraint and the guardrail row with issue #3552, so whichever lands second rebases.

### `extraction_append({ projectPath, personId })`

- [ ] A fourth mode, exclusive with the other three (`MODES`, and the "send exactly one" error in `runExtractionAppend`).
- [ ] Move `findAnchor` (from `person-warnings.ts`; `census-children-gap.ts` imports it too) and `collectSourceRefs` (from `project-context.ts`) into a new `src/utils/` module. A util must not import a tool.
- [ ] Take only this person's person-, name- and fact-level refs (decision 11), and map each to its tree source's `url`. Keep `1:1:` ARKs and count the rest as skipped ("N attached sources are not indexed records; not extracted").
- [ ] Extract through the recordIds path, with no `questionIds`.
- [ ] **Reuse the imported source entry.** Stamp the import's `S` id as `gedcomx_source_description_id` on the source op, and omit `sourceDescription`, which research_append refuses alongside it. Match on the bare ARK id, never the URL string: the import's url is `familysearch.org/…/1:1:<id>`, while the record's own is often `1:2:`. Pin this with a Vitest case. It avoids a duplicate `S`. It does not make `same_person`'s leave-one-out work, because imported facts cite S1.
- [ ] **Link.** For each record:
  - find the persona whose `persons[].ark` names the attached ARK, take that persona's `id`, then take the assertions carrying it as `record_persona_id`. Persona ids are `p_…`, never the ARK id;
  - pin this with a captured live fixture (`tests/fixtures/record-extract/`), not a hand-built one, because hand-built fixtures give a persona the ARK as its id;
  - write each `person_evidence` row with `confidence: "speculative"`, `match_score: null` and `rationale: ATTACHMENT_LINK_RATIONALE`, an exported constant: "Linked because FamilySearch has this record attached to this person; not verified.";
  - leave an assertion already linked to anyone alone;
  - a record whose assertions carry no persona id is extracted but not linked, and its outcome says so.
- [ ] **Score-gate exemption.** Let this path past `personEvidenceScoreInvariants` with an internal option on `researchAppend`, never an input field. Test that an MCP `research_append` writing the same unscored speculative link is still refused.
- [ ] Add `person_evidence` to this mode's allowed sections (decision 10). Update the `person_evidence` row in `ownership.json`: `writerTools`, `toolAuthorized`, `requires` and notes.
- [ ] **Return** counts (extracted, linked, skipped) and one code-written summary line for the whole call, not a summary per record.
- [ ] **Sites that say extraction never writes `person_evidence`:**
  - `extraction-append.ts`'s header and description;
  - ADR-0006, `docs/architecture.md` and `docs/skill-dataflow.md`;
  - two comments in `hooks/guard_project_files.py`. A `hooks/` edit owes `make hook-smoke`;
  - `eval/harness/harness/skill_invocation.py`: the "SOLE tool that creates person_evidence" comment, and `find_effects_without_invocation`, which must not count a link carrying the constant as person-evidence's work;
  - `eval/harness/harness/ownership.py`.
- [ ] **Mock** (`_make_extraction_append_handler` in `eval/harness/harness/mock_mcp.py`): with `personId`, stage every loaded `record_read` fixture, and match bare ids.
- [ ] `project_context`: add `subjectPersonIds` from `research.project.subject_person_ids`, with its spec and a test.

### A speculative link is not proof

- [ ] One shared predicate in `src/utils/`. PR #3583's `unlinkedProofInvariants` counts a live link (`superseded_by` null) only when it is not speculative. Its `noneLinked` rung counts every live link except those carrying `ATTACHMENT_LINK_RATIONALE` (see "One narrowing" above).
- [ ] Re-count, and record in the PR body, how many committed e2e proofs above `not_proved` rest only on attachment links. There were 2 on 2026-10-19: robert-lord-children and cruz-corona-ancestry.

### `timeline_build({ projectPath, personId })`

- [ ] Add the tool in `src/tools/timeline-build.ts`. It does the timeline agent's Mode A Steps 2–4 and 7 in code. Also add:
  - its schema in `allToolSchemas` (`src/tool-schemas.ts`);
  - its dispatch arm in `src/server.ts`;
  - its name in `manifest.json` `tools`;
  - a row in `dev/smoke-calls.ts`;
  - a new `docs/specs/timeline-build-tool-spec.md`;
  - a `docs/catalog.md` entry.
- [ ] Resolve `personId` with the shared `findAnchor`.
- [ ] **Events come from live `person_evidence` links only** (`superseded_by` null). Never use a tree fact or `diedByYear`.
  - Merge the assertions one record makes about one event into a single event, listing every id in `assertion_ids`.
  - Event types, the date-certainty subset, the before/after conversion and the sort key follow timeline.md Step 3.
  - Copy `standard_place` from the assertion.
  - Set `distance_from_previous_km` with `haversineDistance` (`src/tools/distance.ts`). Look up each distinct place once, and compute each unordered pair once.
  - If every link behind an event is `speculative`, start its `description` with "Unverified attachment:" when every rationale is `ATTACHMENT_LINK_RATIONALE`, and with "Unverified:" otherwise.
  - For a resolved conflict, take the preferred assertions only and set `conflict_ids`, as timeline.md Step 7 says.
- [ ] **Gaps.** Copy `start` and `end` from the bounding events, and never pad them. The tool writes four kinds:
  - **Census, `high`.** The expected years come from the collections catalog, through `collectionCoverage` (`src/tools/collections-search.ts`). The span runs from the first record-backed event to the last, or to a linked death. Each missing year is one `expected_events` entry naming its year ("1870 census").

    Fix three things in `collectionCoverage` first, in the function itself, because `tree_gaps` shares it. Each was measured against the live catalog on 2026-10-20:
    - **It returns no census years below country level.** Ohio, Hamilton County and Cincinnati each return `[]`: it matches the place name against collection titles, and the federal censuses are filed under the United States only. Match each entry's `searchMetadata.placeIds` against the place ids of the residence place and every enclosing jurisdiction, through `place-resolver.ts`. Do not walk the title match up to "United States", which matches every "United States, <state>, …" collection.
    - **Its `typeFacet === "CENSUS"` test drops real censuses.** US 1790, 1830 and 1870, and England and Wales 1841 and 1881, are filed as `MISCELLANEOUS`. Take every single-year collection whose title names a census, under any facet.
    - **That same test is all that keeps out the US 1890 fragments.** Once it goes, exclude timeline.md Step 4's non-surviving years by name: US 1890, Ireland 1821–1891 and England 1931.
  - **Marriage, `high`.** A linked assertion names a child of the person, and no marriage event comes before the first child's birth.
  - **Twenty or more years between consecutive events, `high`.**
  - **Death without burial, or burial without death, `medium`.**

  The military and immigration rules stay with the agent. Question-selection reads only `high` gaps.
- [ ] **Write** through `researchAppend`. With no person timeline yet, append one. Otherwise update this person's timeline (the one with no `hypothesis_id`) in place, and restamp `generated`. Never touch a hypothesis timeline. Every event cites assertions, so PR #3573's warning for events that cite no record never fires on these.
- [ ] **Ownership.** In `ownership.json`'s `timelines` row, add `timeline_build` to `writerTools` and `toolAuthorized`, and name it in `requires` and `remedy`. `test_universal.py`'s tool-identity arms are written for merge_tree_persons and extraction_append only, so add a `timeline_build` arm with a free case: appending a person timeline and updating the person's own timeline pass, and editing a hypothesis timeline fails. Without it, the research suite's job-row test fails ownership.
- [ ] **Nothing linked:** write nothing and return `status: "no_linked_evidence"`.
- [ ] **Return** `{ ok, status, timelineId, events, unverifiedEvents, gaps: { high, medium, low }, summary }`. `summary` is one code-written sentence the main thread relays. It gives how many events there are, how many come from unchecked attachments and how many `high` gaps, and says that checking the attachments is a separate request.
- [ ] **Unit harness.** The tool reads the catalog and place coordinates from FamilySearch, so it cannot be a `LIVE_TOOLS` entry. Take both through injected `deps`, as `extraction_append` takes `readRecord`. Serve it from fixtures in `mock_mcp.py`, as `same_person` is served, including its write.
- [ ] **Vitest** (`tests/tools/timeline-build.test.ts`):
  - a tree id and a FamilySearch id both resolve;
  - a tree fact with no link becomes no event;
  - one record's assertions about one event merge into one event;
  - both unverified prefixes;
  - a census gap names its year, and a year with no catalog collection is not expected;
  - `collectionCoverage`: US 1870 and England 1881 are census years, while US 1890 and Ireland 1841 are not; Ohio gets the federal years; an Ohio place gets no year from a "United States, Kentucky, …" collection;
  - no padded boundary;
  - nothing linked writes nothing;
  - a rerun updates in place and leaves a hypothesis timeline alone.
- Done when: `make engine-test`, `make engine-test-pg`, `make typecheck` and `make harness-test` are green, and `make hook-smoke` (live and billed) has run after the hook-comment edit. No paid unit run is owed.

## PR D — the plugin side

Paid: the timeline, research and question-selection suites, each with a genealogist annotation.

### `agents/timeline.md`

- [ ] **Mode A:** replace Steps 2–4 and 7 with one `timeline_build({ projectPath, personId })` call. Keep Step 5 (travel feasibility, chronology anomalies) and Step 8, working from the timeline the tool wrote. Add `timeline_build` to `tools:` under all three spellings, which changes the permission snapshot in `agent-tool-names.test.ts`.
- [ ] Add `attachmentsLinked` to the invocation contract. It is `yes` when the caller has just run `extraction_append({ personId })` for this person.
- [ ] When `timeline_build` returns `no_linked_evidence` and `attachmentsLinked` is absent, make no claim about the person's life. Return these lines:
  `Hand-back: extraction_append — no record is linked to <personId> yet`
  `1. extraction_append({ projectPath, personId: "<personId>" })`
  `2. @plugin:timeline — projectPath, personId <personId>, attachmentsLinked: yes`
  Then `---`, and a `summary_for_user` saying nothing has been checked against a record yet, and what happens next.
- [ ] With `attachmentsLinked: yes` and still `no_linked_evidence`, say that no record yet places the person anywhere. Never hand back twice.
- [ ] `summary_for_user` gives the tool's `unverifiedEvents` count, and says that checking the attached sources is a separate request.
- [ ] **Mode B (hypothesis)** never hands back. It reads only the linked assertions of the hypothesis persons (`research_query` by `assertionId`, at most 50 per call), never the unfiltered assertions section, which this plan's whole-record extraction makes much larger.

### `skills/research/SKILL.md`

- [ ] **Bounded list:** add "a timeline for a person". Its owner goes in the "Hand a bounded request straight to…" sentence:
  - `extraction_append({ personId })`, unless that person already has attachment links, with `@plugin:init-project` first when there is no project;
  - then `timeline_build({ projectPath, personId })`, relaying its `summary`.

  The bounded section's own close ends the ask. It never goes to question-selection or the timeline agent.
- [ ] **Job row**, above "Objective but no questions":
  `| Objective but no questions, and no timelines[] entry names a subject person (project_context subjectPersonIds) | extraction_append({ projectPath, personId }) then timeline_build({ projectPath, personId }), once per subject; then question-selection |`

  The row stays tool calls only, so step mode never splits it. research/SKILL.md never names `@plugin:timeline`, so a timeline.md edit keeps staling only the timeline suite.
- [ ] Add one exception to the "Assertions not yet linked to persons" row ("You never write `person_evidence` entries… Extraction never links"): the speculative attachment links that `extraction_append({ personId })` writes.
- [ ] Re-check the six research tests in the state the new row matches. Neither subject cites an indexed source, so the call writes nothing; confirm each test still passes.
  - on `empty-project-just-created`: `route-no-questions`, `autonomous-is-always-a-job`, `bounded-ask-not-a-job`, `open-ask-still-a-job`, `route-shortcut-guard`;
  - on `driscoll-source-audit`: `attached-before-searching`.
- [ ] Name the new step, with its measured cost, in `docs/architecture.md`'s orchestration description.

### Tests and fixtures

- [ ] **A new scenario** under `eval/fixtures/scenarios/`. Its subject has tree facts, two person-level `1:1` sources, one memory source, no assertions and no questions. Add `record_read` fixtures for both ARKs, with `persons[].ark` set, plus the catalog and place fixtures `timeline_build` reads.
- [ ] `eval/tests/unit/timeline/`:
  - (a) zero links and no flag gives the hand-back and no `timelines` write;
  - (b) attachment links present gives events labelled unverified;
  - (c) a hypothesis delegation with zero links gives no hand-back.
- [ ] `eval/tests/unit/research/`:
  - (a) "create a timeline for <PID>" runs `extraction_append`, then `timeline_build`, and never question-selection or the timeline agent. Do not assert `research_delivered`: step mode removes it;
  - (b) a job on the new scenario runs `extraction_append({ personId })`, then `timeline_build`, both before the first question-selection.
- [ ] `eval/tests/unit/question-selection/`: on a project with no questions and a `high` timeline gap, the first question still restates the objective. Priority 3 (`timeline_gap`) ranks above the fresh-project default, and nothing tests which one wins. If the test fails, make the priority list apply only once an objective-scope question exists.
- Done when: `make eval-skill SKILL=timeline`, `SKILL=research` and `SKILL=question-selection` have landed with their annotations, and `check_runlogs.py` passes.

### Acceptance e2e

After PR D, post the worktree path and `make e2e-run TEST=joao-sousa-death` on issue #3516, and the lead runs it. Report:

- the records extracted and the assertions linked;
- the result size and tool time of `extraction_append({ personId })` and of `timeline_build`, and the main-thread turns they add. Put `timeline_build`'s figures in its spec;
- the run's `wall_clock_seconds` and `total_cost_usd`, with the price basis stated;
- the findings grade, and that the leak check passed.

No comparable baseline exists: joao-sousa-death's only committed run predates PR #3312. Say so rather than compare.

## What nothing checks

- Whether the main thread obeys the timeline agent's hand-back outside /research. The unit tests grade only the hand-back text.
- Most of the step in e2e: 27 of 167 starting trees cite an indexed source on the subject, and none of the four panel fixtures does.
- PR B and PR C change graded behaviour while check_runlogs only warns.

## Collisions

- **PR #3583** (open): the "speculative link is not proof" work edits its gate and rung, so PR C lands after it.
- **Issue #3552:** same score gate, reused-hint code, ADR-0009 constraint and guardrail row. Its step 1 turns PR C's "extracted, not linked" case into a link.
- **PR #3567** (open): edits the `plans` and `plan_items` callers in `ownership.json`. Rebase.
- **`skills/research/SKILL.md`** is also edited by PR #3567, PR #3577, PR #3507 and issue #3526. Whichever lands second re-runs research.
- **Step mode** (`docs/plan/research-step-mode.md`): PR B is a prerequisite. Completing items whose searches all found nothing, and routing a refused declaration's `in_progress` items to Dispose, are in its research-plan preparatory PR and PR 2.
- **Issue #3153:** its hints item completes through search-hints' own lane, not rule 8. A `person_record_matches` entry has no `record_search` sidecar.
- **Issue #3584** (parked): this plan's source reuse does not unblock it.

## Costs

- PR A, PR B and PR C owe no paid unit run. PR C owes one `make hook-smoke`.
- PR D owes three paid runs, about $2.15 for timeline, $5.70 for research and $3.44 for question-selection at the last runs' prices, plus three annotations. Then one e2e run, which the lead does.
- At run time, a job gains one or two main-thread tool calls. On a subject with attached records it also gains 4.5–7.2 s of record reads for 14–16 records (live, 2026-10-20), and the extraction summary in context.
