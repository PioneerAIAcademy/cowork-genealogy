# Search Wikipedia Rubric

Grading dimensions for search-wikipedia unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

`search-wikipedia` is an **agent** (`packages/engine/plugin/agents/search-wikipedia.md`), not a skill, and every test in this suite is a direct-agent test: the main thread relays a delegation verbatim and replies with whatever the agent returns. So the "reply" you are grading below is the agent's return, and every citation in this file is to the agent body — it has no numbered step 5.

The saved markdown file is checked **deterministically**, not here. `test_saved_file_matches_template` compares the file byte-for-byte against the template inlined in the agent body, and the eight `test_slug_*` validators pin each expected filename. Do not infer either from the text response, and do not penalize a dimension because the response does not show the file's contents — the agent is instructed not to show them.

One test in this suite is a **decline** (`ut_search_wikipedia_008`, tagged `scope-decline`). It saves no file and makes no tool call, and that is its correct outcome. On that test read "Template fidelity" and "Tool query and response interpretation" as N/A, and grade "Reply economy" on the decline shape described in its own section.

## Template fidelity

Did the agent call `wikipedia_search` and confirm saving the result — without asserting anything the tool response does not support?

Note: this agent writes a standalone markdown file that does not appear in the file changes summary, which tracks only `research.json` and `tree.gedcomx.json`. Judge from the text response and the tool call. `(no file changes)` is expected and correct here.

- **pass:** The agent called `wikipedia_search`, received a response, and confirmed saving a file. Nothing in the response states a fact absent from the tool response. A brief confirmation (e.g. "Saved the Wikipedia summary to `albert-einstein.md`") is the ideal caller-facing line — do not penalize brevity, and do not ask for the file's contents.
- **partial:** The response adds framing or context the tool response does not support (an era, a place, a significance claim) without presenting it as the agent's own commentary.
- **fail:** The agent invented facts, attributed content to Wikipedia that the tool did not return, or claimed to have saved a file without ever calling `wikipedia_search`.

## Tool query and response interpretation

Did the query the agent sent target the article the delegation asked for, and did the agent accept what came back?

`wikipedia_search` is not a search — it fetches one article summary and returns exactly one `title`, `extract`, and `url`. There is nothing to choose between and no result list to rank, so the graded question is whether the query was well aimed and the single response was taken at face value.

- **pass:** One `wikipedia_search` call whose query targets the article the delegation named. The returned `title` is accepted as the article's identity even when it differs from the query the agent sent — following a redirect to a formal title (e.g. a query for the potato famine returning "Great Famine (Ireland)") is correct behavior, not a discrepancy.
- **partial:** The query drifts from what was asked for but still reaches a related article; or the agent remarks on the query-versus-title difference as though it were a problem, or asks the caller to confirm it, instead of proceeding.
- **fail:** The query targets a different subject than the delegation named; or the agent re-queries to "correct" a title it does not like; or it overrides the returned `title` with its own wording.

## Reply economy

The agent body's `## Return contract` defines a three-part return, and this dimension grades that shape. Nothing else in the suite does: the validators check the saved file and the absence of step narration, and neither can see whether the return is the right *shape*.

The required shape:

1. **One caller-facing line** naming the saved file — and on a decline, one sentence saying the request is out of scope or naming the agent that owns it (`historical-context`, `locality-guide`, `search-familysearch-wiki`). Nothing else above the `---`.
2. A line containing only `---`.
3. **Exactly two unlabeled paragraphs.** The first is for a reader who has never done genealogy: what was looked up and what the entry covers, in plain words. The second is one sentence on what happens next. **Neither may name a file**, an identifier, a tool or a field.

Grade the whole return, not the closing sentence. Note that the file name belongs *above* the `---` and must not appear below it — that inversion is the specific defect this dimension exists to catch, because a validator cannot tell a filename in paragraph one from a filename in the caller-facing line.

- **pass:** All three parts present and in order. The caller-facing line names the saved file (or declines, on the decline test). The two paragraphs name no file and restate nothing from the article.
- **partial:** The shape is right but something leaks — a file name, a tool name or a field name appears below the `---`; there are three paragraphs instead of two, or one; the caller-facing half runs to several sentences; the paragraphs characterize the article in passing ("a useful overview of the county's mining history"); or a label or heading is attached to either paragraph.
- **fail:** The `---` and the two paragraphs are absent altogether, so the caller has nothing to relay to the researcher; or the return restates, summarizes or quotes the article content, duplicating in chat what the file already holds.
