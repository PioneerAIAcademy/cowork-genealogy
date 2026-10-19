# Search Wikipedia Rubric

Grading dimensions for search-wikipedia unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

`search-wikipedia` is an **agent** (`packages/engine/plugin/agents/search-wikipedia.md`), not a skill, and every test in this suite is a direct-agent test: the main thread relays a delegation verbatim and replies with whatever the agent returns. So the "reply" you are grading below is the agent's return, and every citation in this file is to the agent body — it has no numbered step 5.

The deliverable is one research-log entry (`tool: "wikipedia_search"`) whose `notes` hold the filled template; it appears in the file changes summary as a new `log` entry. Its byte-level fidelity is checked **deterministically**, not here: `test_log_notes_match_template` compares the logged entry's notes byte-for-byte against the template inlined in the agent body, and `test_notes_title_is_returned_title` pins the H1 to the returned title. Do not re-derive either, and do not penalize a dimension because the reply does not show the notes — the agent is instructed not to show them.

One test runs with **no project** (`ut_search_wikipedia_002`, tagged `no-project`). There `research_log_append` answers `reason: "no_project"`, nothing is logged, and the agent's reply is the filled template itself. On that test `(no file changes)` is correct, and returning the template is the correct reply, not a restatement.

One test in this suite is a **decline** (`ut_search_wikipedia_008`, tagged `scope-decline`). It logs nothing and makes no tool call, and that is its correct outcome. On that test read "Template fidelity" and "Tool query and response interpretation" as N/A, and grade "Reply economy" on the decline shape described in its own section.

One test is a **not-found** lookup (`ut_search_wikipedia_011`, tagged `not-found`). The tool answers `No Wikipedia article found`. One negative log entry and no template are correct. On that test read "Template fidelity" as N/A, and under "Reply economy" the line "No Wikipedia article was found for that topic." is the correct one-line return.

## Template fidelity

Did the agent call `wikipedia_search` and log the result — without asserting anything the tool response does not support?

- **pass:** The agent called `wikipedia_search`, received a response, and logged one entry whose notes are the filled template (or, on the `no-project` test, returned the filled template). Nothing in the reply states a fact absent from the tool response. A brief confirmation ("Saved the Wikipedia summary to the research log.") is the ideal caller-facing line — do not penalize brevity, and do not ask for the entry's contents.
- **partial:** The response adds framing or context the tool response does not support (an era, a place, a significance claim) without presenting it as the agent's own commentary.
- **fail:** The agent invented facts, attributed content to Wikipedia that the tool did not return, or claimed to have saved the summary without ever calling `wikipedia_search` or `research_log_append`.

## Tool query and response interpretation

Did the query the agent sent target the article the delegation asked for, and did the agent accept what came back?

`wikipedia_search` is not a search — it fetches one article summary and returns exactly one `title`, `extract`, and `url`. There is nothing to choose between and no result list to rank, so the graded question is whether the query was well aimed and the single response was taken at face value.

- **pass:** One `wikipedia_search` call whose query targets the article the delegation named. The returned `title` is accepted as the article's identity even when it differs from the query the agent sent — following a redirect to a formal title (e.g. a query for the potato famine returning "Great Famine (Ireland)") is correct behavior, not a discrepancy.
- **partial:** The query drifts from what was asked for but still reaches a related article; or the agent remarks on the query-versus-title difference as though it were a problem, or asks the caller to confirm it, instead of proceeding.
- **fail:** The query targets a different subject than the delegation named; or the agent re-queries to "correct" a title it does not like; or it overrides the returned `title` with its own wording.

## Reply economy

The agent body's `## Return contract`: **exactly one line saying the summary was saved to the research log, and nothing else.** "Saved the Wikipedia summary to the research log." is the complete and correct return. The article goes in the log entry's notes, not into the reply. On the `no-project` test the reply is the filled template instead, and that is correct.

This agent carries no `summary_for_user` paragraphs, and that is deliberate rather than an omission — it is on the PENDING list in `tests/packaging/agent-return-contract.test.ts` with the measurement behind it. Do not reward a return that adds them, and do not penalize one for lacking them.

- **pass:** One line saying the summary was saved to the research log (or, with no project, the filled template). Nothing else. On the decline test, two short sentences declining — or naming the owning agent — and nothing else.
- **partial:** Mid-workflow narration reaches the reply ("Now I'll write the filled template to a file…"), or the reply runs to several sentences, or it characterizes the article in passing ("a useful overview of the county's mining history") — anything beyond the one confirmation line.
- **fail:** The reply restates, summarizes or quotes the article content, duplicating in chat what the log entry already holds; or it asserts what the subject means for genealogy, which is a fabrication risk even when the extract supports it.
