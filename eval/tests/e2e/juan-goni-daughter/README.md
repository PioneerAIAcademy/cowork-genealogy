# Juan José Goñi — daughter Martina Eulalia Goñi (m. 1872, Elizondo)

**Source PID:** `G18D-QZW`
**Juan José Goñi is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of Elizondo, Baztán, Navarra.

## Research question

> Did Juan José Goñi and his wife Francisca de Goñi of Elizondo, Navarra have a daughter, Martina Eulalia Goñi, who married Francisco Casimiro Yriarte in 1872?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G18D-QZW` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 6, `hint-samples.csv` row 230,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Spain, Marriages, 1565-1950", an 1872 marriage entry for Francisco Casimiro Yriarte of Elizondo (son of Pedro Angel and Tomasa Yribarren) and Martina Eulalia Goñi of Elizondo, naming the bride's parents as Juan Jose and Francisca Goñi.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Martina Eulalia Goñi as his daughter, plus a `required` finding that the report documents
the rejection.

Strong on the parent pair. The bride's parents in the record — "Juan Jose" and "Francisca Goñi" — match the tree couple exactly, and the tree's one known daughter, Engracia Ygnacia Goñi, was christened at Elizondo in 1840, the same parish as the hinted marriage. A second daughter marrying there in 1872 fits the family without straining anything.

Two cautions. The index gives the bride's father as a bare "Juan Jose" with no surname at all, and Goñi is a common Baztán surname — a same-parish namesake couple is the failure mode to rule out, not a remote possibility. And the tree already carries a source titled "Juan Jose in entry for Juan Bautista Apezteguia, Spain, Marriages": establish whether that is a *different* daughter's marriage already accounted for, or the same event indexed twice.

Note for the corpus: the batch CSV labels this row Cuba, but the person and the record are Navarrese throughout. Nothing about the research is Cuban.
