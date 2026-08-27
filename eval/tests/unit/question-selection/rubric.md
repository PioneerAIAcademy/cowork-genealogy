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

## Question specificity

Is the research question specific and answerable? "Learn more about Patrick" is not a research question. "What is Patrick Flynn's birthplace?" is.

Specificity is about naming the **fact** precisely — the person, the period, the fact sought. It is *not* about narrowness, and naming a record set is not a way to earn it: scope is now enforced by `test_new_question_not_record_scoped` instead, and a question can pass here while failing that check.

- **pass:** Question is concrete enough that a follow-up search could be designed to answer it; names specific persons, time periods, or facts being sought.
- **partial:** Question is mostly specific but has a fuzzy edge ("What more can we learn about Patrick's early life?" — better than "learn more about Patrick" but still vague on what facts).
- **fail:** Question is too broad to drive a search ("Who is Patrick Flynn?", "Learn about the Flynn family").
