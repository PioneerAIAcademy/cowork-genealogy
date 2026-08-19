# Search Full Text Rubric

Grading dimensions for search-full-text unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Query construction

Did the skill construct effective full-text search queries using appropriate operators? Queries should use the right operators for FTS (which does not auto-expand abbreviations or apply phonetic matching). Jurisdiction/date/record-type scope, when the prompt or research state supplies it, belongs on a second-or-later call, applied only after an unfiltered first call reveals the hit count — never baked into the first call for a topic.

This dimension grades the queries the skill *actually executed*, not a wishlist of variants it could have tried. Spelling variants and abbreviation forms (Flinn, Wm, Thos) are valuable but only required when the prompt or initial results signal that a variant is plausible.

- **pass:** Queries use the search engine's operators correctly (phrase quoting, `+`/`-`, `?`/`*` wildcards), leave the first call for a topic unscoped and apply jurisdiction/date/record-type scope only afterward as post-search filters, and use the right field (Name vs. Keywords) for the query intent. A canonical-spelling query that returns the expected record is acceptable.
- **partial:** Queries are effective but mishandle an obvious operator or scoping decision (e.g., use OR-default by omitting `+`, put place in the query field instead of using filters, or send `recordPlace*`/`yearFrom`/`yearTo`/`recordType` on the FIRST `fulltext_search` call for a plan item before any unfiltered hit count has been observed — those are post-search filters per SKILL.md and query-syntax.md and must wait for a second call), OR the prompt explicitly suggests a variant is needed and the skill omits it.
- **fail:** Queries are bare strings with no operators; the genealogist would have to re-search from scratch to get useful coverage; OR the research-log entry's `query` object records a place/date/collection filter that the `fulltext_search` tool call visible in the call log never actually sent — check the executed args, not just the narrated summary.

## FAN awareness

Did the skill look for Family, Associates, and Neighbors when the prompt or research state warranted it? Witness signatures, neighbor listings, and business associates can provide indirect evidence. **For direct subject searches the skill is not required to pivot to FAN unprompted — grade pass if the requested search executes correctly.**

- **pass:** Either (a) at least one query targets FAN persons with a rationale, OR (b) the prompt is a direct subject search ("find X as beneficiary in Y", "search for X in record class Z") — in case (b), the dimension passes solely on whether the requested search executed; the skill is NOT expected to unprompted-expand to FAN, acknowledge "missed FAN opportunities", or suggest follow-up FAN searches. Judges must not score partial on the grounds that the skill could have but did not pivot to FAN.
- **partial:** Prompt or research state called for FAN exploration but the FAN query is too broad or its rationale missing.
- **fail:** Prompt or research state clearly called for FAN, and the skill produced no FAN query and no acknowledgement of FAN evidence.

## Negative result handling

Did the skill log negative results with enough detail to support exhaustiveness claims? "No results" is different from "searched X, Y, Z collections with queries A, B, C — no results."

**When every executed search returned positive results, this dimension has nothing to grade — score `pass`. Judges must NOT score partial on the grounds that the skill's exhaustiveness narrative for a positive-result test could have been more explicit; the dimension only fires when at least one search returned zero results.**

- **pass:** Either (a) all executed searches returned results (nothing to grade), OR (b) the negative log entries capture the collections searched, the queries used, and what was examined (e.g., "0 results for 'Flynn' in the 1900 census Pennsylvania state-wide index, plus a 100-result browse of Schuylkill County images").
- **partial:** At least one search returned zero results AND the negative entry captures the query but not the breadth of the search (no mention of how many results were examined, or which collections were skipped).
- **fail:** At least one search returned zero results AND the negative entry is bare ("nothing found") with no detail that would support a future exhaustive-search declaration.
