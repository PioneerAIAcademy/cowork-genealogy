# Search Wikipedia Rubric

Grading dimensions for search-wikipedia unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

The saved markdown file is checked **deterministically**, not here. `test_saved_file_matches_template` compares the file byte-for-byte against the filled `templates/wiki-summary.md`, and the eight `test_slug_*` validators pin each expected filename. Do not infer either from the text response, and do not penalize a dimension because the response does not show the file's contents — the skill is instructed not to show them.

## Template fidelity

Did the skill call `wikipedia_search` and confirm saving the result — without asserting anything the tool response does not support?

Note: this skill writes a standalone markdown file that does not appear in the file changes summary, which tracks only `research.json` and `tree.gedcomx.json`. Judge from the text response and the tool call. `(no file changes)` is expected and correct here.

- **pass:** The skill called `wikipedia_search`, received a response, and confirmed saving a file. Nothing in the response states a fact absent from the tool response. A brief confirmation (e.g. "Saved the Wikipedia summary to `albert-einstein.md`") is the ideal response — do not penalize brevity, and do not ask for the file's contents.
- **partial:** The response adds framing or context the tool response does not support (an era, a place, a significance claim) without presenting it as the skill's own commentary.
- **fail:** The skill invented facts, attributed content to Wikipedia that the tool did not return, or claimed to have saved a file without ever calling `wikipedia_search`.

## Tool query and response interpretation

Did the query the skill sent target the article the user asked for, and did the skill accept what came back?

`wikipedia_search` is not a search — it fetches one article summary and returns exactly one `title`, `extract`, and `url`. There is nothing to choose between and no result list to rank, so the graded question is whether the query was well aimed and the single response was taken at face value.

- **pass:** One `wikipedia_search` call whose query targets the article the user named. The returned `title` is accepted as the article's identity even when it differs from the query the skill sent — following a redirect to a formal title (e.g. a query for the potato famine returning "Great Famine (Ireland)") is correct behavior, not a discrepancy.
- **partial:** The query drifts from what the user asked for but still reaches a related article; or the skill remarks on the query-versus-title difference as though it were a problem, or asks the user to confirm it, instead of proceeding.
- **fail:** The query targets a different subject than the user named; or the skill re-queries to "correct" a title it does not like; or it overrides the returned `title` with its own wording.

## Reply economy

SKILL.md step 5: tell the user the file was created, **one sentence only**, and "do not restate, summarize, or paraphrase the article content." The article goes in the file, not the chat. This dimension grades that one instruction.

- **pass:** One sentence naming the saved file. Nothing else.
- **partial:** Mid-workflow narration reaches the reply ("Now I'll write the filled template to a file…"), or the reply runs to several sentences, or it characterizes the article in passing ("a useful overview of the county's mining history") — anything beyond naming the file.
- **fail:** The reply restates, summarizes, or quotes the article content, duplicating in chat what the file already holds.
