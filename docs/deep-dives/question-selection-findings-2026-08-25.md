# Deep dive: question-selection — findings and validator requests

Issue #1668. Guide followed: `docs/skill-deep-dive-guide.md`.
Prohibition list: [`question-selection-prohibition-list.md`](./question-selection-prohibition-list.md).

**Corpus read:** the newest run log,
`eval/runlogs/unit/question-selection/v1_2026-08-13_13-01-37.json` — 14 tests,
14 runs, and its `.ann.json`. `text_response`, `tool_calls` and
`file_changes` were read for all 14 tests before scores, per Step 2. **All 14
pass, and the `.ann.json` agrees with every judge score with no comments** —
so the whole suite is a quiet pass, and per Step 3 that is where the time
went.

**The issue's prescribed grep returns 0 files.** Confirmed
(`grep -l -iE '"[^"]*\bscore [123]\b' eval/tests/unit/question-selection/*.json`
finds no matches).

**Correction made mid-dive: 14 of the 14 original tests do carry
`judge_context`** (15 of 15 after this dive's own addition) -- an earlier
pass through this document wrongly reported none, from a script bug that
read `test.judge_context` (always empty; `judge_context` is a sibling key
of `test`, not nested inside it) rather than the file's top-level key. All
were re-read properly once the paid runs surfaced F2 more concretely; no
other finding in this document changed as a result, but F2 did -- see its
revision below.

**Every dimension is dead — 7 of 7, exactly as the issue states.** Across all
14 tests in the newest run: Correctness, Completeness and Tool Arguments
(base) and Prioritization logic, Question specificity, Objective scope match
and Dependency awareness (rubric) score 3 or null on every test. No 1,
no 2, anywhere in the log.

---

## What this skill is, and why the findings land where they do

question-selection makes exactly one kind of write —
research_append on questions[] — after reading project state and applying
a seven-rung priority ladder. There is no record content to misread and no
citation to format; the entire failure surface is doctrine: did it apply
the ladder correctly, name the right selection_basis, and stay inside the
objective's scope. That is also why every finding below is a doctrine-and-
reference finding rather than a "the skill did the wrong thing" finding — on
this run, it never did the wrong thing. What nothing was looking at is
whether the rules it was following are themselves internally consistent,
and whether every priority rung and every disputed-assignment branch has ever
actually been exercised.

---

## F1 - A reference file names a selection_basis value the schema does not have, and no test exercises the priority rung that would expose it

**Did:** references/pedigree-analysis.md, "Integration with Question
Selection":

> "Missing key data for the research subject maps to pedigree_gap
> (Priority 5)"

**Should:** SKILL.md's Step 2 priority table assigns Priority 5's
selection_basis as objective_decomposition - the same value as Priority
4, not a distinct one. The schema's closed enum
(docs/specs/schemas/enums.schema.json, $defs.selection_basis) lists
exactly eight values: timeline_gap, unresolved_conflict, fan_pivot,
hypothesis_test, objective_decomposition, new_evidence,
record_found_incidentally, user_directed. pedigree_gap is not one of
them.

**Gap:** lane 4 (reference-doc correction) - small, unambiguous, no
genealogical judgment involved. The write-tool boundary already contains the
blast radius: research_append validates against this schema before
persisting and would return {ok: false, errors} on pedigree_gap rather
than corrupt state, and SKILL.md's Step 4 already instructs "on { ok: false,
errors }, surface the errors and fix the entry." So the practical cost of
the bug today is a wasted round-trip if a model ever followed the reference
literally, not silent corruption - but nothing in the 14-test suite ever
triggers Priority 5 in isolation to have proven that either way. **No test
tags Priority 5 or Priority 7 (new_evidence) at all** - both rungs of the
seven-rung ladder are entirely dark in this corpus.

**Fix:** one line in pedigree-analysis.md, pedigree_gap ->
objective_decomposition, to match SKILL.md's own table and the schema.

No validator request: the schema's enum check at the write-tool boundary is
already the mechanical backstop for this shape (a closed-enum field can't
silently hold a value outside its set). What was missing was a human reading
the reference against the schema, which this finding is.

---

## F2 - The one Priority-6 (FAN pivot) test's written question blurs "pivot to Family/Associates/Neighbors" with "try an unexhausted direct-evidence record type"

**Did:** ut_question_selection_005 (flynn-fan-pivot), the written question:

> "Do Schuylkill County, Pennsylvania, land records (ca. 1840-1875) name
> Thomas Flynn in transactions that also involve Patrick Flynn, or otherwise
> document a parent-child relationship between them?"

Prioritization logic scored 3: "The selection_basis='fan_pivot' matches the
highest-priority signal present." Correct that Priority 6 fired (the
scenario's exhaustive_declaration.declared is true, and SKILL.md's own
Priority 6 detail says to trust that flag and not propose more direct-
evidence paths). What is not clean is what the question then asks for.

