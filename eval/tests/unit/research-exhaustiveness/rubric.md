# Research Exhaustiveness Rubric

Grading dimensions for research-exhaustiveness unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Threshold reasoning

Did the skill honestly apply the five threshold questions and the 7-point stop criteria? An exhaustive declaration must be defensible against the criteria, not asserted unilaterally.

- **pass:** The skill explicitly evaluates each criterion against the project's log/assertions and either declares only when all criteria are met, or declines with a specific named gap (e.g., "probate records not yet searched"). The reasoning is grounded in actual log entries, not generic claims.
- **partial:** The skill applies most criteria but glosses over one or two (e.g., asserts "all record types searched" without naming them), or names a gap but only vaguely.
- **fail:** The skill declares exhaustive without applying the criteria, declares without grounding in log entries, or declines without naming what's missing.

## Declaration honesty

Did the skill resist the temptation to declare exhaustive prematurely? An honest "not yet" is a passing outcome — inflated exhaustiveness to make the project look done is a failure.

- **pass:** When record types known to exist for the jurisdiction/period haven't been searched, the skill keeps `declared: false` and lists the gaps. When the user wants to stop early for resource reasons, the skill records `declared: false` with the honest justification, not a workaround that flips it to true.
- **partial:** The skill identifies the gaps but the wording leans optimistic ("substantially exhaustive," "good enough"), or declares true when one criterion is weak but not failed.
- **fail:** Declares `declared: true` with known gaps, or buries the gaps in justification text while flipping the flag.

## Stop criteria coverage

Once the skill evaluates exhaustiveness, are all 7 stop criteria addressed — in the `stop_criteria` object when it declares, or in prose when it declines? N/A when the run refuses before evaluating (a plan-item precondition, or an already-declared question).

- **pass:** All seven criteria (`goal_alignment`, `repository_breadth`, `original_substitution`, `independent_verification`, `evidence_class`, `conflict_resolution`, `overturn_risk`) are addressed with 1–2 sentence assessments tied to specific log entries or assertions — as object keys when declaring, or as named prose when declining.
- **partial:** All seven addressed but at least one is generic boilerplate ("yes" with no specifics), or one is missing but the surrounding justification covers it.
- **fail:** Two or more of the seven unaddressed, or the assessments are all generic without reference to project state.
