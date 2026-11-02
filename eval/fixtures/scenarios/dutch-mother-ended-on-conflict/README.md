# dutch-mother-ended-on-conflict

`dutch-mother-searched-out-weighed` (from #3937) after proof-conclusion has
concluded on the unsettled conflict: the research has ended on it.

## Differences from `dutch-mother-searched-out-weighed`

- **ps_001** at `not_proved`, `shortfall: "conflict"`, on q_001. q_001 stays
  `in_progress`, as proof-conclusion leaves a question it concludes on an open
  conflict.

## The state it models

c_001 is analysed and has weighed every log entry, no plan item is open, and the
ending summary exists. `project_context` reports `nextStep: null` with
`openConflictIds: ["c_001"]`: there is no step left to run.

## Used by

`ut_research_uc1` — "Continue." runs no step, says the research ended on the
conflict, and offers no "Continue with …?" line.
