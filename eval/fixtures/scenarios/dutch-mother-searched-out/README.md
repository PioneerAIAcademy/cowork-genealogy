# dutch-mother-searched-out

Fork of `dutch-mother-name-disputed` for step mode's section E ending: a
conflict that no record left to search can settle.

## Differences from `dutch-mother-name-disputed`

- **c_001 was analysed once already**, on the birth act and the index. Its
  `resolution_rationale` named five records that would settle the mother's name, so
  it carries no `weighed_log_entry_ids`: that field marks only an analysis that found
  nothing left to search.
- **All five were searched since, and none settles it** (`pli_003`-`pli_007`,
  `log_003`-`log_007`, all `negative`):
  - the 1843 marriage act the index cites is lost in both register copies, and the
    1843 marriage supplements, which would hold the groom's birth extract, do not survive;
  - no death act for the mother under either surname, 1828-1900;
  - the population register begins in 1850, after she disappears from the household;
  - Cornelis is the only child registered, so there is no sibling's birth act;
  - the parents' marriage is in neither the civil registers (from 1811) nor the church
    registers before them.
- **`results_ref` is null on `log_001`/`log_002`.** The parent's point at sidecar
  files the fixture never shipped (a validator error on the parent); nulled here so
  no agent chases a missing file.

## The state it models

The plan is completed and nothing is open. c_001 has never been found searched
out, so the ladder routes the question to conflict-resolution (`nextStep: conflict-resolution
— unresolved c_001`). Weighing them leaves the conflict where it was: the birth act's
first letter is unreadable and the only legible reading is a derivative index. No
record is left that names the mother in full.

## Used by

`ut_conflict_resolution_uc1` — the pass keeps c_001 `unresolved`, says no record left
to search can settle it, and ends without a "Continue with …?" line. `research_append`
stamps `weighed_log_entry_ids` with all seven log entries when the pass declares nothing
left to search.

The next state is `dutch-mother-searched-out-weighed`.

The Dutch record-survival details (both register copies, the supplements, the
church registers) are written for the scenario, not checked against a real
municipality's archive.
