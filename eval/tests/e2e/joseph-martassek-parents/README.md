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

**Resolved 2026-10-23: FALSE MATCH** (issue #3625; identity `different`).
The hint record — "Slovakia, Church and Synagogue Books, 1592-1935", the
1853 Krásno nad Kysucou (Karásznó) Catholic baptism of Josephus Martassek,
son of Joannes Martassek and Maria Tizsinyák (`ark:/61903/1:1:V171-T6D`) —
is not the subject's baptism. The same parish's death register, entry
No. 119 (`ark:/61903/1:1:6N98-SCLC`), records that this Josephus Martassek
died aged five months on 9 October 1853 and was buried on 11 October 1853.
A child dead in 1853 cannot be the Joseph Martassek (L8JK-KDK) who married
Maria Szuchony and had children baptised at Krásno between 1878 and 1893.
The decision rests on the two index entries above. Retrieval was by hand on
familysearch.org.

The baptism scan (image 50 of 249) was also read, and entry 27 reads
Josephus Martassek, 19 May 1853, father Joannes Martassek, mother Maria
Tizsinyák. That reading is **unlicensed**: the calibration against two other
indexed entries on the same page could not be done, because FamilySearch's
click-to-highlight did not work, so no other entry was checked. Nothing in
the fixture relies on it, and `image_basis` is not set.

`expected-findings.json` therefore carries an `avoid` guard (f1) against
naming Joannes Martassek and Maria Tizsinyák as his parents, and a required
finding (f2) that the report documents the rejection and leaves his parents
unestablished. The subject's actual parents remain open. The Krásno nad
Kysucou marriage registers for 1873-1878 ("Slovakia, Church and Synagogue
Books, 1592-1935") were searched by hand for his marriage to Maria Szuchony,
which would normally give his age and parents; no entry was found. A
different Josephus Martassek baptised at Krásno around 1845-1858 is the
likely candidate class, but none has been identified as his.

CSV country "Czechoslovakia"; the record and the family are in Krásno nad Kysucou, present-day Slovakia, so the fixture is tagged `SK`.
