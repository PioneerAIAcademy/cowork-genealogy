# Scenario: chronicling-america-reported-nil

A one-question project in a folder. The question is whether an Ohio newspaper
printed an obituary or death notice for Abner Hollis (d. 1874, Warren County,
Ohio). Plan item `pli_001` is a Chronicling America search, `in_progress`.

The researcher already reported that search as finding nothing, without a
capture. `log_001` is that report: an `external_site` entry for
`chronicling_america` with `outcome: "negative"`, `capture_received: false`, and
notes marking the absence unconfirmed pending a capture. A `negative` entry opens
no hand-off, so `project_context` lists nothing under `awaitingUser`; the entry is
found with `research_query` on section `log`.

From feedback issue #4747 (folded into #4657): the researcher then said the "no
results" had actually been a timeout, and the agent replied that it could not edit
the log. The correction is a new entry for the same `url_generated`, logged
`error`, whose notes name `log_001`.

Used by `ut_search_external_sites_cor`.

No PII: Abner Hollis is invented.
