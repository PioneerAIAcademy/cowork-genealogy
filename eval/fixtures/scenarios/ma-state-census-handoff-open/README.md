# Scenario: ma-state-census-handoff-open

`ma-state-census-external` one step later: the MyHeritage search for the 1855
Massachusetts State Census has been handed to the researcher. Its in-flight
`external_site` entry (`outcome: "partial"`, `capture_received: false`) is open,
so `project_context` lists it in `awaitingUser`, and the plan item is
`in_progress`.

The point: when the capture comes back, the agent must match it to that row and
log the closing entry with the **same** `url_generated`, which is what clears
`awaitingUser`. A closing entry on any other URL leaves the hand-off listed and
the researcher is asked for it again.

No PII: the subject is the same invented Josiah Barnes.
