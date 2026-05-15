# Question Selection Rubric

Grading dimensions for question-selection unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Prioritization logic

Did the skill correctly prioritize among competing next-question candidates? Unresolved conflicts > timeline gaps > hypothesis tests > new decompositions. The rationale must explain why the selected question takes priority.

- **pass:** The selected question's `selection_basis` matches the highest-priority signal present in the project state, and the rationale explains why that signal takes priority over other candidates.
- **partial:** Selection is reasonable but the rationale doesn't explicitly compare against the other candidates that were available.
- **fail:** Selection ignores higher-priority signals (e.g., starts a new decomposition while an unresolved conflict is blocking an existing question), or `selection_basis` is mis-assigned.

## Question specificity

Is the research question specific and answerable? "Learn more about Patrick" is not a research question. "What is Patrick Flynn's birthplace?" is.

- **pass:** Question is concrete enough that a follow-up search could be designed to answer it; names specific persons, time periods, or facts being sought.
- **partial:** Question is mostly specific but has a fuzzy edge ("What more can we learn about Patrick's early life?" — better than "learn more about Patrick" but still vague on what facts).
- **fail:** Question is too broad to drive a search ("Who is Patrick Flynn?", "Learn about the Flynn family").

## Dependency awareness

Does the question account for dependencies — questions that must be answered first, and questions this answer will unblock? The depends_on and unblocks fields should be populated correctly.

- **pass:** `depends_on` and `unblocks` are populated when relevant prior questions exist; if neither applies, both are explicitly empty arrays.
- **partial:** One direction (depends_on or unblocks) is populated but the other is missed.
- **fail:** Both fields are populated incorrectly (depends_on points at unrelated questions, or unblocks omits an obvious successor).
