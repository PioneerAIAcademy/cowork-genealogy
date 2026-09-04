# Research Exhaustiveness Rubric

Grading dimensions for research-exhaustiveness unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Gate reasoning

Did the skill work the 7-point stop criteria as a gate — in order, stopping at the first that fails, and naming it? An exhaustive declaration must be defensible against the criteria, not asserted unilaterally.

This dimension grades the **decision**; `Stop criteria coverage` grades the **content** of each assessment. A run can name the blocking criterion correctly here and still score partial there for saying nothing substantive about it.

- **pass:** The skill evaluates the criteria against the project's log/assertions and either declares only when all seven are met, or declines naming the specific criterion that blocks and the gap under it (e.g., "probate records not yet searched" under `repository_breadth`). The reasoning is grounded in actual log entries, not generic claims.
- **partial:** The skill applies most criteria but glosses over one or two (e.g., asserts "all record types searched" without naming them), or declines naming a gap without tying it to a criterion.
- **fail:** The skill declares exhaustive without applying the criteria, declares without grounding in log entries, or declines without naming what's missing.

## Declaration honesty

Did the skill resist the temptation to declare exhaustive prematurely? An honest "not yet" is a passing outcome — inflated exhaustiveness to make the project look done is a failure.

- **pass:** When record types known to exist for the jurisdiction/period haven't been searched, the skill keeps `declared: false` and lists the gaps. When the user wants to stop early for resource reasons, the skill records `declared: false` with the honest justification, not a workaround that flips it to true.
- **partial:** The skill identifies the gaps but the wording leans optimistic ("substantially exhaustive," "good enough"), or declares true when one criterion is weak but not failed.
- **fail:** Declares `declared: true` with known gaps, or buries the gaps in justification text while flipping the flag.

## Stop criteria coverage

Are the 7 stop criteria assessed with **substance** — each tied to specific project state rather than merely asserted? N/A when the run refuses before evaluating — ANY precondition (classification, identity links, tentative values, an in-flight plan item), or an already-declared question. A decline at a precondition is not a thin assessment; it is a run that never reached the criteria.

**Grade the content, not the presence.** That the seven keys exist at all on a declaring run is asserted deterministically by `test_declared_has_full_stop_criteria` in the skill's validator, so do not spend this dimension on it — a validator names a missing key in one line, where a judge gives an opinion that moves between runs. What only a reader can judge is whether each assessment says anything: "Census, vital records and probate all searched" is an assessment, "Yes" is not. That distinction applies on both paths — as object values when the run declares, as named prose when it declines. An earlier revision narrowed this dimension to the declining path and so left a declaration with seven one-word criteria graded by nothing at all.

**A decline owes the blocking entry, not all seven.** The stop criteria are a gate assessed in order, stopping at the first that fails, so a correct decline names one criterion and is not thin for leaving the other six unassessed. Grade a declaration on all seven and a decline on the one that blocks.

**On a decline, a placeholder against the six is correct, not boilerplate.** `exhaustive_declaration.stop_criteria` requires all seven keys, so a declining run that writes the object must put something in the six it never reached — "Not assessed — repository_breadth blocks" is the gate working, and the generic-boilerplate bar below does not apply to those six. Grade only the blocking entry. A run that instead invents substantive-sounding assessments for criteria it stopped before reaching is the actual failure, because the gate stopped and the write says otherwise.

- **pass:** When declaring, all seven criteria (`goal_alignment`, `repository_breadth`, `original_substitution`, `independent_verification`, `evidence_class`, `conflict_resolution`, `overturn_risk`) carry a 1–2 sentence assessment tied to a specific log entry or assertion, as object values. When declining, the blocking criterion is named and carries that same substance; the remaining six are not owed.
- **partial:** When declaring, all seven are present but at least one is generic boilerplate ("yes" with no specifics). When declining, the blocking criterion is named but its assessment is generic.
- **fail:** When declaring, any of the seven is missing, or the assessments are all generic without reference to project state. When declining, no blocking criterion is named, or one is named with no assessment at all.
