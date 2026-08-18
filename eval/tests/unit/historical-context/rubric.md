# Historical Context Rubric

Grading dimensions for historical-context unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Relevance to research

Did the skill provide historical context directly relevant to the genealogical research question, not just general history of the time period?

- **pass:** Context ties specifically to the research subject's likely experience (time, place, demographic, occupation) — not a generic encyclopedia summary.
- **partial:** Context is broadly relevant to the period and place but doesn't connect to specific research-relevant attributes of the subject.
- **fail:** Context is generic-era information that could apply to any ancestor; no research-specific framing.

## Source quality

Did the skill draw from reliable historical sources and cite them, with the actual page URL, not just the article's name? Context should be factual, not speculative.

- **pass:** Claims are factual and consistent with mainstream historical scholarship; every wiki/Wikipedia-derived claim carries the actual page URL the tool call returned (`source_url` on `wiki_search` results, `url` from `wiki_read`/`wikipedia_search`) alongside the source name — naming an article by title with no URL does not count as cited.
- **partial:** Mostly factual and sourced, but at least one wiki/Wikipedia-derived claim names its source by title only with no URL attached, or is otherwise speculative/unattributed in a way that affects research utility.
- **fail:** Claims are speculative, fabricated, contradicted by mainstream scholarship, or wiki/Wikipedia-derived claims are presented with no URL anywhere in the response.

## Genealogical implications

Did the skill explain how the historical context affects record availability, migration patterns, naming conventions, or other factors that impact the research?

- **pass:** Context is translated into research-actionable consequences (specific record classes to consult, migration corridors that explain a move, naming-pattern shifts that affect search queries).
- **partial:** Implications are present but generic ("records may be sparse during war years") without naming specific record classes or strategies.
- **fail:** Context is provided but never connected to research consequences — the genealogist would have to do that work themselves.
