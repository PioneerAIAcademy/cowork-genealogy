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
  - the 1850 marriage act the index cites is lost in both register copies, and the
    1850 marriage supplements, which would hold the groom's birth extract, do not survive;
  - no death act for the mother under either surname, 1828-1900; the father's 1851
    death act names his late wife, but her first letter is blotted as in the birth act;
  - the population register begins in 1850, after she disappears from the household: it
    lists the father as a widower and Cornelis, married that year, at his own address;
  - Cornelis is the only child registered, so there is no sibling's birth act;
  - the parents' marriage is in neither the civil registers (from 1811) nor the church
    registers before them.
- **Cornelis's own death act was searched too** (`pli_008`, `log_008`, `negative`): he
  went to sea in 1853 and no Dutch register records his death.
- **So was the court's duplicate of the 1828 birth register** (`pli_009`, `log_009`,
  `negative`): a separate copy that might read the blotted letter, but its 1828 volume
  does not survive.
- **The marriage is in 1850, the index 1843-1852.** Cornelis, born 1828, is 22, over
  the 1838 Civil Code's minimum age of 18 for a groom.
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
stamps `weighed_log_entry_ids` with all nine log entries when the pass declares nothing
left to search.

The next state is `dutch-mother-searched-out-weighed`.

The Dutch record-survival details (both register copies, the supplements, the
church registers, the lost birth duplicate, a departure to sea) are written for the
scenario, not checked against a real municipality's archive.