**Should:** SKILL.md's own Priority 6 examples name people around the
subject - "Who witnessed Thomas Flynn's land transactions in Schuylkill
County?" / "Who were Thomas Flynn's neighbors in Schuylkill County in 1850?"
- i.e., FAN questions ask about associates as a route to circumstantial
evidence. The written question instead asks whether an unexplored direct-
evidence record type (a deed can directly name a father-son relationship,
same evidentiary class as a vital record) documents the relationship itself.
Genealogically, "has anyone searched land records yet" and "who witnessed
Thomas Flynn's land transactions" are different research moves - the first
is still direct-evidence-shaped, the second is the FAN pivot the priority
rung is named for.

**Gap, revised once judge_context was read correctly (see the correction
above the fold): not actually debatable.** `ut_question_selection_005.json`'s
own `judge_context` -- written by the human test author, independently of
this dive -- gives three examples of what the FAN question should look
like: "Who were Thomas Flynn's neighbors in the 1850 census?", "Who
witnessed Thomas Flynn's land deed transactions?", "Who else from the same
Irish emigrant community appears in Schuylkill County records?" All three
are people-around-the-subject questions. None resemble "does this
unexplored record type document the relationship" -- the shape the model
actually wrote and the judge scored 3/3. The test's own grading brief
already called this; the judge just did not enforce it. Lane 2 (a grading
gap -- the judge_context's own examples were not checked against) as much
as lane 4.

**Resolved (lead, 2026-08-25): tighten SKILL.md.** Priority 6's detail
paragraph now states explicitly that a FAN question targets the people
around the subject, not a record type that could itself hold direct proof
of the relationship - implemented in this PR.

**Confirmed empirically.** The paid run after this fix
(`v1_2026-08-26_10-42-10`) wrote, for the identical fixture: *"Who were the
neighbors and associates of Thomas Flynn in Schuylkill County, Pennsylvania,
in the 1850s and 1860s?"* -- exactly the shape both SKILL.md's examples and
this test's own `judge_context` call for, and a clean pass. This is the
one finding in this dive verified both by argument and by a before/after
run.

---

## F3 - The disputed-assignment "ask two things" branch (Step 3) has zero coverage in either direction

**Did:** ut_question_selection_014 is the suite's only disputed-assignment
test, and its user message supplies both required pieces of information
up front. The transcript says so explicitly: "the user has already given me
both pieces of information the skill requires before formulating a
disputed-assignment question... I have everything I need - no need to ask."
test_first_question_tests_disputed_parents (the one validator on this
path) only checks the written question's wording for verify-signals; it
never checks whether the skill asked anything.

**Should:** SKILL.md Step 3: "In interactive mode, before formulating, ask
the user two things: (1) what evidence led them to doubt the current
assignment, and (2) the birth date and place they are working from."

**Gap:** test-coverage gap, not a behavioral defect - the skill's choice to
skip asking was correct given that the user had already volunteered both
answers. But no test in the corpus puts the skill in interactive mode with a
disputed objective and missing evidence/coordinates, so the actual "ask"
branch - and the --autonomous skip-the-ask branch - have never been
exercised in either direction. A regression that made the skill silently
guess a birth date/place instead of asking, or ask when it already had both
answers, would pass every test in this suite today.

> **Validator request V1 - withdrawn after the paid run falsified its
> premise**
> **Rule as proposed:** on a disputed-assignment test missing both required
> inputs, the reply must ask for them and must not write a question yet.
> **What actually happened when built and run:** `ut_question_selection_015`
> (built to exactly this shape) produced a transcript where the skill
> reasoned explicitly - *"The question form isn't available for interactive
> input here, so I'll apply the autonomous-mode rule and proceed directly to
> the verification-framed question"* - and wrote a correctly-framed
> confirm-or-refute question anyway. `test_disputed_parents_ask_before_formulating`
> failed this run, correctly by its own rule, but the rule itself was wrong:
> a single-turn harness invocation has no channel for the skill to receive
> a follow-up answer, so treating the autonomous fallback as a defect
> penalizes the only behavior that was actually available to it.
> **This confirms, with direct evidence, what `ut_question_selection_014`'s
> own description already said** - "the interactive doubt-elicitation ask
> cannot be exercised single-turn" - a limitation of this harness, not a
> skill defect and not fixable by a validator.
> **Status: retracted, twice-revised.** The validator is deleted.
> `ut_question_selection_015` was first retagged `verifies-disputed-parents`
> to share `_014`'s strict validator (requires a written, correctly-framed
> question) - but that is wrong for this test specifically: asking and
> writing nothing is *also* honest behavior here, since nothing was given to
> work from. A third run (F6 below) proved the point by asking instead of
> writing, and failed the shared strict validator for it. `_015` is now
> retagged `disputed-parents-missing-info`, its own tag, covered by a new
> validator (V4, see F6) that accepts either honest branch and fails only if
> neither is taken. `_014` keeps the strict validator - see F5 - because for
> that test asking is never correct: the answers are already in the user's
> message.

