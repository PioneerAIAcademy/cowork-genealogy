# Scenario: flynn-read-page-waiting

`mid-research-flynn` with one read page waiting to be kept. src_003, the 1860
census, carries `image_ark`, and `results/.staging/` holds a read of that page.
`project_context` lists it under `waitingPages`.

The harness rewrites the staged file's `retrieved` to now when it builds the
workspace, because a staged page expires 24 hours after it is read.

The point: the router keeps the page with one `extraction_append` call, then
routes as usual. The page names Michael, a child the project does not hold. He
stays in the page's text: keeping a page writes no assertion.

No PII: the Flynn household is invented.
