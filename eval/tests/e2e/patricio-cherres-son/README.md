# Hermenejildo Patricio Cherres — a son, Julio César, who died in 1908 at San Pedro, Guanujo, Ecuador

**Source PID:** `KZ39-T1R`
**Hermenejildo Patricio Cherres is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Husband of Nicolasa Gavilanes (also indexed Gabilanes; christened 6 December 1865 at San Pedro, Guanujo). Three daughters in the tree: Manuela (born 25 June 1889, christened at San Pedro, Guanujo), Zoila Rosa (born 5 June 1901, christened at Guanujo) and Rosario (born at Guaranda, undated). No son is attached.

## Research question

> What children did Hermenejildo Patricio Cherres and his wife Nicolasa Gavilanes, of San Pedro, Guanujo, Bolívar, Ecuador, have besides their daughters Manuela (born 1889), Zoila Rosa (born 1901) and Rosario?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `KZ39-T1R` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 11, `hint-samples.csv` row 303,
flags `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Ecuador, Catholic Church Records, 1565-2023", a burial entry from the San Pedro de Guanujo death register (1894–1915) for Julio Cesar Cherres, born 1906, died 17 May 1908, son of Patricio Cherres and Nicolasa Gavianes. The index standardizes the event place to San Pedro, Córdoba, Bolívar, **Colombia**; the register itself is Guanujo's, in Bolívar province, Ecuador, which is how this fixture is tagged. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Julio César as their son, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both parents' names match, "Gavianes" is within the spread the family's own entries show (Gavilanes, Gabilanes), and the parish is the one where the wife was christened and the eldest daughter baptised. The tree's own citations already call the subject plain "Patricio Cherres" on Manuela's baptism. The mother would have been about 41 in 1906, after a daughter in 1901, so the dates fit. None of the tree's sources is a burial entry or names a Julio, so this is not a re-index of anything already attached.

The gap is the couple's generation. Cherres is a narrow surname in Guanujo, and a son named Patricio who also married a Gavilanes woman would produce an identical index line; the tree shows no son at all, so it cannot rule one out. The discriminating check is a baptism of Julio César around 1906 in Guanujo or Guaranda: one naming the same parents with the maternal grandparents of the 1865 christening settles it, and a mother of a different age or lineage makes this a younger couple.
