# Validate Schema Rubric

Grading dimensions for validate-schema unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Error detection

Did the skill detect all schema violations in the input files? Missing required fields, invalid enum values, and broken ID references should all be caught.

- **pass:** All real violations flagged: missing required fields, invalid enum values, broken ID references, pattern mismatches (e.g., `a_001` ID that doesn't match `^a_`).
- **partial:** Most violations caught but one slips through (e.g., flags missing fields but misses an invalid enum value).
- **fail:** Multiple real violations missed; a researcher acting on this validation would still have broken data downstream.

## Error clarity

Are error messages specific enough to locate and fix the problem? Each error should identify the section, field, and what's wrong.

- **pass:** Each error names the section (`conflicts`), the specific entry (`c_001`), the offending field (`disputed_attribute`), and the rule violated (`required when conflict_type is "fact"`).
- **partial:** Errors are mostly specific but one is generic ("schema error in conflicts section") without identifying the specific entry or rule.
- **fail:** Errors are bare ("validation failed") without enough information for the researcher to find and fix the problem.

## False positive rate

Did the skill avoid flagging valid data as errors? Legitimate patterns (null optional fields, empty arrays, valid open enum values) should not trigger warnings.

- **pass:** No false positives. Legitimate patterns (null optional fields, empty arrays, valid open enum values like a new `fact_type` not in the recommended list but documented in notes) pass cleanly.
- **partial:** Mostly clean but one false positive on a borderline pattern (e.g., warning on a valid but uncommon enum value).
- **fail:** Multiple false positives that would create alert fatigue, or rejection of valid optional-field omissions as if they were required-field omissions.
