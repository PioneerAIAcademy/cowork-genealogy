# Nicolasa Cedillo — death in May 1943, Santa Lucía, Intibucá, Honduras

**Source PID:** `GJG6-F2L`
**Nicolasa Cedillo is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Wife of Santiago Cedillo (`GJG6-74S`); mother of seven children baptised between 1899 and 1914 — Yanuario (born at Concepción, christened at San Antonio, 1899), Feliciana (Camasca, 1902), Maria Dolores (Camasca, 1904), Jose Antonio (Candelaria, Lempira, 1906), Eulogia (Camasca, 1911), Maria Eulogia del Carmen (1913) and Elena (Camasca, 1914). Her latest sources are her daughters' marriage entries of 1919 and 1927.

## Research question

> When and where did Nicolasa Cedillo die? She was the wife of Santiago Cedillo, and their children were baptised between 1899 and 1914 in Camasca and neighbouring parishes of southern Intibucá and Lempira, Honduras.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GJG6-F2L` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 15, `hint-samples.csv` row 464,
flags `adds_birth,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Honduras, Registro Civil, 1841-1968", a civil death registration for Ma Nicolasa Cedillo who died 22 May 1943 at Santa Lucía, Intibucá, indexed with a birth year of 1868 and with Santiago Cedillo as her spouse. The index gives no parents, residence or children. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 22 May 1943 Santa Lucía death, plus a `required` finding that the report documents
the rejection.

A strong candidate on names. A Nicolasa Cedillo whose husband is also a Santiago Cedillo is a two-name coincidence, and none of the subject's sources is a death or burial record, so this is not a re-index of anything already in the tree. A birth around 1868 fits a mother whose children were born 1899–1914, though it puts her at about 46 for the last child.

The gap is place. Every dated event in the family sits in southern Intibucá (Camasca, Concepción, San Antonio) or across the line in Candelaria, Lempira; Santa Lucía is a separate municipality of Intibucá, well to the north. Cedillo is a common surname in the department, and the pair of names could recur. The discriminating check is the death register image linked from the hint record: if the entry calls her the wife or widow of Santiago Cedillo, or gives Camasca as her origin, or names one of the seven children as informant, it is the subject; an origin elsewhere, or an informant and household with no tie to Camasca, would point to another couple of the same names.
