# Scenario: recent-birth-no-death-record

Parentage research for **Alan Glen Applegarth** (b. 29 Apr 1936, Ogden, Weber
County, Utah; d. 2023, Cache County, Utah) with every plan item closed and
**no record from the time of his death**.

The parents, **John Obrien Applegarth** (I2) and **Olive Annie Harvey** (I3),
rest on the 1940 and 1950 U.S. censuses (Alan in the household) and the 1926
Weber County marriage. The church christening and the parents' probate were
searched with no result, the Utah births index was searched with no entry
(`pli_009`, `log_011`), and Alan's own 1936 birth certificate (`pli_004`) is
skipped with `skip_category: "inaccessible"` and a `skip_reason` naming Utah's seal, the
form `decisive-skip-inaccessible` uses. It has no log entry.

The objective and `q_001` say Alan died in 2023. Nothing in the project
searches, plans or mentions a death certificate, and no other death-era
source is held.

## What it tests

`ut_research_exhaustiveness_022`: the subject's death record is a decisive
record for a parentage question, and here it was never looked for, so the
agent declines and leaves the choice to the researcher. The sealed birth
certificate is still not the reason.

Lead ruling (Dallan Quass, 2026-11-17): research is not exhaustive while a
death certificate that could name different parents is unexamined, and the
agent asking the researcher whether to go back for it or wrap up is the
right outcome.

## Fork

Forked 2026-11-17 from `recent-birth-sealed`, which also holds Alan's 2023
obituary naming both parents and records his death certificate as closed by law, and is declared on
(`ut_research_exhaustiveness_017`).
Removed here: the obituary's plan item, log entry, source, assertion and
person-evidence link, and its source and references in the tree. Added: the
death year in the objective and the question. `pli_004` carries the seal in
`skip_category` and `skip_reason`, not in prose, and `log_004` is removed: reading a
seal out of prose is what `ut_research_exhaustiveness_018` tests, and three early runs of
022 doubted the prose seal and declined on the birth certificate.

The 1926 marriage (`src_003`) is the county record viewed as a digital image on FamilySearch. Until 2026-11-18 its assertions carried an `ancestry:` record id while the source said `original` on FamilySearch; an agent read the id as an index-only source and declined on `original_substitution` about 1 run in 14.
