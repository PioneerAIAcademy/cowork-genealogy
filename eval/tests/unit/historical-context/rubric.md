# Historical Context Rubric

Grading dimensions for historical-context unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Relevance to research

Did the skill provide historical context directly relevant to the genealogical research question, not just general history of the time period?

- **pass:** Context ties specifically to the research subject's likely experience (time, place, demographic, occupation) — not a generic encyclopedia summary.
- **partial:** Context is broadly relevant to the period and place but doesn't connect to specific research-relevant attributes of the subject.
- **fail:** Context is generic-era information that could apply to any ancestor; no research-specific framing.

## Source quality

Did the skill draw from reliable historical sources? Context should be factual, not speculative or fabricated.

- **pass:** Claims are factual and consistent with mainstream historical scholarship. Any claim the skill could not verify through a tool call is explicitly flagged as unconfirmed general knowledge, not asserted as settled fact.
- **partial:** Mostly factual, but at least one claim is stated with more certainty than the tool results support, without being flagged as unconfirmed.
- **fail:** Claims are speculative, fabricated, or contradicted by mainstream scholarship.

## Citation completeness

If any wiki/Wikipedia tool was called, does the response end with a "Sources
consulted" list — one bullet per page actually used, title linked to its
actual URL (`source_url` on `wiki_search` results, `url` from
`wiki_read`/`wikipedia_search`)? This is a distinct check from Source
quality above — a response can be fully accurate (clean Source quality)
while still failing to link its sources, and vice versa. Grade the
end-of-response list, not inline citation — inline citation of individual
claims is a bonus, not what this dimension requires.

- **pass:** A "Sources consulted" (or equivalently named) list is present and every wiki/Wikipedia page the response actually drew from appears in it with its real URL, not just its title.
- **partial:** A sources list is present but omits at least one page the response actually drew from, or lists a page by title with no URL.
- **fail:** No sources list at all, even though wiki/Wikipedia tools were called and results were used in the response.

## Genealogical implications

Did the skill explain how the historical context affects record availability, migration patterns, naming conventions, or other factors that impact the research?

- **pass:** Context is translated into research-actionable consequences (specific record classes to consult, migration corridors that explain a move, naming-pattern shifts that affect search queries).
- **partial:** Implications are present but generic ("records may be sparse during war years") without naming specific record classes or strategies.
- **fail:** Context is provided but never connected to research consequences — the genealogist would have to do that work themselves.