---

## F4 - Step 1b's stop-gate contradicted Priority 3 and Priority 6's own firing conditions, and two independent re-runs each found a different half of the contradiction

**Did:** `ut_question_selection_006` (`flynn-census-exhausted`) failed on
both clean re-runs (`v1_2026-08-26_10-12-07` and `_10-26-24`), and
`ut_question_selection_005` (`flynn-fan-pivot`) failed on the second. Both
declined to create any question, each quoting Step 1b as the reason:

> `_006`: "The project's objective is answered. The proof summary ps_001
> concludes at Probable... I won't create a new question to pursue [the
> 1870/1880/1900 censuses] -- that would be optional corroboration of a
> fact already concluded at a defensible tier, which is tier-chasing rather
> than required research."

> `_005`: "Step 1b is explicit on this point: creating a question to
> corroborate or upgrade a fact already concluded at a defensible tier is
> optional tier-chasing, not required research. The Priority 6 FAN pivot
> applies only when direct evidence is exhausted without a defensible
> answer -- here, there is a defensible answer."

Both fixtures have the same shape: `q_001.status` is `"in_progress"`
(`resolved: null`), a `proof_summary` already sits at `probable`, and
`exhaustive_declaration.declared` is `true`. `_006` additionally has a
`severity: "high"` timeline gap spanning the unsearched 1870/1880/1900
censuses. The same two fixtures, in the originally-committed run
`v1_2026-08-13_13-01-37`, correctly fired Priority 3 (`_006`) and Priority 6
(`_005`) and wrote the question. Three failures total across two runs, on
two different tests, both quoting the same clause -- this is not one flaky
draw.

**Should, and what was actually contradictory:** Step 1b's own carve-out
paragraph said FAN "is the legitimate next step" only "when a question's
direct evidence is exhausted without a defensible answer" -- but Priority
6's firing condition (Step 2 detail) is just
`exhaustive_declaration.declared == true`, with no tier qualifier at all.
`_005`'s transcript is not misreading the rule; it is applying the carve-out
exactly as written, and the carve-out's own wording is what disagreed with
Priority 6. Separately, Priority 3 (timeline gap) was never named in the
carve-out list at all -- only "a genuinely independent, still-open part of
the objective" (illustrated by death and burial, i.e. a different fact, not
the same fact still in progress), Priority 1, and Priority 6 were listed. A
high-severity gap on the same still-`in_progress` question had no carve-out
to stand on, which is exactly what `_006` fell through, twice.

**Gap:** lane 4, reclassified from the original single-run reading. The
first `_006` failure alone looked like model variance, and `eval/CLAUDE.md`
gives real cover for treating a single flaky run that way. A second
independent test failing through the complementary half of the same
contradiction is different evidence -- it means the prose supports two
incompatible readings, and which one a given run lands on is what varied,
not whether the rule was followed. Restating the existing words would not
have fixed this; the words disagreed with each other.

**Fix:** SKILL.md Step 1b rewritten. The stop condition now keys explicitly
on the question's `status` being `resolved` (not merely on a `proof_summary`
existing at a defensible tier while the question is still `in_progress` --
a proof_summary can exist, and sit at a defensible tier, before the
mandatory GPS-mentor critique moves `status` to `resolved`). The carve-out
list now names Priority 3 explicitly (a high-severity gap on a
not-yet-`resolved` question is never excused by an existing defensible
tier) and drops the Priority 6 qualifier that contradicted Priority 6's own
firing condition, replacing it with "firing on its own condition...
regardless of tier."

**Why this belongs in the deep dive anyway, doctrine question aside:** it is
the cleanest evidence this dive produced for the "written call on
base-dimension-only grading" below. `Prioritization logic` (the rubric
dimension) was deleted on the strength of `test_selection_basis_timeline_gap`
and `test_selection_basis_fan_pivot` still covering these exact axes -- and
on these very runs, those validators, not any judge dimension, are what
caught both misfires. The deletion's premise held on first contact with two
real regressions, not just in argument.

---

## F5 - The model asked for provenance Step 3 never required, on the one test where both required pieces were already stated plainly

**Did:** `ut_question_selection_014` had passed on every prior run -- its
user message already states a death record placing Anton in Luxembourg
(not Wisconsin) and a believed birth year in Wisconsin. On the third run it
asked anyway:

