# Deep dive: person-evidence — findings and validator requests

Issue #1646. Base `11c8e2cb`. Run log read: `v1_2026-08-20_15-53-03` (21 tests,
snapshot drift 0), with the five earlier committed logs used for rates.

Step 1's output is [`person-evidence-prohibition-list.md`](./person-evidence-prohibition-list.md)
— 36 transcript-checkable rules, of which **11 have a guard and 9 of those are
tag-gated**, so they fire on one or two named tests and are inert on the other
~19. That coverage table is what directed the reading below, and it is the
finding underneath all six: the body is most emphatic exactly where nothing
checks it (household skeleton 8-of-10 unguarded, threshold policy 7-of-10).

**Numbers re-pinned before starting**, per the lead's 2026-08-23 comment. `make
judge-report` gives **1 of 8** non-discriminating dimensions, not the card's
"3 of 9": the flat one is `base/Tool Arguments` (n=17, always 3). A hand count
that treats `N/A` as a value, or that counts the judge's re-cased headings
(`Score discipline (advisory)`) as separate dimensions, gets a different and
wrong answer. `rubric/Score discipline` now varies [1, 3] — it caught n7v.

---

## F1 — The household rubric bar cannot be met by any scenario in the suite, and correct behaviour matches its *partial* wording

**Did:** `merge_warnings` is called **0 times across all 21 tests**.
`ut_person_evidence_021` and `ut_person_evidence_026` — the two household runs
that materialize members and write edges — both skipped the gate and said so, in
the response ("Coherence dry-run via `merge_warnings` is not possible (no
candidateGedcomx — working from pre-extracted assertions)") and in every `pe_`
rationale they wrote. Both scored **3 on all eight dimensions**, including
`Person minting and connecting edges`.

**Should:** `rubric.md`'s **pass** bar read "For a multi-person household, a
`merge_warnings` dry-run coherence gate **is run** over the pre-materialization
set before committing" — unconditionally. Its **partial** bar penalised a run
that "skips the `merge_warnings` gate on a household". The behaviour observed is
the partial bar's wording verbatim.

**Gap:** lane 2, and the bar was unreachable rather than merely strict. SKILL.md
conditions the gate on holding a `candidateGedcomx` "from a prior `record_read`
call", and **`record_read` is not in person-evidence's `allowed-tools`** — the
skill cannot obtain one for itself. Every household scenario is built from
pre-extracted assertions, so in the unit tier the precondition is unsatisfiable
by construction and the pass bar describes a state no run can reach. The judge
scored 3 by ignoring its own rubric and grading the body instead, which is the
right answer arrived at the wrong way — and it means the dimension was reporting
nothing about the gate either way.

**Fixed here.** Both bars now turn on whether a candidate document is in hand,
and a noted skip is explicitly the pass.

## F2 — The suite's one flat dimension is the one a `judge_context` writes the answer for

**Did:** [`patronymic-mismatch-caps-confidence.json`](../../eval/tests/unit/person-evidence/patronymic-mismatch-caps-confidence.json)
carried *"Tool Arguments: score 3 if `same_person` was called with the two
primary ids (subject and candidate persona). If no other tool is needed, that is
sufficient."* Two further tests hand the same dimension a conclusion:
`detect-absent-household-member` ("minting the children and writing the edges is
the expected tool use … no same_person call is required") and
`marriage-parent-persona-unscored`.

**Should:** the issue's own instruction — "Rewrite a hit to name the *dimension*
without writing the finding." This is the worked example's exact shape.

**Gap:** lane 2. `base/Tool Arguments` is the suite's only non-discriminating
dimension (n=17, always 3; +4 N/A), and a third of the tests that exercise it
tell the judge what to conclude. That is not proof of causation, but it is the
one dimension where the corpus supplies the answer and the one dimension that
has never varied.

**Fixed here** on the score-branch hit. The other two are left: neither writes a
score, and both state a genuine fixture fact the judge cannot otherwise know
(that no `same_person` call is owed because the personas are new stubs). Removing
those would make the tests harder, not better.

## F3 — `same_person` is skipped outright, and the dimension that grades it had never once reported it

**Did:** `ut_person_evidence_n7v` on `flynn-marriage-parent-match` — **9 of 9**
assertions carry a non-null `record_persona_id`, `same_person` is never called,
and eleven `pe_` entries land, three of them at `confident` with a null
`match_score`.

**Should:** SKILL.md §2 — "**Score the match with `same_person`** when the
assertion is `record_search`-sourced — i.e. it has a non-null
`record_persona_id`." §3 then makes the score an input to confidence.

**Gap:** the rule is in the body and was ignored, so per the deep-dive guide
restating it is not the fix. Across the five committed run logs before this one
`rubric/Score discipline` took the value **3 on all 73 gradings**; benter-070
measured the underlying skip at roughly **1 in 3 on this one test** (#1646
comment 4). An intermittent compliance failure is what a judge dimension is
worst at catching.

Independently re-derived here, and three apparent skips turned out **not** to be
violations: `ut_person_evidence_011`, `_022` and `_014` each link an assertion
whose own `record_persona_id` is null, even though their scenarios contain
scored personas. Checking the scenario rather than the linked assertion produces
three false findings — worth recording, because that is the obvious way to write
this check wrong.

**Closed by a validator, shipped here** —
`test_same_person_called_when_persona_meets_existing_candidate`. Not tag-gated:
it derives its own precondition (a new `pe_` entry linking a persona with a
non-null `record_persona_id` to a person that was already in the tree) and
stands down otherwise.

## F4 — `check-warnings` is skipped on 2 of 12 write-runs, both of them all-3 passes

**Did:** `ut_person_evidence_025` (three `confident` links) and
`ut_person_evidence_014` (mints a stub, then links it) finish without invoking
`check-warnings`. The other ten write-runs invoke it. Both scored **3 on all
eight dimensions**.

**Should:** SKILL.md §8 — "After creating links and any stub persons, **invoke
`check-warnings`** on the affected persons to catch genealogical
impossibilities."

**Gap:** nothing checks it and no dimension names it. This is the guard that
would catch a stub minted with an impossible lifespan, so a silent skip on a
stub-creation test is the case that matters most.

**Validator request** — I could not ship this one, see below.

## F5 — A `judge_context` quotes a retired version of §5, and blesses the shape the rubric calls a shortfall

**Did:** `ut_person_evidence_022` created Mary Doyle with
`tree_edit({operation: "add_person", person: {gender, names}})` — a name-only
shell, no facts, no source-ref. It scored **3 on all eight dimensions**,
including `Person minting and connecting edges`, whose **fail** bar reads "Mints
each new person via `materialize_facts` create-or-enrich so it arrives WITH its
sourced fact(s) … not a bare name-only stub" and whose **partial** bar names
"leaves a member a name-only shell (the old stub shape)".

**Should:** the test's own `judge_context` told the judge the opposite — "The
stub should be minimal (gender + a name) … **SKILL.md §5 notes proof-conclusion
populates stub facts later**." §5 has not said that since the
tree-materialization rework; it now says the reverse, by name: "do **not**
hand-build a name-only stub with `tree_edit add_person` … so the new person
arrives WITH its facts, never as a name-only shell that a later step fills in."
The `judge_context` and the rubric actively contradict each other, and
`judge_context` won.

**Gap — and the skill turns out to be right.** Mary Doyle is named only *inside*
the groom's marriage assertion. She has no `record_role` and no name assertion of
her own, so `materialize_facts` has no persona to mint from — and
`materialize-facts.ts:84` skips the `marriage` fact_type outright
(`SKIP_TYPES = {relationship, age, marriage}`). `tree_edit add_person` was the
only mechanism available, and §5 prohibited it by name. §7.3's nearest clause
covers only a persona that is *matched*, which she is not. The body had a hole,
and the skill fell into the one action left.

**Fixed here, both halves:** §5 gains the carve-out naming this case as the one
place `tree_edit add_person` is correct, and the `judge_context` is rewritten off
the current doctrine.

## F6 — A matched persona's facts never reach the tree person (the lead's finding, verified)

**Did / Should:** recorded by the lead on #1646, 2026-08-22, and verified against
the body here. `docs/specs/tree-materialization-spec.md` assigns person-evidence
"write the linked persona's assertions as sourced facts/names onto the tree
person" for **every** linked persona. SKILL.md covered it only in §5 (persona
matches **no** existing person) and §7.3 (**multi-person household** record).
**§4 has no materialize instruction**, so the commonest case — a single-person
record matched to someone already in the tree — got a `pe_` link and no facts.

**Gap:** lane 4, and it is not bookkeeping. search-records sources its next
query's name and date parameters off the tree person
(`search-records/SKILL.md`), so the facts that never landed are the ones that
would have sharpened the next search.

**Fixed here** — §4 gains the step, folded in at the lead's suggestion rather
than split out. Covered by a new test, `ut_person_evidence_027`, on the
`mid-research-flynn` death certificate (`src_004`, role `deceased`), whose
`a_011`/`a_012` are unlinked and whose subject is already in the tree — so the
case needed no new fixture. Guarded by
`test_matched_persona_is_materialized_onto_its_person`.

---

## Lane summary

| | Lane | Disposition |
|---|---|---|
| F1 rubric bar unreachable | 2 — grading | fixed (`rubric.md`) |
| F2 score-branch judge_context | 2 — grading | fixed (one test) |
| F3 `same_person` skipped | body rule already present | **validator shipped** |
| F4 `check-warnings` skipped | body rule already present | **validator request** (blocked, below) |
| F5 stale `judge_context` + §5 hole | 2 + 4 | both fixed |
| F6 matched persona not materialized | 4 — doctrine | step added, test added, **validator shipped** |

Two prose edits, both to rules the body did **not** already contain — F5's
carve-out and F6's step. No rule the skill already obeyed was restated.

## Validator requests

**V1 — `same_person` attestation. SHIPPED** as
`test_same_person_called_when_persona_meets_existing_candidate`.

> **Rule:** when a new `person_evidence` entry links an assertion carrying a
> non-null `record_persona_id` to a tree person that existed before the run,
> `same_person` must appear in `tool_calls`.
> **Where to look:** new `person_evidence[]` in the after-state, `assertions[]`
> for `record_persona_id`, the before-state tree for whether the person is new.
> **Why it is not judgment:** all three are recorded fields; nothing needs
> interpreting.
> **What a violation looks like:** `ut_person_evidence_n7v`, run
> `v1_2026-08-20_15-53-03` — 9 of 9 personas scored, zero calls.

**V2 — materialize a matched persona. SHIPPED (tag-gated)** as
`test_matched_persona_is_materialized_onto_its_person`.

> **Rule:** linking a persona whose assertions carry a materializable
> `fact_type` (anything outside `relationship`/`marriage`/`age`) to a
> **pre-existing** tree person requires a `materialize_facts` call naming that
> `personId`.
> **Why tag-gated, and when to ungate:** the rule is universal but the corpus is
> not yet — several existing tests link to an existing person without
> materializing, and an ungated assertion would fail them all in one run. A
> failing validator short-circuits the judge (`_compute_outcome` returns "fail"
> before grading), so ungating today deletes the dimension scores that diagnose
> those tests instead of surfacing the defect. Ungate once they are brought up
> to the rule.

**V3 — `check-warnings` after a write. NOT SHIPPED — needs one harness change
first.**

> **Rule:** a run that creates `person_evidence` entries or mints a tree person
> must invoke the `check-warnings` skill.
> **Where to look:** `output.skills_invoked` against new `person_evidence[]` and
> new `persons[]`.
> **Why it is not judgment:** both sides are recorded lists.
> **What a violation looks like:** `ut_person_evidence_025` and
> `ut_person_evidence_014`, run `v1_2026-08-20_15-53-03` — wrote links (and in
> `_014`'s case minted a stub) with `skills_invoked: ["person-evidence"]`. Both
> scored 3 on every dimension.
> **What blocks it:** `skills_invoked` is not among the fixtures
> `validator_runner.run_validators` supplies (`before_state`, `after_state`,
> `tool_calls`, `skill_frontmatter`, `blocked_context_calls`,
> `blocked_protected_writes`). `check-warnings` is a skill, not an MCP tool, and
> the ten runs that did invoke it emitted no MCP call of their own, so it is
> invisible in `tool_calls`. Adding the fixture touches `run_validators`, its
> orchestrator call site, and `validators/conftest.py` — shared harness
> machinery, and a different reviewer, which is why it is a request rather than
> another commit on this branch.

## What this dive did not settle

`ut_timeline_008` — an attribution question that should reach person-evidence and
loses to `conflict-resolution`, **3 of 4 failing on `main`**, tracked on #1655.
Narrowing `conflict-resolution`'s description would also touch
`ut_conflict_resolution_003` and `_007`, so it is a decision outside this suite.
Recorded here so the next person does not re-measure it.

The unit tier captures **no tool responses at all** (#1646 comment 4: 284 calls,
0 responses, all 13 tools), so a warn-only guardrail riding `validation.warnings`
on a successful response leaves no trace here. That bears on #1550's
shadow-then-graduate decision rather than on this skill, and is not folded in.

---

## What the verification run established

`v1_2026-08-24_18-17-08` — 22 tests, **15 pass / 5 partial / 2 fail**, $6.89, 0
aborts, 1 transient retry, drift 0 (and still 0 after merging `main`). Baseline
for comparison is `v1_2026-08-20_15-53-03` at 16 / 3 / 2 of 21.

**F6's step works, including where it was not aimed.** `ut_person_evidence_027`
passes both validators and emits exactly the intended call —
`{personId: "I1", recordId: "ark:/61903/1:1:MDEF", recordRole: "deceased"}` —
and surfaces the Ireland-vs-Pennsylvania birthplace as coexisting sourced facts
instead of declining to materialize. The clause also reached
`ut_person_evidence_026`, which was not written for it: its materialize ops now
carry `personId: "I1"` for the matched head-of-household, where the 08-20 run
omitted it entirely.

**F3's validator fires.**
`test_same_person_called_when_persona_meets_existing_candidate` fails on `n7v`
and short-circuits the judge (every dimension `None`). `n7v` was already a
`fail`, so the headline cost is zero and an intermittent miss is now decided by
a program.

**F1's rubric fix is not implicated in the one regression.**
`ut_person_evidence_026` went pass → fail, but the judge graded the
absence-flagging clause — "it failed to detect and flag Catherine's unexplained
absence … only a parenthetical remark" — which this branch did not touch. Two
targeted probes of `_026` on this same branch then **passed 2 for 2** ($1.03),
so the fail is single-run variance, not the step-4 edit and not the rubric
rewrite. Recorded rather than re-run: buying a second full suite to get a
prettier headline is the waste the guide warns about.

### Two findings the run itself produced

**F7 — the skill gets `tree_edit` argument shapes wrong on the first attempt,
and self-corrects at the cost of a round trip.** `base/Tool Arguments`, the
suite's only non-discriminating dimension (n=17, always 3 across five run logs),
**now varies**: `ut_person_evidence_021` passed
`"type": "http://gedcomx.org/ParentChild"` where the tool wants the bare
`ParentChild`, and `ut_person_evidence_022` passed `add_person` with a
`nameForms` structure instead of `given`/`surname`. Both were rejected and
immediately corrected.

To be exact about causation: this is **not** the F2 `judge_context` fix paying
off — that edit was on `_020`, and the judge is per-test. The dimension varies
because the skill made different calls this run. F2 remains worth having on its
own terms, but it earns no credit here.

Both defects convert. **Validator request:** no `tree_edit` op may carry a
`relationship.type` containing `://`, and no `add_person` op may use
`nameForms`; both are closed argument shapes the tool already rejects, so a
validator reading `tool_calls` decides them without judgement, and catches the
wasted round trip that a self-correcting run otherwise hides.

**F8 — `project_context` is called outside `allowed-tools`.** The advisory
"skill called MCP tools not in allowed-tools frontmatter: ['project_context']"
fires on most tests in this run and on none in the 08-20 run. Advisory only
under #1748 (the session grants every tool), but it is H5 on the prohibition
list, and the change between two consecutive runs on nearly the same body is
what makes it worth recording. Either `project_context` belongs in the
frontmatter or the body should stop reaching for it — a question for whoever
owns the #1748 decision, not one to settle here.
