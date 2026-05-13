# Search External Sites Rubric

Grading dimensions for search-external-sites unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## URL generation

Did the skill generate a correctly pre-filled search URL for the target site (Ancestry, MyHeritage, etc.)? The URL should include the search parameters from the plan item.

- **pass:** Generated URL targets the correct site's search endpoint, includes all relevant search parameters from the plan item (name, date range, place), and is syntactically valid.
- **partial:** URL targets the right site but is missing a search parameter the plan item specified, or uses a less-effective query encoding.
- **fail:** URL targets the wrong site, has malformed query parameters, or omits the core search terms entirely.

## Capture guidance

Did the skill provide clear instructions for the click-capture workflow? The user needs to know what to look for and how to return results.

- **pass:** Instructions name what records the user should look for, how to save them (PDF download, copy-paste), and how to return the capture.
- **partial:** Instructions exist but are generic ("save anything that looks relevant") without naming specific result types or saving steps.
- **fail:** No instructions provided, or instructions assume the user knows the workflow already.

## Result triage

After receiving a capture, did the skill correctly identify relevant records and distinguish them from false positives?

- **pass:** Each result in the capture is categorized (relevant / needs review / not relevant) with reasoning that cites specific matching or non-matching attributes.
- **partial:** Most results triaged correctly but one near-match is mis-categorized as either relevant or irrelevant without justification.
- **fail:** Results are bulk-accepted or bulk-rejected without per-record reasoning, or relevant records are silently dropped.
