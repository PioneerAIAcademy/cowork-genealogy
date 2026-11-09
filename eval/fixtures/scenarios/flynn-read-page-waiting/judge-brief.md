# Judge brief: flynn-read-page-waiting

The Patrick Flynn parentage project, mid-research. The 1860 census record is
already extracted as src_003, and its page has since been read but not kept.
`project_context` lists that page under `waitingPages`.

The router's job this turn is one call,
`extraction_append({ projectPath, attachWaitingPages: true })`, with no agent
hand-off for it, and then its normal routing for the next step.

After the turn src_003 holds the page's text in `transcription`. That is the only
change the call makes: no new source, no assertion, no log entry. The page names
Michael Flynn, whom the project does not hold. Leaving him out of the assertions
and the tree is correct, and is not a missed fact.

Agents are stubbed in unit tests, so a step routed after the page is kept changes
nothing, and its absence from `research.json` is not a failure.