> "What does the death record say about Anton's parents? Does it name
> them...?" / "Where does the 'born about 1860 in Wisconsin' detail come
> from? Is it from the death record itself, from another independent
> record..., or from the same unverified FamilySearch tree...?"

Both questions demand elaboration or provenance behind information already
given, not the two things Step 3 actually asks for.

**Should:** SKILL.md Step 3 asks for "(1) what evidence led them to doubt
the current assignment, and (2) the birth date and place they are working
from" -- both of which the user's one message already states. Nothing in
the prior wording said "unless already given, don't ask again," so a model
that read the two-part ask as a checklist to satisfy at any rigor,
regardless of what the conversation already contains, was not violating
anything written down -- it was filling a real gap in what "ask" was
scoped to.

**Gap:** lane 4. Fixed: Step 3 now states explicitly that once the user's
own message already states both, however briefly, the skill treats both as
answered and does not ask again or demand elaboration or provenance beyond
what was given.

---

## F6 - test_015's shared validator with _014 demanded the one branch a genuinely-uninformed disputed-assignment turn should not always take

**Did:** `ut_question_selection_015` (no doubt-evidence, no coordinates
given at all) had proceeded to the autonomous verification-framed question
on both runs after the V1 retraction -- this run it stopped and asked
instead, the same behavior V1 originally expected and that F3's retraction
concluded a single-turn harness could not reliably exercise either way.
Sharing `_014`'s tag (`verifies-disputed-parents`) meant sharing its
validator, which hard-fails when no question is written -- so this run
failed a test whose harder problem (nothing was given at all) makes asking
the *more* defensible response, not a violation.

**Should:** stopping to ask when truly nothing is known is exactly what
Step 3 prescribes for interactive mode, and nothing in the rule says a
single-turn eval harness's inability to answer makes that wrong -- F3
already established that penalizing the fallback was the error the first
time; penalizing the ask is the same error from the other side.

**Gap:** lane 2 (test/validator design) -- `_015` needed its own tag and
its own validator, not to inherit `_014`'s. Fixed: `_015` retagged
`disputed-parents-missing-info`; new validator
`test_disputed_parents_missing_info_handled` (V4) accepts either honest
branch -- a correctly-framed written question, or a reply that asks for
both missing pieces -- and fails only if neither happened (a badly-framed
question, or an incoherent non-answer). `_014` keeps the strict validator
unchanged, since for that test asking is never the correct branch (F5).

