# Search Records Rubric

Grading dimensions for search-records unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Search strategy

Did the skill construct appropriate search parameters from the plan item? Name variants, date ranges, and jurisdictions should match the research context, and the broad-to-narrow default should be followed unless the plan item justifies a narrow start.

- **pass:** Search parameters include the correct surname anchor (or `recordCountry` if surname unknown), a date range that matches the plan item, and a jurisdiction at the right level of specificity. For names with known variant patterns (Irish, German, Eastern European origins), at least one relevant variant or phonetic alternative is included. Rationale or `notes` explains the parameter choices.
- **partial:** Parameters are reasonable but a clearly relevant variant is missed (e.g., no Anglicization variants for an Irish-origin name such as Flynn → Flyn/Flinn), or the date range is significantly wider or narrower than the plan item suggested without explanation, or the jurisdiction is set at the wrong level (country instead of state, or city instead of county).
- **fail:** Parameters are bare (just first + last name, no date range, no jurisdiction); the search would flood results for a common name or miss indexed variants. Or the required anchor (`surname` or `recordCountry`) is absent entirely.

## Result triage

Did the skill correctly evaluate each result against the research subject? Near-matches must be flagged for review — not silently dropped, not treated as confirmed matches. The skill should use `same_person` scores to support (not replace) its own reasoning, and check `source_attachments` to identify what is already in the tree.

- **pass:** Each result is categorized as promising / needs-review / not-relevant with per-record reasoning citing specific matching attributes (e.g., "name and county match but age is 3 years off — flagged needs-review"). `same_person` score is cited where called, and the score range (>0.7 strong, 0.4–0.7 possible, <0.4 weak) informs the category. Attachment status from `source_attachments` is noted for each result (already attached / attached to different person / unattached). A low `same_person` score is not used as the sole reason to dismiss a result when other contextual evidence (age, place, household) supports a match.
- **partial:** Most results triaged correctly but one near-match is silently discarded without reasoning, or `same_person` is called but the score is treated as the final word without contextual cross-check, or attachment status is checked but not factored into prioritization for extraction.
- **fail:** Results are bulk-categorized without per-record reasoning (e.g., "no matches found" when the fixture returned near-matches); near-matches treated identically to irrelevant matches; or `same_person` / `source_attachments` not called when results are present and the tools are available.

## Log quality

Does every search — including nil searches — produce a log entry that honestly records what was queried, how many results were examined, and the outcome? The log is the audit trail for exhaustiveness claims.

- **pass:** Log entry has `query` populated with the actual search parameters used, `results_examined` matches the count of results reviewed, `outcome` is accurate (`positive` / `negative` / `partial` / `error`), `results_ref` points to the sidecar file for positive searches and is `null` for nil searches, and `notes` gives a one-line human summary useful for future review.
- **partial:** Log entry is mostly accurate but a count is approximate (e.g., "approximately 3" instead of "3"), or `notes` is absent or too vague to be useful for future review, or `results_ref` is present but the path is wrong.
- **fail:** Log entry omits the `query` field, misreports `results_examined`, records the wrong `outcome`, or — most critically — no log entry is written at all. Every search must produce a log entry; a nil result with no log entry is an invisible search that cannot support exhaustiveness claims.

## Sidecar correctness

Did the skill write a result sidecar for positive searches and skip it for nil searches? This is the headline invariant: a positive search writes `results/<log_id>.json`; a search that returns zero results writes no sidecar.

- **pass:** Positive search: sidecar written at the correct path (`results/<log_id>.json`), contains the verbatim `record_search` payload, and `returned_count` matches the number of results in the payload. Nil search: no sidecar created.
- **partial:** Sidecar written for a positive search but `returned_count` is wrong (off-by-one or approximate), or the sidecar path does not match the `results_ref` in the log entry, or the payload is truncated without explanation.
- **fail:** Sidecar missing for a positive search (data loss — the results cannot be reviewed later); or a sidecar created for a nil search (the nil invariant is violated and false evidence is stored); or `log_id` in the sidecar does not match the log entry.

## Nil escalation

When a search returns no results, did the skill treat the nil as a finding to investigate — not an endpoint? The SKILL.md requires iterating through strategy levers (name variants, date widening, jurisdiction broadening) and logging each retry separately before declaring the search exhausted.

- **pass:** After a nil result, the skill tries at least 2–3 meaningful variations (e.g., phonetic surname variant, wider date range, higher jurisdiction level, wildcard on a suspect letter). Each retry is logged as its own entry. After exhausting reasonable levers, the skill assesses whether absence is meaningful — noting whether the record type existed in the jurisdiction, whether the collection is reasonably complete, and whether the subject should have appeared.
- **partial:** Skill tries one variant but stops short of exhausting the obvious levers for the record type and name origin, or tries multiple variants but logs them all under one entry instead of separately, or concludes the search negative without assessing whether the nil is meaningful evidence.
- **fail:** Skill gives up immediately after the first nil result with no variant attempts; or declares "record does not exist" without checking whether the database covers the target period; or conflates "not found in this index" with "does not exist in any source."
