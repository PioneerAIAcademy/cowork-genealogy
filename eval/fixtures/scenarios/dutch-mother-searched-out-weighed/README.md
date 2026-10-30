# dutch-mother-searched-out-weighed

`dutch-mother-searched-out` after conflict-resolution has weighed every search:
the state step mode's section E calls "ending on an unsettled conflict".

## Differences from `dutch-mother-searched-out`

- **c_001 has weighed every log entry** (`weighed_log_entry_ids`: `log_001`-`log_008`),
  as `research_append` stamps it on the analysis that declared nothing left to search.
- **`resolution_rationale` says the conflict cannot be settled and no record left to
  search can settle it,** naming each search and why it failed.

## The state it models

An unresolved conflict, analysed over every log entry, with no plan item open. The
ladder's unsettled-conflict arm fires: `nextStep` is proof-conclusion, which concludes
at the tier the evidence reaches and leaves the question open. There is no proof
summary yet. Once a summary with `shortfall: "conflict"`, at any tier, exists and is no
older than the latest log entry, the arm returns no next step.

## Used by

`ut_proof_conclusion_uc2` — writes `not_proved` with `shortfall: "conflict"`, leaves
q_001 `in_progress` and its `search_stop` untouched, and ends without a
"Continue with …?" line.