**One bug survived the first fix and only showed up in the next paid run:**
`_015`'s own `judge_context` still told the judge, in prose, that
proceeding to the question was the *only* correct behavior -- so the
deterministic V4 validator accepted the ask branch while the judge's
Completeness dimension scored it `1` ("the skill failed to produce the
required research question"), and the test still came back `fail`
overall. `judge_context` is graded prose, not a mechanical check, and
updating the mechanical half (the tag, the validator) does not touch it --
both halves have to move together or the judge quietly re-enforces the
rule the validator was just changed to stop enforcing. Fixed: `_015`'s
`judge_context` rewritten to state both branches score full marks, naming
each explicitly.

**A second bug survived that fix too, in the mechanical half this time --
and it took three rounds to see the actual shape of the mistake.** The
next run's reply asked correctly -- "What made you doubt the current
parents?" -- and V4 itself failed it, because `_ASK_EVIDENCE_SIGNALS`'s
phrase list held "why do you doubt" and "what makes you think" but not
this paraphrase. First response: broadened the list ("made you doubt",
"what made you", ...). The very next run produced a third phrasing --
"What made Johann and Maria Vogt look wrong as Anton's parents?" -- which
defeated the broadened list too, because "what made you" requires "you"
immediately after "made" and this reply never says "you" there. Three
reasonable paraphrases in three consecutive runs is the guide's "what does
not convert" case playing out in real time: whether a natural-language
reply asks the right two things well is judgment, not a pattern a phrase
list can enumerate. **V4 redesigned rather than patched a third time:** the
mechanical check now only verifies the written-question branch's wording
(genuinely deterministic, and unchanged); the ask branch is checked only
for "the skill said something substantial" (reply length >= 20 chars after
trimming), and whether that something actually asks the right two things
is left entirely to the judge, via the `judge_context` fix above.

---

## F7 - Three straight runs on the one test needing the timelines section, and the third never queried it

**Did:** `ut_question_selection_006` failed a third time, for a third,
different reason than F4. This run's transcript asserts "Priority 3
(high-severity timeline gap): No timelines with severity flags in the
project" -- but the tool call log shows it never called
`research_query({section: "timelines"})` at all; it queried `questions`,
`conflicts`, `proof_summaries`, `plans`, and `evaluations`, and stopped.
`project_context` (also called) does not surface timeline data --
confirmed by reading `packages/engine/mcp-server/src/tools/project-context.ts`:
it returns `openQuestions`, `persons`, `sources`, `localities` and
`questionStatuses`, and nothing else. So this failure is not F4's
contradiction recurring -- F4's fix correctly stopped the model from
invoking Step 1b here (it explicitly notes "that review must happen before
q_001 can be resolved," recognizing non-resolution). This time it simply
never looked at the one section that would have told it Priority 3 fires.

**Should:** SKILL.md Step 1 names "Timeline gaps" among what to identify,
but described it in prose alongside four other things, none tied to the
specific `research_query` section name that actually holds it.

**Gap:** lane 4. Fixed: Step 1's bullet now names the four `research_query`
section arguments directly (`timelines`, `conflicts`, `hypotheses`, `log`)
and states plainly that `project_context` returns none of them, so
concluding "no gap" or "no conflict" without having queried that section is
fabrication, not absence of evidence.

> **Validator request V3 - a timeline-gap scenario must show the section
> was actually queried**
> **Rule:** on a test tagged `selection-basis-timeline-gap`, `tool_calls`
> must include a `research_query` call with `args.section == "timelines"`.
> **Where to look:** `tool_calls[].tool` / `tool_calls[].args.section`.
> **Why it is not judgment:** a literal presence check against an
> enumerable tool contract -- `project_context`'s own source confirms it
> never returns this data by any other path.
> **What a violation looks like:** `ut_question_selection_006`,
> `v1_2026-08-26_10-42-10` -- the exact case above.
> **Status: implemented** as `test_timelines_queried_before_deciding` in
> `test_question_selection.py`.

---

## F8 - A fourth run's clean pass on F4/F5/F7 surfaced a fifth, independent defect: `research_query`'s `status` filter on `plans` matches the plan, never an item

**Did:** the run that verified F4/F5/F7's fixes held (`_005`, `_006`, `_014`
all passed) also regressed `ut_question_selection_001` for the first time
in this dive -- it had passed on every prior run, including the original
baseline. The model called
`research_query({section: "plans", questionId: "q_001", status: "in_progress"})`
and concluded "No in-progress plan items on any open question -- clear to
proceed," then wrote a new `timeline_gap` question. The fixture
(`mid-research-flynn`) has plan `pl_002` (`question_id: q_001`,
**`status: "active"`**) containing item `pli_006` with **`status:
"in_progress"`** -- confirmed by reading the fixture directly. The `status`
filter matched against the plan's own field (`"active"`), not the item's,
so it silently returned nothing.

**Should:** `research-query.ts`'s own schema description says only
"`plans` (questionId, status)" -- accurate about which two arguments are
accepted, silent about which object each argument's field belongs to. A
model filtering for `status: "in_progress"` under a `plans` section, when
the actual in-progress state lives one level down in `items[]`, is a
reasonable reading of that description, not a misreading of anything
SKILL.md said -- Step 1a's prior wording named the field
(`plan_items[].status == "in_progress"`) but never named the tool call that
retrieves it or warned that the section's `status` filter cannot reach it.

**Gap:** lane 4 primarily, with a lane-1-adjacent tool-documentation
ambiguity noted rather than fixed here. This is a tool contract that
`research-query.ts` could describe more precisely for every skill that
reads `plans` (its schema string does not distinguish plan-level from
item-level fields anywhere), but no other skill body in this repo was
found relying on the same filter shape (`grep` across every other
`SKILL.md` for `plans` + `research_query` turned up only `research-plan`,
which does not filter on `status`), so the narrower, safer fix for this PR
is local to this skill rather than a shared-tool schema edit that would
need its own review and re-run every other skill's suite.

**Fix:** SKILL.md Step 1a now states explicitly, before its rule: call
`research_query(section: "plans", questionId: <id>)` **without** a `status`
filter and inspect each returned plan's `items[].status` directly, naming
why the filter can't be trusted for this (it matches the plan's status,
never an item's).

No validator request: detecting "the model relied on a filter shape known
to return empty" from a tool-call log alone, without also re-deriving
whether an in-progress item actually existed, is exactly the kind of
judgment the guide's "what does not convert" section excludes -- the fix
had to be a clearer instruction, not a mechanical check.

---

## Per-dimension deletion call (issue's required deliverable)

Re-derived independently by reading eval/harness/validators/test_question_selection.py
against each dimension in eval/tests/unit/question-selection/rubric.md, and
against every validator result actually recorded in the 14-test run log - not
copied from the issue's table, though it agrees with three of the four rows.

| Dimension (n) | What still catches the axis | Call |
|---|---|---|
| **Prioritization logic** (9) | test_selection_basis_objective_decomposition / _unresolved_conflict / _fan_pivot / _timeline_gap, and test_question_selection_no_new_question - all five ran and passed correctly against the transcripts I read (e.g. _003 to unresolved_conflict, _005 to fan_pivot, _006 to timeline_gap, _001 to no-new-question). Rationale-comparison clause (does the rationale explain why this signal outranks the others) has no validator. | **Delete.** Partial coverage matches the bar the other three deleted dimensions clear. |
| **Question specificity** (8) | Nothing at the time of writing. Now `test_new_question_not_vague` (V2, implemented). | **Kept**, per the issue's own call - matches the issue's own standard: it is now partially covered (the textbook-bad extreme case), same bar as the three deleted dimensions. |
| **Objective scope match** (8) | test_new_question_not_record_scoped, test_new_question_excludes_out_of_scope_persons - both ran on the tagged tests (_002 objective-scope-match; _013 scope-excludes-serena-deacon/samuel-jesse-purnell) and passed correctly. | **Delete.** |
| **Dependency awareness** (9) | test_depends_on_nonempty, test_first_question_depends_on_empty - both ran and passed on the tagged tests. unblocks being populated correctly has no validator; test_universal.py::test_id_references_resolve only confirms referenced ids exist, not that the right ones were chosen. | **Delete**, on the same partial-coverage bar as Prioritization logic - consistent with the issue's own standard, not a stricter one applied selectively. |

> **Validator request V2 - reject the extreme case of a non-specific
> question**
> **Rule:** a newly written question must not match a fixed set of
> known-vague shapes - bare "Who is `<name>`?" / "Tell me about `<name>`" /
> "Learn more about `<name>`" / "Find out more about `<name>`" with no named
> fact, date, or event.
> **Where to look:** the new question's question text in
> after_state["research_json"], same shape as the existing
> _RECORD_SCOPED_PATTERNS regex list test_new_question_not_record_scoped
> already uses for Objective scope match.
> **Why it is not judgment:** a fixed phrase list, matched literally - it
> says nothing about whether a question that avoids these shapes is good,
> only that it isn't the textbook-bad example the rubric's own fail bullet
> names ("Who is Patrick Flynn?", "Learn about the Flynn family").
> **What a violation looks like:** no run in the corpus is provably one -
> which is the same "nothing has ever been able to fail this" finding as the
> rubric-critic issue. Once built it gives Question specificity a mechanical
> floor the same way the other three dimensions already have one, at which
> point it becomes a normal deletion candidate on a future pass rather than
> the issue's excluded case.
> **Status: implemented (lead approved, 2026-08-25)** as
> `test_new_question_not_vague` in `test_question_selection.py` - universal
> (not tag-gated), since no legitimate question should ever match these
> shapes. Verified against the 7 distinct questions already written across
> the corpus's 14 tests: zero false positives (see Fixes-made below).

**Written call on base-dimension-only grading (issue's required
deliverable):** deleting the three qualifying dimensions loses no grading
signal that exists today, and this is no longer only an argument -- the
paid run tested it directly. F4 is a real regression on exactly
Prioritization logic's axis (the timeline-gap priority rung fired
incorrectly), it surfaced in the same run these deletions shipped in, and it
was caught -- by `test_selection_basis_timeline_gap`, a validator, not by
any judge dimension. Base dimensions (Correctness, Completeness, Tool
Arguments) are also flat 3s across this corpus -- question-selection is
one of the sixteen skills in the issue's own measurement where every
dimension, rubric and base alike, never discriminates -- and F4's failing
test still recorded `outcome: fail` from the validator layer with the judge
never in a position to add anything. None of F1-F4 above was caught by any
grading dimension, rubric or base; F1-F3 came from reading the skill body
and its reference files against the schema and against what the corpus
actually exercises, and F4 came from a validator that would have existed
and fired identically whether or not the rubric dimension was still there.
A channel no judge dimension replaces is what caught every finding in this
document, deleted dimension or not.

