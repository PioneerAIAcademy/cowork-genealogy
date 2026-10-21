# Clara González Pimienta — a daughter Zulema de Jesús born November 1897, Pichilemu, Colchagua, Chile

**Source PID:** `GJVV-FHW`
**Clara González Pimienta is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 31 July 1867 and christened 2 August 1867 at Pumanque, Colchagua; daughter of Cayetano González Padilla and Antonia Pimienta Valenzuela. She married Benjamín Silva Díaz in 1894, and the tree carries two sons, both civil birth registrations in Colchagua: Saúl Antonio Silva González (born 18 September 1894) and Manuel Jesús Silva González (born 27 December 1895). Her parents' family is centred on Pumanque and Nancagua.

## Research question

> Clara González Pimienta, born 31 July 1867 at Pumanque, Colchagua, married Benjamín Silva Díaz about 1894, and two sons are known: Saúl Antonio (born 18 September 1894) and Manuel Jesús (born 27 December 1895), both registered in Colchagua. What other children did Clara and Benjamín have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GJVV-FHW` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 5, `hint-samples.csv` row 170,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Chile, Civil Registration, 1880-1933", the birth registration of Zulema de Jesus Silva Gonzalez, born 12 November 1897 at Pichilemu, naming her parents as Benjamín Silva Díaz and Clara Gonzalez Pimienta.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Zulema as Clara's daughter, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both parents' names match in full, maternal surname included: Benjamín Silva Díaz and Clara González Pimienta. The register is a Colchagua birth volume, and the birth falls 23 months after Manuel Jesús, which fits the couple's spacing. The tree holds no daughter and no source dated after 1895 for this family, so the hint is not a re-index of anything already attached.

Two cautions. The index standardises Pichilemu under "Petorca, Aconcagua", but the image group is "Chile, Colchagua, Births", and Pichilemu is the Colchagua coastal town. The event place is Pichilemu, Colchagua (now O'Higgins), and a reviewer should not carry the index's Aconcagua into the findings. Second, the tree's Colchagua places for this family are inland: Pumanque, Nancagua and the generic "Colchagua" registration of both sons. A move to the coast between 1895 and 1897 is plausible but unproven.

The discriminating check is the register office on the two sons' birth registrations already in the tree. If either was registered at Pichilemu, or at a neighbouring coastal circunscripción, the hint is a true match. If both sons were registered inland, read the 1897 entry's declarant and the parents' stated residence on the image, which should name the same household.
