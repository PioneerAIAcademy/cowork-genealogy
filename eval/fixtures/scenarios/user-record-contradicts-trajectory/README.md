# user-record-contradicts-trajectory

Mined from alpha feedback bundle `feedback-2026-10-06T15-30-34-478984Z` (web, issue
#3266) for `ut_research_gm4`. The project asks whether a man's wife, "Polly" in the
1850–1880 Pulaski County, Kentucky censuses, is the Mary Ann Eastham the FamilySearch
tree merged her with. `h_002` is active. It treats the Robert Eastham living in the
Burton household in 1850 and 1860 as the Boyd County Robert Eastham, and on that basis
the research has been working Greenup and Boyd counties (the 1850 Greenup household is
`src_008`, `a_192`–`a_207`). The test's message is the researcher's next turn. It
describes, without a record ID, an 1861 Pulaski death record for Robert Eastham that
names his parents as James and Elizabeth Eastham, and says nothing about where they
lived. In the session the router ruled `h_002` out. It then wrote the parents up as
"of Greenup County", tied them to the Greenup household, said the main conclusion
stood, and moved to an exhaustiveness check without ever searching Pulaski for them.

**The carve.** This is the bundle's final state, reverse-patched to the moment before
that message (session-log entry 553, 2026-10-05T20:42:29Z):

- Every entity appended after that moment is dropped: `log_040`+, `src_009`–`src_011`
  with their assertions, `q_003`, `pl_002`, `pl_003`, tree persons `I17`–`I27`, and
  source descriptions `S25`–`S27`.
- Every entity updated after it is restored to its earlier value:
  - `h_001`/`h_002` to their original appends (`h_002` active);
  - `a_159`'s `informant_bias_notes`;
  - `pli_006`/`pli_010` back to `in_progress`.

The script that did it is reproducible from the bundle's session and subagent logs.
`results/` carries the 29 sidecars the kept log entries reference. The validator
requires them.

**PII.** Everyone named here is a 19th-century Kentuckian (births 1780s–1850s) in
public records and the public FamilySearch tree. The names, places and dates are what
the test turns on, so they are kept. The tester's own identity appears nowhere in these
files.

**Verify before relying on this carve:**

- Background agents were still extracting and linking when the message arrived. Their
  later writes are excluded, so this state is what was on disk at that moment, not
  what those agents would have produced.
- Treat the carve as best-effort and check it against the bundle.
