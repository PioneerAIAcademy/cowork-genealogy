# Question Selection Rubric

Grading dimensions for question-selection unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

Three dimensions this rubric previously carried were retired by the #1668
deep dive after scoring 3 on every test in every committed run log
(`v1_2026-08-13_13-01-37.json`): Prioritization logic, Objective scope
match, and Dependency awareness. Each is now covered by a validator in
`eval/harness/validators/test_question_selection.py` instead —
`test_selection_basis_*` and `test_question_selection_no_new_question` for
prioritization; `test_new_question_not_record_scoped` and
`test_new_question_excludes_out_of_scope_persons` for scope; and
`test_depends_on_nonempty`/`test_first_question_depends_on_empty` for
dependency awareness (the rationale-quality half of each, and `unblocks`
being populated correctly rather than merely resolvable, still has no
mechanical check — see the deep-dive findings doc). Deleting them drops
their scores from this skill's weighted-mean denominator with no behaviour
change behind the move. See
`docs/deep-dives/question-selection-findings-2026-08-25.md`.

**Why a "why" objective is converted rather than researched** (issue #2003,
ruled 2026-09-17; graded by `ut_question_selection_d05` and
`test_motivation_objective_decomposed`). The agent's typology closes at two
types, relationships and events, and a motivation is neither: no record states
it to a tier, so a "why" question cannot be resolved. The agent therefore
writes a relationship or event question the reason rests on, and tells the user
the reason is explained from historical context instead of proved. A
first-class motivation type was rejected. It would need a `question_kind` field,
a closed-enum change across eight schema sites, and its enforcing rule joins a
question to its plan items, which no writer-tool precondition can do (issue
#2475), so it would still degrade to prose. The stated date window bounds the
questions, not the evidence cited in answering them. The tester's report also
had a planning half, that a date window was treated as a cap on what to
search; that moved to issue #1830's `research-plan` block and is not graded
here. No e2e fixture poses a "why" question (0 of 136, measured 2026-09-14), so
a green unit run shows the rule fires in fresh context and nothing more.

## Question specificity

Is the research question specific and answerable? "Learn more about Patrick" is not a research question. "What is Patrick Flynn's birthplace?" is.

Specificity is about naming the **fact** precisely — the person, the period, the fact sought. It is *not* about narrowness, and naming a record set is not a way to earn it: scope is now enforced by `test_new_question_not_record_scoped` instead, and a question can pass here while failing that check.

- **pass:** Question is concrete enough that a follow-up search could be designed to answer it; names specific persons, time periods, or facts being sought.
- **partial:** Question is mostly specific but has a fuzzy edge ("What more can we learn about Patrick's early life?" — better than "learn more about Patrick" but still vague on what facts).
- **fail:** Question is too broad to drive a search ("Who is Patrick Flynn?", "Learn about the Flynn family").
