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

**Resolved 2026-10-31 (issue #3636): the hint is a true match.** The hint
persona Antonia Choc (`ark:/61903/1:1:XS7R-WRSY`) is a daughter of the tree's
Salvador Choc and his wife Petrona Ba (`fixture.json` `hint.identity: "same"`).
She was born 15 August 1877 and baptised 29 October 1877 at San Pedro Carchá,
Alta Verapaz, Guatemala. Antonia is not in the tree.

**What the index says.** "Guatemala, Catholic Church Records, 1581-2023"
indexes a baptism in the San Pedro Carchá register for June 1877–August 1878:
Antonia, daughter of Salvador Choc and Petrona Choc, godparents Manuel Tiul and
María Santos. The index's dates are damaged. It keys the birth as 15 August
**1581**, a computer OCR error for 1877. It also
gives two christening dates, 29 October 1877 on the person and 29 August 1877
on the record.

**What the register says.** The genealogist read the baptism image by hand on
familysearch.org (page image `ark:/61903/3:1:3QHJ-M745-8H2G`). The entry gives Antonia,
daughter of Salvador Choc and Petrona Choc, born 15 August 1877 and baptised 29
October 1877 at San Pedro Carchá, with godparents Manuel Tiul and María Santos.
The image settles both dates: the birth year is 1877, not 1581, and the
baptism is 29 October. Because the image settled the call, `image_basis` is
`true`.

**Calibration.** Before reading Antonia's entry, the genealogist checked two
other entries on the same page against the index:

- Mª Santos Cual, daughter of Domingo Cual and Albina Cual
- Catalina Quim, daughter of Santiago Quim and Mª Santos Caes

Both matched, so the reading is licensed for child, parents and date.

**Why it is the same couple.** The parish is the right one. The mother's name,
Petrona Choc, is how the subject's 9 August 1871 marriage entries and his son
Victoriano's 1888 birth registration index his wife Petrona Ba, so it is the
same woman under her married surname. An 1877 birth falls between the 1871
marriage and the 1888 son. None of the tree's 48 attached records is this baptism or names an Antonia,
so the hint is not a re-index of an attached source.

The name is common in San Pedro Carchá, so names alone do not settle it. What
settles it is the image: it confirms the dates and the parents' names as
indexed, and it places Antonia in the couple's childbearing years in their own
parish.

**Findings.** `f1` (required): the agent should add Antonia Choc, born 15
August 1877 and baptised 29 October 1877 at San Pedro Carchá, as a daughter of
Salvador Choc and Petrona Ba (recorded as Petrona Choc). There is no avoid
guard.

**Retrieval.** The hint record and the page image, including the calibration
entries, were read by hand on familysearch.org. The identity judgement is the
genealogist's.
