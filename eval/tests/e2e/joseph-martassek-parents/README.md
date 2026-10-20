# Joseph Martassek — parents named on an 1853 baptism, Krásno nad Kysucou, Slovakia

**Source PID:** `L8JK-KDK`
**Joseph Martassek is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree gives him no birth date and an undated Death fact. Husband of Maria Szuchony; father of Maria (1878), Petrus (1883), Anna (1887), Josephus (1890) and Carolina (1893), all baptised at Krásno nad Kysucou. His only sources are those five children's baptism entries.

## Research question

> Who were the parents of Joseph Martassek of Krásno nad Kysucou, Slovakia, husband of Maria Szuchony and father of children baptised there between 1878 and 1893?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L8JK-KDK` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 9, `hint-samples.csv` row 250,
flags `adds_father,adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Slovakia, Church and Synagogue Books, 1592-1935", the 1853 Krásno nad Kysucou baptism of Josephus Martassek, son of Joannes Martassek and Maria Tizsinyák. The index gives only the year. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Joannes Martassek and Maria Tizsinyák as his parents, plus a `required` finding that the report documents
the rejection.

CSV country "Czechoslovakia"; the record and the family are in Krásno nad Kysucou, present-day Slovakia, so the fixture is tagged `SK`.

A plausible candidate on name, parish and age. The baptism is in the same parish as all five of the subject's children, and a man born in 1853 would have been 25 at his first child's baptism in 1878 and 40 at his last in 1893. None of the subject's sources is his own baptism or marriage, so the hint is not a re-index of anything in the tree.

The weakness is that the tree gives the subject no birth date at all, so the hint links them on name and parish alone. Martassek is a common surname in Krásno, and a parish of that size could easily baptise two or three boys named Josephus Martassek within a decade. The discriminating check is the subject's marriage to Maria Szuchony, which should be in the same parish's registers shortly before 1878. Slovak Catholic marriage entries of the 1870s usually give the groom's age and often his parents. If it names Joannes Martassek and Maria Tizsinyák, or gives an age that fits 1853, the hint holds. A search of the Krásno baptisms for other Josephus Martassek entries between about 1845 and 1858 shows how many candidates there are.
