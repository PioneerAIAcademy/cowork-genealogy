# Search Full Text Rubric

Grading dimensions for search-full-text unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Query construction

Did the skill construct effective full-text search queries using appropriate operators? Queries should use the right operators for FTS (which does not auto-expand abbreviations or apply phonetic matching). Date and record-type filters are allowed but treated cautiously since collection metadata dates can be off. A filtered search that returns zero results must be followed by an unfiltered retry for the same topic before logging the nil. When a name-field search returns nil, the skill should retry with the keywords field before concluding the name is absent (NLP tagging may have failed).

This dimension grades the queries the skill *actually executed*, not a wishlist of variants it could have tried. Spelling variants and abbreviation forms (Flinn, Wm, Thos) are valuable but only required when the prompt or initial results signal that a variant is plausible.

- **pass:** Queries use the search engine's operators correctly (phrase quoting, `+`/`-`, `?`/`*` wildcards), and use the right field (Name vs. Keywords) for the query intent. When a filtered search returns zero results, an unfiltered retry follows. When a name-field search returns nil, a keywords retry follows before concluding the name is absent. When results exceed ~500, the skill narrows via includeFacets + facet-derived `collectionId` OR adds non-required probable words to boost relevant hits. A `collectionId` is allowed only when the same turn's prior call for that topic sent `includeFacets: true` — a borrowed collectionId (no prior facet call) is a fail. Do not use plain-text `recordPlace*` parameters — they return zero results in production; only `collectionId` (from facets) and year/record-type filters are safe.
- **partial:** Queries are effective but mishandle an obvious operator or scoping decision (e.g., use OR-default by omitting `+`, put place in the `place` query field instead of filtering, fail to follow a nil with an appropriate retry, or report >500 results unfiltered without narrowing), OR the prompt explicitly suggests a variant is needed and the skill omits it.
- **fail:** Queries are bare strings with no operators; the genealogist would have to re-search from scratch to get useful coverage; OR the research-log entry's `query` object records a filter that the `fulltext_search` tool call never actually sent — check the executed args, not just the narrated summary.

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

## Result triage

Did the skill triage returned results using the fields the tool actually returns, and correctly recognize what a staged result can and cannot tell it? A staged fulltext result carries only flat stubs — `names`, `places`, `dates`, `highlightTerms` (the matched terms as bare strings), `title`, `recordType`, `recordPlace`, `recordDate`; the full transcript (`textDocument`) is stripped from the tool response and no MCP tool reads it back, though it remains on disk at `staged.resultsRef`.

**This dimension fires only when at least one executed search returned results. When every search was nil, there is nothing to triage — score `pass`.**

- **pass:** For returned results, the skill assesses match quality from the stub fields (is the target in `names`/`highlightTerms`; are `recordPlace`/`recordDate`/`places`/`dates` consistent with the person) and, for the "genuine mention vs. false positive" judgment, defers to verifying against the original image rather than claiming to settle context from the staged result. It does not instruct reading a `textDocument` that staging has removed.
- **partial:** Triage is broadly right but leans on a field the staged result does not carry (e.g. reasons about transcript context as though `textDocument` were present), or omits the place/date consistency check when the results warranted it.
- **fail:** No triage of match quality at all (results passed through undifferentiated), or the stated method is premised on the stripped `textDocument` or on a relevance score the tool does not return — so it cannot actually be executed. Reading the transcript back from `staged.resultsRef` is not a fail.
