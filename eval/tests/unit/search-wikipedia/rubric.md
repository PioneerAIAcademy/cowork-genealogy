# Search Wikipedia Rubric

Grading dimensions for search-wikipedia unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

## Template fidelity

Does the saved markdown file match the wiki-summary.md template structure with the tool-returned values — no fabricated content, no missing fields?

- **pass:** File contains the article title as H1, the full extract verbatim (not truncated or paraphrased), and the source URL — all sourced from the tool response. No extra content is invented.
- **partial:** File follows the template structure but the extract is lightly rephrased or trimmed, or a minor field (e.g., the source link) is formatted differently than the template specifies.
- **fail:** File omits a template field, fabricates content not in the tool response, or doesn't follow the template structure at all.

## Slug correctness

Is the saved filename a correctly slugified version of the article title returned by the tool?

- **pass:** Filename matches the expected slug: lowercased, every non-alphanumeric run replaced by a single hyphen, leading/trailing hyphens trimmed, with `.md` extension.
- **partial:** Filename is close but has a minor deviation (e.g., double hyphen, trailing hyphen, or slug derived from the query instead of the returned title).
- **fail:** Filename is unrelated to the article title, uses the raw title with spaces/special characters, or uses a generic name like `wikipedia.md`.
