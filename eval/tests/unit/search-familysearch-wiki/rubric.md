# Search-FamilySearch-Wiki Rubric

Grading dimensions for search-familysearch-wiki unit tests. Evaluated by the LLM judge alongside the base dimensions (correctness, completeness, tool arguments).

## File saved correctly

Did the skill save the output as a markdown file with the correct slug filename?

- **pass:** A file was written to the working folder with a slug derived from the topic — lowercased, non-alphanumeric runs replaced with a single hyphen, no leading or trailing hyphens (e.g. "Italian birth records" → `italian-birth-records.md`).
- **partial:** A file was saved but the slug has a minor error — wrong case, extra hyphens, or a slightly wrong name that is still recognisably the topic.
- **fail:** No file was saved when results were returned, or the filename bears no relation to the topic.

## Sources cited correctly

Did the skill include a sources section with properly formatted links drawn from the wiki results?

- **pass:** Every result drawn from has a bullet in the Sources section formatted as `- [page_title — section_heading](source_url)`, using the actual URLs from the tool response.
- **partial:** Sources are present but at least one is missing its URL, uses a fabricated URL, or the format deviates noticeably from the required pattern.
- **fail:** No sources section, or sources are listed without URLs, or URLs are fabricated.

**Grading note:** The skill appends the Sources section to a newly-created file via Edit in step 5. The file contents are not shown to you directly — you only see the text response and transcript. Score **pass** if the text response mentions appending sources (e.g. "Now appending the Sources section", "Appending sources") or the transcript shows an Edit call after the file was created. Do not score partial or fail solely because the formatted bullet list is not visible in the text response.

## Summary faithful to wiki content

Did the skill synthesise only from what the FamilySearch Wiki returned, without adding facts the wiki did not provide?

- **pass:** Every claim in the summary is traceable to a `chunk_text` in the tool response; no outside facts or fabricated guidance were added.
- **partial:** The summary is mostly faithful but contains at least one claim that goes beyond what the tool returned — plausible but unverified addition.
- **fail:** The summary contains fabricated guidance, specific dates, record names, or repositories not present in the tool response.

## No-result handling (negative path)

When the FamilySearch Wiki returns an empty results list, did the skill correctly tell the user and write no file?

- **pass:** Skill told the user no wiki guidance was found and did not create a file.
- **partial:** Skill told the user but also wrote an empty or placeholder file.
- **fail:** Skill wrote a file despite empty results, or silently did nothing without informing the user.
- **N/A:** Test did not exercise the empty-results path.
