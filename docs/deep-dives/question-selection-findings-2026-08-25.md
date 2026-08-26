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
finds no matches). No `judge_context` on any of the 14 tests.

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

**Gap:** debatable, not clear-cut - flagging for a call rather than resolving
it myself. Two honest readings:
1. Lane 4: SKILL.md's Priority 6 detail should say explicitly that a FAN
   question targets associates/neighbors/witnesses, not "any unexhausted
   record type," so a land-record search that could itself hold direct
   proof doesn't get labelled fan_pivot.
2. No defect: land records are a conventional FAN-adjacent source (deed
   witnesses are exactly the "associates" FAN methodology means), and the
   question's second clause ("or otherwise document a parent-child
   relationship") is reasonably read as belonging to the same land-record
   search, not a second direct-evidence path.

**Resolved (lead, 2026-08-25): tighten SKILL.md.** Priority 6's detail paragraph now states explicitly that a FAN question targets the people around the subject, not a record type that could itself hold direct proof of the relationship - implemented in this PR.

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

> **Validator request V1 - a disputed-assignment scenario missing the two
> required inputs must produce a reply asking for them**
> **Rule:** on a test tagged (e.g.) verifies-disputed-parents whose fixture
> user message supplies neither the doubt-evidence nor the working
> birth date/place, and whose invocation is not --autonomous, the reply
> text must contain a request for both - and research_append must not be
> called until a follow-up turn supplies them.
> **Where to look:** the test's own input message (does it already carry
> both pieces?) against output.text_response.
> **Why it is not judgment:** the two pieces of information are named
> explicitly in SKILL.md Step 3; whether the reply asks for them is a
> presence check, not an assessment of question quality.
> **What a violation looks like:** a disputed-assignment test with no
> doubt-evidence and no coordinates in its input, whose transcript writes
> q_001 on turn one with no clarifying question asked.
> **Status: implemented (lead approved, 2026-08-25).** New test
> `ut_question_selection_015`, tag `disputed-parents-ask-required`, reuses
> the `disputed-parents-unsourced` scenario with the doubt-evidence and
> coordinates stripped from the user message. New validator
> `test_disputed_parents_ask_before_formulating` in
> `test_question_selection.py`.

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
signal that exists today. Base dimensions (Correctness, Completeness, Tool
Arguments) are also flat 3s across this corpus - question-selection is
one of the sixteen skills in the issue's own measurement where every
dimension, rubric and base alike, never discriminates. None of F1-F3 above
was caught by any grading dimension, rubric or base; each came from reading
the skill body and its reference files against the schema and against what
the corpus actually exercises - a channel no judge dimension replaces. So a
re-run scored 14/14, all 3s on the surviving dimensions, is not evidence the
deletion was safe (the issue is explicit not to write the call from the
re-run scores) and is not evidence it was unsafe either: it is the same
result the suite already gives today, because nothing in either layer was
carrying the signal these findings needed.

---

## Lanes, at a glance

| # | Finding | Lane | State |
|---|---|---|---|
| F1 | pedigree-analysis.md names a non-existent selection_basis enum value | 4 | fixed |
| F2 | FAN-pivot question blurs associates-pivot with unexhausted-direct-evidence | 4 (debatable) | fixed (lead chose: tighten SKILL.md) |
| F3 | disputed-assignment "ask two things" branch has zero test coverage | test-gap | fixed (V1: new test + validator) |
| - | Prioritization logic / Objective scope match / Dependency awareness dimensions | rubric | deleted from rubric.md |
| - | Question specificity dimension | rubric | kept; validator floor added (V2) |

No tool defect (lane 1) and no record-type craft gap (lane 3) - this skill
touches no record content, so lane 3 is empty by construction, matching the
pattern search-wikipedia's dive noted for the same reason.

---

## Calls made by the lead (2026-08-25)

1. **F2** - tighten SKILL.md Priority 6 rather than leave as-is or defer to
   a nothing-checks issue. Implemented above.
2. **F3 / V1** - add the missing test now. Implemented as
   `ut_question_selection_015` + `test_disputed_parents_ask_before_formulating`.
3. **V2** - build the phrase-list floor now. Implemented as
   `test_new_question_not_vague`.

---

## Fixes made in this PR

**Skill body** (`packages/engine/plugin/skills/question-selection/SKILL.md`) -
Priority 6 detail paragraph gains two sentences distinguishing a FAN pivot
(associates/neighbors/witnesses) from an unexhausted direct-evidence record
type (F2).

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
  supplied (F3), mirroring `ut_question_selection_014`'s already-supplied
  case.

**Validators** (`eval/harness/validators/test_question_selection.py`) -
12 -> 14 functions: `test_disputed_parents_ask_before_formulating` (V1,
tag-gated on `disputed-parents-ask-required`) and `test_new_question_not_vague`
(V2, universal - runs on every test, not tag-gated, since no legitimate
question should ever match its phrase list).

### Every new check was proven to fail

- `test_new_question_not_vague`: run standalone against the 7 distinct
  questions actually written across the corpus's 14 tests (the other 7 tests
  correctly write none) and against 6 known-bad examples drawn from
  `rubric.md`'s own `fail` bullet and `question-formulation.md`'s Common
  Failures table: **0/7 false positives, 0/6 missed.** ("Find Irish
  immigrants in the 1850 census" is a different failure mode - no named
  individual - and is correctly out of scope for this phrase-list pattern.)
- `test_disputed_parents_ask_before_formulating`: gated correctly - confirmed
  it skips on all 13 non-tagged tests and on `ut_question_selection_014`
  (which does *not* carry the new tag, since it is the already-supplied
  case), and only activates on the new `ut_question_selection_015`.

## Cost

One `make eval-skill SKILL=question-selection` run, as the issue budgeted.
Every finding and every lead call above batches into it. The suite goes
14 tests -> 15.
