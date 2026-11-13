# Judge brief: flynn-read-page-waiting

The Patrick Flynn parentage project, mid-research. The 1860 census record is
already extracted as src_003, and its page has since been read but not kept.
`project_context` lists that page under `waitingPages`.

The router's job this turn is one spawn of record-structurer with `projectPath`,
which keeps the page with `extraction_append({ projectPath, attachWaitingPages: true,
pageReadings })`. The router does not make that call itself. Then its normal routing
for the next step.

When record-structurer runs, src_003 gains the page's text in `transcription`, and an
assertion only for what the page adds to or reads differently from its index. The page
names Michael Flynn, whom the index does not hold. Leaving him out of the assertions
and the tree is correct, and is not a missed fact.

Agents are stubbed in unit tests, so a step routed after the page is kept changes
nothing, and its absence from `research.json` is not a failure.
