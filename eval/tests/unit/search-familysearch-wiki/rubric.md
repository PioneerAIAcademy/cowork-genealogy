# Search-FamilySearch-Wiki Rubric

Grading dimensions for search-familysearch-wiki unit tests. Evaluated by the LLM judge alongside the base dimensions (correctness, completeness, tool arguments).

## Log entry saved correctly

Did the agent log the guidance as one research-log entry, with the filled template in its notes?

The entry appears in the file changes summary as a new `log` entry (`tool: "wiki_search"`). One test (`ut_search_wiki_014`, tagged `no-project`) runs with no project: there nothing is logged, `(no file changes)` is correct, and the agent returns the filled template above its `---` line instead — grade that return as the deliverable. Grade the agent's returned text, never the `notes` argument of its refused `research_log_append` call: a return carrying only the Sources bullets, without the `# FamilySearch Wiki:` heading and the summary, is a **fail** even when the refused call's notes held the full template.

- **pass:** Exactly one new `wiki_search` log entry whose notes open with `# FamilySearch Wiki: ` and the question's core noun phrase (e.g. "Italian Birth Records"), followed by the summary and a Sources section; no loose file.
- **partial:** The entry was logged but its notes deviate from the template — a missing heading, the whole question as the topic, or a second entry for the same search.
- **fail:** Nothing was logged when results were returned (outside the no-project test), or the guidance was saved as a file instead.

## Sources cited correctly

Did the skill include a sources section with properly formatted links drawn from the wiki results?

- **pass:** Every result drawn from has a bullet in the Sources section formatted as `- [page_title — section_heading](source_url)`, using the actual URLs from the tool response.
- **partial:** Sources are present but at least one is missing its URL, uses a fabricated URL, or the format deviates noticeably from the required pattern.
- **fail:** No sources section, or sources are listed without URLs, or URLs are fabricated.

**Grading note:** The Sources section is part of the logged entry's notes, which you see in the file changes summary; it need not appear in the text response. The deterministic validator `test_sources_section_matches_wiki_results` checks the bullets against the tool response, so do not score partial or fail solely because the formatted bullet list is not visible in the text response.

## Summary faithful to wiki content

Did the skill synthesise only from what the FamilySearch Wiki returned, without adding facts the wiki did not provide?

- **pass:** Every claim in the summary is traceable to a `chunk_text` in the tool response; no outside facts or fabricated guidance were added.
- **partial:** The summary is mostly faithful but contains at least one claim that goes beyond what the tool returned — plausible but unverified addition.
- **fail:** The summary contains fabricated guidance, specific dates, record names, or repositories not present in the tool response.

**Grading note — binds fixture authors, not this dimension's scoring.** Grade the summary against the `chunk_text` as served. For authors: a hand-authored mock `chunk_text` may not contradict the real page at its `source_url`, and may not draw a coverage or access boundary that page does not draw.

## No-result handling (negative path)

When the FamilySearch Wiki returns an empty results list, did the agent log the nil search, tell the user, and write nothing else?

- **pass:** The agent logged one `wiki_search` entry with `outcome: "negative"`, `results_examined: 0` and no notes, and told the user no wiki guidance was found.
- **partial:** The agent told the user but did not log the nil search, or logged it with notes or a non-negative outcome.
- **fail:** The agent wrote a summary or a file despite empty results, or silently did nothing without informing the user.
- **N/A:** Test did not exercise the empty-results path.