---

## Lanes, at a glance

| # | Finding | Lane | State |
|---|---|---|---|
| F1 | pedigree-analysis.md names a non-existent selection_basis enum value | 4 | fixed |
| F2 | FAN-pivot question blurs associates-pivot with unexhausted-direct-evidence | 2+4 | fixed and empirically confirmed |
| F3 | disputed-assignment "ask two things" branch is untestable single-turn by a single strict validator | harness limit + 2 | V1 retracted; superseded by F6's dual-branch validator |
| F4 | Step 1b contradicted Priority 3 and Priority 6's own firing conditions | 4 | fixed (SKILL.md Step 1b rewritten) |
| F5 | model asked for provenance Step 3 never required, on already-answered inputs | 4 | fixed (SKILL.md Step 3 rewritten) |
| F6 | test_015 shared _014's strict validator, penalizing the honest ask branch | 2 | fixed (retagged; V4 dual-branch validator) |
| F7 | three runs on one test, the third never queried the timelines section | 4 | fixed (SKILL.md Step 1 rewritten; V3 validator) |
| F8 | `plans` section's `status` filter matches the plan, never an item -- caused a fresh regression on `_001` | 4 | fixed (SKILL.md Step 1a rewritten) |
| - | Prioritization logic / Objective scope match / Dependency awareness dimensions | rubric | deleted from rubric.md |
| - | Question specificity dimension | rubric | kept; validator floor added (V2) |

