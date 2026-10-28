# flynn-parentage-open

Fork of `flynn-parentage-not-proved` with the question still open: two candidate
fathers, nothing on file that separates them, and records left that could.

## Differences from `flynn-parentage-not-proved`

- **q_001 is `in_progress`, not `exhaustive_declared`,** and its `search_stop` is
  cleared. The parent records `stopped_because: "record_exhausted"`, which made
  `not_proved` the right next step there and left nothing to plan.

Everything else is identical: h_001 (Thomas Flynn, dwelling 84) and h_002 (Michael
Flynn, dwelling 210) both `active`; the four completed searches (1850 and 1860
censuses, the 1908 death certificate with the father blank, the baptism that does
not survive); no conflicts and no proof summary.

## What is left to search

Each candidate father's probate or estate file, Patrick's marriage record, and his
obituary. None is in the log, and any of them could name the father.

## Used by

`ut_hypothesis_tracking_rt2`: hypothesis-tracking leaves both hypotheses `active`
and routes the deciding search to research-plan, ending "Continue with planning the
searches?".
