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

When the run **declines**, are all 7 stop criteria addressed in prose? N/A on a run that declares, and N/A when the run refuses before evaluating (a plan-item precondition, or an already-declared question).

**This grades the declining path only.** On a declaring run the seven keys are asserted deterministically by `test_declared_has_full_stop_criteria` in the skill's validator, and a validator names the defect in one line where a judge gives an opinion that moves between runs. Grading the same fact twice let the two disagree: on `ut_research_exhaustiveness_017` this dimension has scored 2 / 3 / 1 / 1 across four runs, and the 3 is the one run that declared.

- **pass:** All seven criteria (`goal_alignment`, `repository_breadth`, `original_substitution`, `independent_verification`, `evidence_class`, `conflict_resolution`, `overturn_risk`) are addressed as named prose, each tied to a specific log entry or assertion.
- **partial:** All seven addressed but at least one is generic boilerplate ("yes" with no specifics), or one is missing but the surrounding justification covers it.
- **fail:** Two or more of the seven unaddressed, or the assessments are all generic without reference to project state.