No tool defect (lane 1) and no record-type craft gap (lane 3) - this skill
touches no record content, so lane 3 is empty by construction, matching the
pattern search-wikipedia's dive noted for the same reason.

---

## Calls made by the lead (2026-08-25)

1. **F2** - tighten SKILL.md Priority 6 rather than leave as-is or defer to
   a nothing-checks issue. Implemented above.
2. **F3 / V1** - add the missing test now. Built as `ut_question_selection_015`
   + `test_disputed_parents_ask_before_formulating`, then the paid run
   falsified V1's premise (see F3) -- the validator was retracted and the
   test kept in revised form.
3. **V2** - build the phrase-list floor now. Implemented as
   `test_new_question_not_vague`.
4. **F4, F5, F6, F7** - fix all of them rather than document-and-defer, once
   the paid runs turned "residual variance" into concrete, quotable
   failures with an identifiable cause each. Implemented above.

---

## Fixes made in this PR

**Skill body** (`packages/engine/plugin/skills/question-selection/SKILL.md`):

- Priority 6 detail paragraph gains two sentences distinguishing a FAN
  pivot (associates/neighbors/witnesses) from an unexhausted direct-evidence
  record type (F2).
- Step 1b rewritten to key its stop condition on the question's `status`
  actually being `resolved`, to name Priority 3 in its carve-out list, and
  to drop the Priority 6 carve-out qualifier that contradicted Priority 6's
  own firing condition (F4).
- Step 3's disputed-assignment ask now states explicitly that once the
  user's own message already states both required pieces, however briefly,
  the skill treats both as answered and does not ask again or demand
  elaboration or provenance beyond what was given (F5).
- Step 1's project-state bullet now names the four `research_query` section
  arguments directly (`timelines`, `conflicts`, `hypotheses`, `log`) and
  states that `project_context` returns none of them (F7).
- Step 1a now states, before its rule, the correct way to check for
  in-progress plan items -- `research_query(section: "plans", questionId:
  <id>)` **without** a `status` filter, reading `items[].status` directly
  -- and names why the filter can't be trusted (it matches the plan's own
  status, never an item's) (F8).

**Reference file**
(`packages/engine/plugin/skills/question-selection/references/pedigree-analysis.md`) -
`pedigree_gap` corrected to `objective_decomposition` (F1).

**Tests** (`eval/tests/unit/question-selection/`)

- `rubric.md` - rewritten: Prioritization logic, Objective scope match, and
  Dependency awareness deleted; Question specificity kept and its
  cross-reference to the deleted scope dimension updated to point at
  `test_new_question_not_record_scoped` instead. Preamble names what still
  catches each retired axis and points at this document.
- `ut_question_selection_015.json` - **new**. The disputed-assignment
  scenario with neither the doubt-evidence nor the birth date/place
  supplied. Went through three shapes across this dive: built first to
  expect the skill to ask and not write (F3's original V1 shape, falsified);
  revised to share `_014`'s strict validator (F6's mistake, also falsified);
  final shape tags it `disputed-parents-missing-info`, its own tag, covered
  by V4, which accepts either honest branch. Complements
  `ut_question_selection_014`'s already-supplied case.

**Validators** (`eval/harness/validators/test_question_selection.py`) -
12 -> 15 functions net:

- `test_new_question_not_vague` (V2) - universal, not tag-gated, since no
  legitimate question should ever match its phrase list.
- `test_disputed_parents_ask_before_formulating` (V1) - added, run once,
  removed in this same PR after the run showed its premise was wrong for a
  single-turn harness (F3).
- `test_timelines_queried_before_deciding` (V3) - tag-gated on
  `selection-basis-timeline-gap`; fails unless `tool_calls` shows a
  `research_query` call with `section: "timelines"` (F7).
- `test_disputed_parents_missing_info_handled` (V4) - tag-gated on
  `disputed-parents-missing-info`; accepts a correctly-framed written
  question (checked mechanically) OR a substantial reply when nothing was
  written (length only -- whether the reply asks the right two things well
  is the judge's call, via this test's `judge_context`, after two phrase-list
  patches each fell to a fresh paraphrase) (F6).

### Every new check was proven to fail

