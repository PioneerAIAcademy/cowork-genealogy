# Search Full Text Rubric

Grading dimensions for search-full-text unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Query construction

Did the skill construct effective full-text search queries using appropriate operators? Queries should account for spelling variants and name patterns relevant to the time period.

- **pass:** Queries use the search engine's operators where appropriate (phrase quoting, soundex/wildcards, boolean), include spelling variants that match the time period (O'Brien / OBrien / Obrien / O Brien), and are scoped to plausible jurisdictions/collections.
- **partial:** Queries are effective but miss one obvious variant or operator that would have widened the search.
- **fail:** Queries are bare strings with no variant handling; the genealogist would have to re-search to get useful coverage.

## FAN awareness

Did the skill look for Family, Associates, and Neighbors — not just the research subject? Witness signatures, neighbor listings, and business associates can provide indirect evidence.

- **pass:** At least one query targets FAN persons (witnesses, neighbors, named associates from the research state), with rationale explaining what evidence the FAN search would surface.
- **partial:** FAN persons are mentioned but the query only loosely targets them (e.g., a too-broad surname search).
- **fail:** All queries target only the research subject; FAN evidence is ignored.

## Negative result handling

Did the skill log negative results with enough detail to support exhaustiveness claims? "No results" is different from "searched X, Y, Z collections with queries A, B, C — no results."

- **pass:** Negative log entries capture the collections searched, the queries used, and what was examined (e.g., "0 results for 'Flynn' in the 1900 census Pennsylvania state-wide index, plus a 100-result browse of Schuylkill County images").
- **partial:** Negative entries capture queries but not the breadth of the search (no mention of how many results were examined, or which collections were skipped).
- **fail:** Negative entries are bare ("nothing found") with no detail that would support a future exhaustive-search declaration.
