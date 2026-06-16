# Search Full Text Rubric

Grading dimensions for search-full-text unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Query construction

Did the skill construct effective full-text search queries using appropriate operators? Queries should use the right operators for FTS (which does not auto-expand abbreviations or apply phonetic matching) and be scoped to plausible jurisdictions where the prompt supplies one.

This dimension grades the queries the skill *actually executed*, not a wishlist of variants it could have tried. Spelling variants and abbreviation forms (Flinn, Wm, Thos) are valuable but only required when the prompt or initial results signal that a variant is plausible.

- **pass:** Queries use the search engine's operators correctly (phrase quoting, `+`/`-`, `?`/`*` wildcards), are scoped to plausible jurisdictions/collections when supplied, and use the right field (Name vs. Keywords) for the query intent. A canonical-spelling query that returns the expected record is acceptable.
- **partial:** Queries are effective but mishandle an obvious operator or scoping decision (e.g., use OR-default by omitting `+`, put place in the query field instead of using filters), OR the prompt explicitly suggests a variant is needed and the skill omits it.
- **fail:** Queries are bare strings with no operators; the genealogist would have to re-search from scratch to get useful coverage.

## FAN awareness

Did the skill look for Family, Associates, and Neighbors — not just the research subject? Witness signatures, neighbor listings, and business associates can provide indirect evidence.

This dimension applies ONLY when the user's prompt is for FAN exploration (e.g., "search for witnesses mentioning [person]", "find Flynn as a neighbor", "look for the family in others' records"). When the user's prompt is for a direct subject search in a specific record class (e.g., "search for Patrick Flynn as beneficiary in probate", "find John Smith in deed indexes"), this dimension is N/A regardless of whether the research state contains other named persons — the skill is graded on whether it executed the requested search, not on whether it independently expanded to FAN.

- **pass:** Applies — at least one query targets FAN persons (witnesses, neighbors, named associates from the research state), with rationale explaining what evidence the FAN search would surface.
- **partial:** Applies — FAN persons are mentioned but the query only loosely targets them (e.g., a too-broad surname search).
- **fail:** Applies — all queries target only the research subject; FAN evidence is ignored.
- **N/A:** The user's prompt is a direct subject search, not a FAN exploration request.

## Negative result handling

Did the skill log negative results with enough detail to support exhaustiveness claims? "No results" is different from "searched X, Y, Z collections with queries A, B, C — no results."

- **pass:** Negative log entries capture the collections searched, the queries used, and what was examined (e.g., "0 results for 'Flynn' in the 1900 census Pennsylvania state-wide index, plus a 100-result browse of Schuylkill County images").
- **partial:** Negative entries capture queries but not the breadth of the search (no mention of how many results were examined, or which collections were skipped).
- **fail:** Negative entries are bare ("nothing found") with no detail that would support a future exhaustive-search declaration.
