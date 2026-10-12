# census-household-spouse-died-later

Variant of `census-household-absent-spouse` for `ut_person_evidence_k8d`. The
research side is identical: George Ackerman's 1860 census household, head plus
Henry and Margaret, and no assertion for George's wife Catherine.

## The one difference

Catherine (**I2**) now carries a **Death** fact: **3 Mar 1884**, Reading, Berks
County, sourced to a death register (tree source **S3**). She died 24 years
*after* the 1860 census, so her death does not explain her absence from it. She
is still expected in the household George heads, and her absence is still an
unexplained identity question.

## What it guards

The household check reads `project_context`'s `diedByYear` for each of the
head's spouses and children and skips only those certainly dead before the
record's year. A check that skips anyone with any death fact goes silent here,
and since most people in a filled-out tree have a death fact, that is the
common case. `census-household-absent-spouse` cannot catch it, because there
Catherine has no death fact at all.

The skill must still build the household exactly as in the parent scenario and
flag Catherine's absence unprompted, never treating her later death as the
explanation.
