# Pedro Pablo Chaves — wife Juana Flores (m. 1859, Buenos Aires)

**Source PID:** `2761-R34`
**Pedro Pablo Chaves is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 1 July 1836 at Nuestra Señora del Socorro, Buenos Aires; death date not recorded in the tree.

## Research question

> Did Pedro Pablo Chaves, christened 1 July 1836 in Buenos Aires, marry Juana Flores, and if so when and where?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `2761-R34` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 1, `hint-samples.csv` row 6,
flag `adds_spouse,adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Argentina, Buenos Aires, registros parroquiales, 1635-2017", a 30 August 1859 marriage entry for Pedro Chaves (b. 1836) and Juana Flores (b. 1835), naming his parents as Isidro Chaves and Andrea Guerra and hers as Sebastian Flores and Isabel Rivero.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1859 marriage to Juana Flores, plus a `required` finding that the report documents
the rejection.

One of the stronger candidates in the batch. The hint's parents for the groom — Isidro Chaves and Andrea Guerra — are exactly the couple the tree already records as Pedro Pablo's parents, and the record's stated birth year (1836) matches the tree's 1 July 1836 christening at Nuestra Señora del Socorro in the same city. The tree records no spouse at all, so nothing competes.

Two cautions. The tree carries a duplicated father — `Sargento Isidro Chaves` (275H-YL3) and `Isidoro Chaves` (2761-R3H), each paired with an `Andrea Guerra` — so a parent-name match has two ways to succeed and neither is independent. And the hint's collection (Buenos Aires, registros parroquiales, 1635-2017) indexes the same parish books as the tree's existing source (Capital Federal, registros parroquiales, 1640-1978); confirm the marriage entry is new information rather than a re-index of a record already attached.
