# flynn-widow-pension

A check-warnings scenario for the **survivor's-claim** form of the
posthumous-mention case. Copied from `flynn-posthumous-residence`, with its
post-death fact replaced.

Patrick Flynn (I1) has a `Death` fact `F2` dated 12 March 1908, sourced to a
Pennsylvania death certificate. He also has a `Military` fact `F3` dated
4 November 1909 — about 20 months after his death — sourced to `S6`, a widow's
pension application filed by his widow Bridget Flynn, which names Patrick as
her late husband and documents his service. The file was auto-attached to
Patrick as a Military fact dated to its *filing*, which is what trips
`hasEventAfterDeath1`.

Both dates are correct. A widow's pension application necessarily postdates
the veteran's death — the death is what creates the entitlement — so a filing
the year after is the expected sequence, not evidence against either date. The
correct reading is a posthumous mention of the survivor's-claim kind.

The corrective action here differs from the rest of that category: the pension
file is genuine evidence **for** Patrick, documenting his service, his death
and his marriage. It should be **kept** attached, with the fact it was recorded
as corrected (dated to the service period, or moved to Bridget's own event) —
**not** unlinked, and **not** treated as an identity split or a wrong death
date.

`S5` (the obituary of Patrick's daughter Mary (Flynn) Brennan) is carried over
from the parent scenario and is no longer cited by any fact.

Used by `ut_check_warnings_v4m` (`detect-widow-pension-claim.json`) with the
`person-warnings-widow-pension` MCP fixture.
