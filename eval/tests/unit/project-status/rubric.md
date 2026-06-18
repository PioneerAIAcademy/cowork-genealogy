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

## Both summaries present

Did the skill produce BOTH required outputs — the detailed GPS-state
summary (for experienced genealogists) and the plain-language narrative
(for casual users)? This is a hard dual-output invariant from SKILL.md
("Always produce both summaries"), graded independently of how good
either one is. N/A on negative routing tests, where the skill correctly
hands off and produces neither.

- **pass:** Both summaries are present and distinct — a structured
  GPS-state report (question status, GPS elements, counts, conflicts,
  hypotheses, exhaustiveness, proof tier) AND a separate plain-language
  narrative that explains reliability conversationally rather than in GPS
  jargon. (SKILL.md asks for the user-friendly one first, then the
  detailed one; presence of both matters more than order.)
- **partial:** Both are attempted but one is degenerate — e.g., the
  "user-friendly" version just restates the detailed report's jargon, or
  the detailed report is a thin paragraph missing most GPS structure. Two
  outputs nominally exist but they don't serve their two distinct
  audiences.
- **fail:** Only one summary is produced (detailed-only or
  narrative-only), violating the dual-output invariant.
