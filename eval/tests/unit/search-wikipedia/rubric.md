# Search Wikipedia Rubric

Grading dimensions for search-wikipedia unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

## Template fidelity

Did the skill call `wikipedia_search` and confirm saving the result — without fabricating content or inventing facts not in the tool response? Note: this skill writes a standalone markdown file that does not appear in the file changes summary. Judge file creation from the text response and tool call, not from the file changes section. The skill is instructed to give a brief confirmation only — it should NOT display article content in its text response. The article content goes into the saved file, not the chat.

- **pass:** The skill called `wikipedia_search`, received a response, and confirmed saving a file with the correct slug. No fabricated facts appear in the response. A brief confirmation (e.g. "Saved the Wikipedia summary to albert-einstein.md") without restating article content is the ideal response — do not penalize brevity.
- **partial:** The skill followed the workflow but its text response paraphrases or restates article content that should only appear in the saved file.
- **fail:** The skill fabricated content not in the tool response, invented facts, or never called `wikipedia_search`.

## Slug correctness

Is the saved filename a correctly slugified version of the article title returned by the tool?

- **pass:** Filename matches the expected slug: lowercased, every non-alphanumeric run replaced by a single hyphen, leading/trailing hyphens trimmed, with `.md` extension.
- **partial:** Filename is close but has a minor deviation (e.g., double hyphen, trailing hyphen, or slug derived from the query instead of the returned title).
- **fail:** Filename is unrelated to the article title, uses the raw title with spaces/special characters, or uses a generic name like `wikipedia.md`.
