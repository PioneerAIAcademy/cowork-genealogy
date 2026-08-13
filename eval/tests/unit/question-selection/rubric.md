# Question Selection Rubric

Grading dimensions for question-selection unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Prioritization logic

Did the skill correctly prioritize among competing next-question candidates? Unresolved conflicts > timeline gaps > hypothesis tests > new decompositions. The rationale must explain why the selected question takes priority.

- **pass:** The selected question's `selection_basis` matches the highest-priority signal present in the project state, and the rationale explains why that signal takes priority over other candidates.
- **partial:** Selection is reasonable but the rationale doesn't explicitly compare against the other candidates that were available.
- **fail:** Selection ignores higher-priority signals (e.g., starts a new decomposition while an unresolved conflict is blocking an existing question), or `selection_basis` is mis-assigned.

## Question specificity

Is the research question specific and answerable? "Learn more about Patrick" is not a research question. "What is Patrick Flynn's birthplace?" is.

Specificity is about naming the **fact** precisely — the person, the period, the fact sought. It is *not* about narrowness, and naming a record set is not a way to earn it: scope is graded separately below, and a question can pass here while failing Objective scope match.

- **pass:** Question is concrete enough that a follow-up search could be designed to answer it; names specific persons, time periods, or facts being sought.
- **partial:** Question is mostly specific but has a fuzzy edge ("What more can we learn about Patrick's early life?" — better than "learn more about Patrick" but still vague on what facts).
- **fail:** Question is too broad to drive a search ("Who is Patrick Flynn?", "Learn about the Flynn family").

## Objective scope match

Does the question cover exactly the objective's scope — neither narrowed to a single record nor widened to a person the objective does not cover? This is distinct from specificity: a question can name its fact perfectly and still be scoped wrong. Score `null` (N/A) when the invocation correctly adds no new question.

- **pass:** The question names a fact inside the objective's scope and names no record set. Where the objective is already a single fact, the question restates it at that scope with identifying detail; where the objective holds several independent facts, the question is one of them. Any question concerning a relative states in its rationale how the answer is evidence about the objective's subject.
- **partial:** Scope is broadly right but drifts at one edge — the question names a record alongside the fact ("Who were Patrick's parents according to the 1850 census?"), or it stays on the subject but folds in a second independent fact.
- **fail:** The question is scoped to a record rather than the fact ("Where was Patrick Flynn in the 1850 census?" under an objective of identifying his parents), or it targets a person the objective does not cover — typically the subject's own spouse or children — with no stated evidentiary bearing on the subject.

## Dependency awareness

Does the question account for dependencies — questions that must be answered first, and questions this answer will unblock? The depends_on and unblocks fields should be populated correctly.

- **pass:** `depends_on` and `unblocks` are populated when relevant prior questions exist; if neither applies, both are explicitly empty arrays.
- **partial:** One direction (depends_on or unblocks) is populated but the other is missed.
- **fail:** Both fields are populated incorrectly (depends_on points at unrelated questions, or unblocks omits an obvious successor).
