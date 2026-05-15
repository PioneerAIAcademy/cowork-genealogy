# Search Records Rubric

Grading dimensions for search-records unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Search strategy

Did the skill construct appropriate search parameters from the plan item? Name variants, date ranges, and jurisdictions should be informed by the research context.

- **pass:** Search parameters include name variants relevant to the time period, the date range matches what the plan item specifies, and jurisdictions match the target locality. Rationale explains why these parameters were chosen.
- **partial:** Parameters are reasonable but a relevant variant is missed (e.g., no Anglicization variants for an Irish-origin name) or the date range is wider/narrower than the plan item suggested.
- **fail:** Parameters are bare (just first + last name, no variants, no date range, no jurisdiction); the search wouldn't be effective.

## Result triage

Did the skill correctly categorize results as promising, not relevant, or needs review? Near-matches should be flagged, not silently discarded.

- **pass:** Each result is categorized with reasoning citing specific matching attributes (e.g., "matches on name and county but age is 3 years off — flagged for review").
- **partial:** Most results triaged correctly but one near-match is silently discarded, or one clearly-irrelevant result is flagged as promising.
- **fail:** Results are bulk-categorized without per-record reasoning; near-matches treated identically to irrelevant matches.

## Log quality

Does the log entry accurately record what was searched, how many results were examined, and what was captured? Negative results must be logged honestly — they support exhaustiveness claims.

- **pass:** Log entry has `query` populated with actual search parameters, `results_examined` reflects the count, `captured_source_ids` lists the right sources, `notes` adds context for future review.
- **partial:** Log entry is mostly accurate but a count is approximate or `notes` is missing context that would help future review.
- **fail:** Log entry omits the query, misreports the results_examined count, or fails to capture sources that were actually used.
