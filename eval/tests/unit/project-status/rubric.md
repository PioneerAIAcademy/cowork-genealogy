# Project Status Rubric

Grading dimensions for project-status unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Completeness of summary

Did the skill report on all GPS elements — questions, plans, search log, evidence, conflicts, hypotheses, and conclusions? Missing sections should be explicitly noted.

- **pass:** Summary touches every GPS element with state present in research.json; empty sections are explicitly named as such.
- **partial:** Most elements covered but one is omitted (e.g., hypotheses skipped when h_001 exists), or empty sections are silently skipped rather than noted.
- **fail:** Summary covers only a subset of elements; the genealogist couldn't see the full state from the report.

## Accuracy

Does the summary accurately reflect the current state of research.json? Are counts, statuses, and next-step recommendations correct?

- **pass:** All counts (assertions, sources, log entries) match the file; statuses (in_progress vs resolved questions; active vs completed plans) are reported correctly.
- **partial:** Most facts are right but one count is off by one or a status is mis-reported.
- **fail:** Multiple counts wrong, or a major status reported incorrectly (claiming a question is resolved when it's in_progress).

## Actionability

Did the skill clearly identify what should be done next and why? The recommendation should be specific (e.g., "resolve birthplace conflict before writing proof") not generic ("continue research").

- **pass:** Specific next step recommended with reasoning that references actual research state (e.g., "complete the in-progress probate search per pli_006 before re-evaluating the proof summary").
- **partial:** Recommendation is concrete but the reasoning is shallow ("continue with the plan").
- **fail:** Recommendation is generic ("keep researching"), or absent.
