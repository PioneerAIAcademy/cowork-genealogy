# Salvador Choc — a daughter, Antonia, baptised in 1877 at San Pedro Carchá, Guatemala

**Source PID:** `MGDD-CB5`
**Salvador Choc is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The hint batch lists this person under PID `9CB3-PVT`, which FamilySearch now resolves to `MGDD-CB5`. The tree carries an undated Death fact and no birth. Son of Salvador and Candelaria Cal. He has three wives in the tree. Petrona Ba (christened 1867) married him at San Pedro Carchá on 9 August 1871, and the marriage entries and Victoriano's 1888 birth registration index her as Petrona Choc. Petrona Xol (christened 1842) is the mother of Dominga, christened at San Pedro Carchá on 13 December 1875. Inocenta Choc is the mother of Pedro, whose death was registered in 1881. The tree's children are a tangle: Catarina, born 1838, sits as both his daughter and Petrona Ba's mother, and Candelaria, christened 1870, is linked to two mothers. No Antonia is attached.

## Research question

> What children did Salvador Choc of San Pedro Carchá, Alta Verapaz, Guatemala, and his wife Petrona Ba (also recorded as Petrona Choc), who married there on 9 August 1871, have in the 1870s?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `MGDD-CB5` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 13, `hint-samples.csv` row 424,
flags `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Guatemala, Catholic Church Records, 1581-2023", a baptism entry in the San Pedro Carchá register for June 1877–August 1878, for Antonia, daughter of Salvador Choc and Petrona Choc, godparents Manuel Tiul and María Santos. The index's dates are damaged. It keys the birth as "15 de agosto de **1581**", an obvious slip for 1877. It gives the christening as 29 October 1877 on the person and 29 August 1877 on the record. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Antonia as his daughter, plus a `required` finding that the report documents
the rejection.

A weak-to-middling candidate on names alone. The parish is right. The mother's name, Petrona Choc, is how the subject's 1871 marriage entries and his son Victoriano's 1888 registration index his wife Petrona Ba. An 1877 birth falls between the 1871 marriage and the 1888 son. None of the tree's sources is an 1877 baptism or names an Antonia, so this is not a re-index of anything already attached.

The gap is the name itself. Salvador Choc is about as common a Q'eqchi' name as San Pedro Carchá has. This tree already shows the strain: three wives, two of them Petronas, a Dominga born to Petrona Xol in 1875 while the Petrona Ba marriage stood, and a daughter born in 1838. The index alone cannot tell this Salvador from another of the same name married to another Petrona Choc. The discriminating check is the baptism image. Read the mother's full name, including whether the priest wrote "Ba" or "Choc". Read anything recorded about the parents. Then compare the godparents with those on the couple's other children's baptisms in the same register. Matching godparents or the "Ba" surname tie Antonia to this couple; a different maternal surname makes her another family's.
