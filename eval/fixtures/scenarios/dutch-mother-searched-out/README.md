# dutch-mother-searched-out

Fork of `dutch-mother-name-disputed` for step mode's section E ending: a
conflict that no record left to search can settle.

## Differences from `dutch-mother-name-disputed`

- **c_001 was analysed once already**, on the birth act and the index
  (`weighed_log_entry_ids: [log_001, log_002]`). Its `resolution_rationale`
  named five records that would settle the mother's name.
- **All five were searched since, and none settles it** (`pli_003`-`pli_007`,
  `log_003`-`log_007`, all `negative`):
  - the 1843 marriage act the index cites is missing from its register volume;
  - no death act for the mother under either surname, 1828-1900;
  - the population register begins in 1850, after she disappears from the household;
  - Cornelis is the only child registered, so there is no sibling's birth act;
  - the parents' marriage is not in the province's civil registration.
- **`results_ref` is null on `log_001`/`log_002`.** The parent's point at sidecar
  files the fixture never shipped (a validator error on the parent); nulled here so
  no agent chases a missing file.

## The state it models

The plan is completed and nothing is open. Five log entries are new to c_001, so
the ladder routes the question to conflict-resolution (`nextStep: conflict-resolution
— unresolved c_001`). Weighing them leaves the conflict where it was: the birth act's
first letter is unreadable and the only legible reading is a derivative index. No
record is left that names the mother in full.

## Used by

`ut_conflict_resolution_uc1` — the pass keeps c_001 `unresolved`, says no record left
to search can settle it, and ends without a "Continue with …?" line. `research_append`
stamps `weighed_log_entry_ids` with all seven log entries.

The next state is `dutch-mother-searched-out-weighed`.
