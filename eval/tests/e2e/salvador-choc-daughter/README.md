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

**Resolved as a TRUE MATCH (outcome a).** The baptism register page image confirms Antonia is a genuine daughter of Salvador Choc and Petrona Choc. `expected-findings.json` records the image-verified birth date (15 August 1877) and baptism date (29 October 1877); the FamilySearch index's "1581" birth year is an indexing error.

**Retrieval and image reading.** The index entry was retrieved via `dev/try-record-read.ts` (`ark:/61903/1:1:XS7R-WRSY`). The page image (`ark:/61903/3:1:3QHJ-M745-8H2G`, image 149 of 407 in the San Pedro Carchá June 1877–August 1878 register) was read by hand on familysearch.org. The identity judgement is the genealogist's.

**The indexing error.** The FamilySearch index keys the birth year as "1581". The baptism date (29 October 1877) and parents (Salvador [Choc] and Petrona [Choc]) are consistent across the index and the image, confirming the birth year of "1581" is an indexing error for 1877 (1581 is also the first year cited in the collection title).

**The identity question.** The concern was whether this could be a different Salvador Choc married to a different Petrona Choc — the name is common in San Pedro Carchá. The discriminating evidence: (1) the mother on the image is "Petrona [Choc]", matching the name under which Salvador's 1871 bride Petrona Ba (GG1G-697) is indexed throughout his tree; (2) an 1877 birth sits squarely within the couple's 1871–1888 documented reproductive span; (3) no Antonia appears among Salvador's existing tree children (Catarina, Candelaria, Victoriano, Juan, Salvador Choc Xol), so this is not a re-index of anything already attached. Petrona Xol (MGDD-Z43) is excluded as the mother: the 1875 baptism entry for Dominga names her mother under her own surname "Petrona Mª Xol", not "Petrona Choc". The godparents (Manuel Tiul, Mª Santos) do not match those on Dominga's 1875 baptism (Andrés and Vicenta), so they give no link to Petrona Xol. Accordingly, linking Antonia to GG1G-697 (the 1871 wife, Petrona Choc / Petrona Ba) is correct; linking her to MGDD-Z43 (Petrona Xol) would be wrong.

**Image reading licensed (calibration).** Because the date and parentage readings rested on the page image, two other indexed entries on the same image were read and compared to the FamilySearch index: (1) **Mª Santos Cual**, daughter of Domingo Cual and Albina Cual; and (2) **Catalina Quim**, daughter of Santiago Quim and Mª Santos Caes. Both matched the index on child name, father, mother, so the reading of the target entry is licensed for birth date and parentage (`image_basis: true`).
