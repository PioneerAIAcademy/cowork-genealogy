# search-records-user-declined-probate

Elias Thornbury (d. 1891, Hamilton County, Ohio) — an active plan for q_001 whose
**current** item (the lowest-sequence `planned` one) is a probate search the user
declines in the test's message.

- **Objective:** identify Elias Thornbury's children.
- **Questions:** 1 — q_001 (`in_progress`; a plan exists).
- **Plans:** 1 — pl_001 (`active`), two `planned` items:
  - pli_001 (sequence 1) — probate, Hamilton County, 1891-1895. Its rationale names
    the synthetic collection `SYNTH-OH-PROBATE`.
  - pli_002 (sequence 2) — 1880 census, Hamilton County.
- **Log:** 0 entries.
- **GedcomX persons:** I1 (Elias Thornbury, b. 1821 Virginia, d. 1891 Hamilton County).

## What the skill must do

The user declines pli_001 and asks for the census search instead. pli_001 is set
`skipped` with `skip_category: "user_declined"` and a `skip_reason`, and nothing is
searched or logged against it. pli_002 is executed and logged as usual.

Hand-authored; no real person. The MCP fixtures (`record-search-thornbury-*`) were
written for `ut_search_records_d28` alone. The two probate fixtures are stocked only so
a declined search that runs anyway is recorded rather than aborting the run.
