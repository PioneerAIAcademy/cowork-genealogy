# wiki-lookup

The wiki-lookup skill calls the `wikipedia_search` MCP tool, fills in a markdown template, and saves the result to the user's working folder. The rubric grades query formulation, the saved file's content quality, file handling, and tool-usage discipline.

## Query formulation

Did the skill construct an appropriate Wikipedia query from the user's request? The query should capture the core topic without unnecessary qualifiers or paraphrasing.

- **pass:** Query is concise, faithful to the user's request, and matches a real Wikipedia article title (or close paraphrase).
- **partial:** Query is recognisable but adds noise (e.g., "history of X" when the user just asked for "X") or drops information that was part of the user's phrasing.
- **fail:** Query is unrelated, mangled, or so generic it could not retrieve the intended article.

## Output formatting

Did the skill produce a well-structured markdown summary with the article title, the key extract, and the source URL? The summary should be useful for genealogical context.

- **pass:** Markdown contains the article title as a heading, the full extract from the tool response, and the source URL — with no fabricated content beyond what the tool returned.
- **partial:** One of those three pieces is missing or partially malformed (e.g., the URL is present but not rendered as a link).
- **fail:** Multiple pieces missing, or the file content includes fabricated material not in the tool response.

## File handling

Did the skill save the summary to a file in the user's working folder with an appropriate filename? The file should be created, not just displayed in chat.

- **pass:** A new markdown file was created in the working folder, with a filename derived from the article title (lowercase, hyphen-separated, `.md` extension).
- **partial:** A file was created but the filename is generic, has the wrong extension, or is placed in the wrong directory.
- **fail:** No file was created, or the content was only printed inline.

## Tool usage

Did the skill use the `wikipedia_search` MCP tool correctly — calling it once with a sensible query and interpreting the response as ground truth rather than embellishing?

- **pass:** Exactly one call to `wikipedia_search` with the query reflecting the user's request; the response fields (title/extract/url) are used verbatim where appropriate.
- **partial:** Multiple unnecessary calls to the same tool, or the response is paraphrased in a way that loses fidelity but doesn't add fabrication.
- **fail:** No call to `wikipedia_search`, or the skill invents content not present in the response.
