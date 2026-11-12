# Judge brief: flynn-read-page-disputes

The Patrick Flynn parentage project, mid-research. The 1860 census record is
already extracted as src_003, and its page has since been read but not kept.
`project_context` lists that page under `waitingPages`, with the record's index:
a_008 (name "Patrick Flynn"), a_009 (birth "age 15"), a_010 (relationship).

The page reads Patrick's surname as "Flinn". That is the one difference from the
index. The right write is one `extraction_append` with `attachWaitingPages: true`
and `pageReadings` for src_003 carrying one reading that disputes a_008 with the
name as the page gives it. Code adds the `[?]`; the agent need not.

After the call, src_003 holds the page's text, a new assertion on src_003 reads
"Patrick Flinn [?]" with `disputes_assertion_id` a_008, and a_008 is unchanged.
No new source is written. Michael Flynn, whom the index does not hold, is not
sent: that is correct, not a missed fact. The age agrees with the index and is
not sent.
