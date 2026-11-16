# Scenario: flynn-read-page-disputes

`flynn-read-page-waiting` with one change: the waiting page reads Patrick's
surname as "Flinn", where the 1860 index (src_003, a_008) reads "Patrick Flynn".
`project_context` lists the page under `waitingPages`, with src_003's index.

The harness rewrites the staged file's `retrieved` to now when it builds the
workspace, because a staged page expires 24 hours after it is read.

The point: the page pass reports the one difference, the name, as a reading that
disputes a_008. The page also names Michael, a child the index does not hold; he
is not sent. Patrick's age, 15, agrees with the index and is not sent.

No PII: the Flynn household is invented.
