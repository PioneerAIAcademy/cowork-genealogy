# Evaluate Search Results Rubric

Grading dimensions for evaluate-search-results unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

evaluate-search-results judges ONE full-text search hit against ONE tree person, records the verdict (Match, Possible Match or Not a Match) and whether the hit holds a vital fact the person lacks as one `hit_verdicts` row, and returns four contract lines, a `---`, and a plain summary. It labels and never extracts; a request to extract, or a delegation with no single hit ref, is handed back with no tool call.

Harness note: `project_context`, `sidecar_read`, `tree_query` and `research_append` run live against the scenario, so what they return is the project's real state. `research_append` refuses `new_vital_info: true` beside `not_a_match` and on a hit some assertion already cites; a refusal followed by a corrected resend is the documented path, not a fault. The single row, the one read of the hit, the `tree_query` arguments, the gold verdict and flag, and the contract lines are checked deterministically (`eval/harness/validators/test_evaluate_search_results.py`); do not re-grade those mechanics here.

## Verdict reasoning

Does the rationale name the facts that decide the verdict, read from the hit and the tree?

- **pass:** The rationale names the deciding facts on both sides: who in the hit could be the person, and the name, place, date or relative that ties them or rules them out. A Match names at least one point beyond the name; a Possible Match says what is consistent and what is missing or garbled; a Not a Match names the point that rules the person out, such as a different place in the same years or a different man of the same given name.
- **partial:** The verdict follows from the facts, but the rationale is vague ("details match") or names only the name.
- **fail:** The rationale rests on something the hit does not say, ignores a fact in the hit that rules the person out, or adopts a verdict the delegation stated without checking it.

## New vital information

Is the flag judged against the tree by the agent's rules, and does the rationale say which fact makes it new?

The rules: a birth or death is new when the hit dates or places it and the person has no fact of that group with a date or place; a spouse, parent or child is new when no one on the person's edges matches by name; a marriage is new when the hit dates or places it and the Couple carries no Marriage fact with a date or place; a fact about a relative counts only through that relative's relationship to the person; the flag is false for a Not a Match and for a hit already extracted.

- **pass:** A true flag names the fact the tree lacks; a false flag is false for a reason the rules give (nothing new, a relative already on an edge, a Not a Match, or already extracted).
- **partial:** The flag is right but the rationale does not say what makes it new or not.
- **fail:** The flag counts a fact the tree already holds, a residence, or an undated mention of a relative already on an edge, as a vital fact, or a fact about someone who is not the person.

## Summary for the user

Is the text after the `---` one or two plain sentences a beginner can read?

- **pass:** It says what the record is (its kind, date and place), whether it is the person and the fact that decided it, and whether it holds something the tree lacks, with no label, heading, field name, file name or identifier.
- **partial:** It carries the substance but includes an identifier or a field name, or runs past two sentences.
- **fail:** There is no summary after a `---`, or the summary contradicts the verdict or the flag.
