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
Salvador Choc and a wife recorded as Petrona Choc (`fixture.json`
`hint.identity: "same"`). The register does not say whether she is the tree's
Petrona Ba or Petrona Xol.
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

**Why it is Salvador's daughter.** The parish is the right one. Petrona Choc
is a married-surname form, and it fits either of the tree's wives of Salvador
in the 1870s. The 9 August 1871 marriage entries and Victoriano's 1888 birth
registration index his wife Petrona Ba as Petrona Choc. Petrona Xol
(`MGDD-Z43`, christened 1842) bore him Candelaria (christened 1870) and Dominga
(christened 13 December 1875), and could be recorded the same way. The tree's
Petrona Ba (`GG1G-697`) carries a 14 July 1867 christening, which would make
her 10 in 1877, so that profile is likely conflated with a younger Petrona Baa.
None of the tree's 48 attached records is this baptism or names an Antonia, so
the hint is not a re-index of an attached source.

The name is common in San Pedro Carchá, so names alone do not settle it. The
image confirms the dates and the parents' names as indexed. It does not name
the mother's birth surname, so the fixture does not decide which wife is
Antonia's mother. The godparents (Manuel Tiul, Mª Santos) were not compared
with those on Dominga's 1875 baptism or the couple's other baptisms; that
comparison is what could settle it.

**Findings.** `f1` (required): the agent should add Antonia Choc, born 15
August 1877 and baptised 29 October 1877 at San Pedro Carchá, as a daughter of
Salvador Choc, with her mother recorded as Petrona Choc. Linking the mother to
either Petrona Ba or Petrona Xol is not required, and neither is wrong on this
evidence. There is no avoid guard.

**Retrieval.** The hint record and the page image, including the calibration
entries, were read by hand on familysearch.org. The identity judgement is the
genealogist's.