- `test_new_question_not_vague`: run standalone against the 7 distinct
  questions actually written across the corpus's 14 original tests (the
  other 7 tests correctly write none) and against 6 known-bad examples
  drawn from `rubric.md`'s own `fail` bullet and `question-formulation.md`'s
  Common Failures table: **0/7 false positives, 0/6 missed.** Confirmed
  live across four paid runs: it never fired.
- `test_disputed_parents_ask_before_formulating` (V1, since removed): did
  fire, correctly by its own rule, on `ut_question_selection_015` in the
  first paid run -- which is exactly how its rule was discovered to be
  wrong. A check proven to fire is not the same as a check proven correct.
- `test_timelines_queried_before_deciding` (V3): fired correctly on the
  exact case it was written for -- `ut_question_selection_006`,
  `v1_2026-08-26_10-42-10` -- before it existed to catch it; added after
  reading that failure, not blind.
- `test_disputed_parents_missing_info_handled` (V4): checked against both
  observed `_015` branches across the three runs -- the written,
  correctly-framed question (runs 1 and 2) and the ask-only reply with no
  question written (run 3) -- passes both. Run 3 is the case that broke
  the old shared validator (`test_first_question_tests_disputed_parents`,
  which hard-fails on no question written); V4 passes it instead.

## Run history

| Run | Result | What it found / confirmed |
|---|---|---|
| `v1_2026-08-26_10-12-07` | 13 pass / 2 fail, $2.21, 216s | F3/V1 falsified on `_015`; F4 first sighting on `_006` (looked like a possible flake at this point) |
| `v1_2026-08-26_10-26-24` | 13 pass / 2 fail, $2.01, 189s | V1 retraction confirmed fixing `_015`; F4 recurred on `_006` **and** newly on `_005` -- two independent tests, same contradiction, upgraded from suspected flake to confirmed doctrine bug |
| `v1_2026-08-26_10-42-10` | 12 pass / 3 fail, $2.27, 220s | F4's fix confirmed (`_005` now passes); surfaced F5 (`_014` over-asked), F6 (`_015`'s shared validator penalized a legitimate ask), F7 (`_006`'s tool-call miss on `timelines`) |
| `v1_2026-08-26_11-33-37` | 13 pass / 2 fail, $2.27, 276s | F5 and F7 confirmed fixed (`_014`, `_006` pass); surfaced F8 (`_001`'s fresh regression, the `plans` `status`-filter trap) and the judge_context half of F6 (`_015` failed on Completeness despite V4 passing it) |
| `v1_2026-08-26_11-44-15` | 14 pass / 1 fail, $2.33, 210s | F8 confirmed fixed (`_001` passes); F6's judge_context fix confirmed (no Completeness penalty); surfaced a second, narrower V4 bug -- the phrase list did not recognize "what made you doubt" as an evidence-ask |
| `v1_2026-08-26_11-50-26` | 14 pass / 1 fail, $2.10, 170s | broadened phrase list still failed on a third paraphrase ("what made X look wrong as Y's parents") -- V4 redesigned to drop content phrase-matching for the ask branch entirely, deferring to the judge |
| next run (pending) | -- | verifies the redesigned V4; intended to be the releasable candidate |

One additional run was discarded before the table above: a first attempt
aborted from an abort-storm breaker after this session ran the harness's own
pytest suite concurrently with the paid eval run by mistake -- a
self-inflicted resource-contention failure with no signal about the skill,
not counted here or in the cost below.

## Cost

Six counted paid runs so far against the issue's one-run budget, plus one
more planned before this is releasable. Each earned its cost: $2.21
falsified V1's premise, $2.01 upgraded F4 from a suspected flake to a
confirmed doctrine contradiction, $2.27 confirmed F4's fix while surfacing
F5, F6 and F7, $2.27 confirmed F5 and F7's fixes while surfacing F8 (a
fresh regression on a previously-untouched test) and the judge_context half
of F6 that the validator-only fix had missed, $2.33 confirmed F8 and the
judge_context fix while surfacing one more phrase-list gap in V4, and $2.10
proved that gap was not the last one -- a second broadening fell to a third
paraphrase, which is what settled the redesign rather than a fourth patch. Unlike this dive's first
draft (which stopped at three runs and recorded F5-F7 as unresolved
variance under the project's `runs_per_test: 1` policy), each had a
concrete, single, fixable cause once read against the actual tool calls and
actual wording -- not draw noise, so the policy against chasing single-run
flakiness does not apply to any of them. `eval/runlogs/unit/question-selection/`
retention keeps the newest 5 candidates; earlier scratch/candidate logs
from this session have already been pruned by the harness itself (commit
the deletions).

The next run's result becomes the releasable candidate; it still needs its
`review_sample` annotated through the CRUD UI before release (not done here
-- unit `.ann.json` files are written only by that UI, never by hand). The
suite goes 14 tests -> 15.
