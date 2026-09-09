# Ignacio Alvarado — infant daughter Angela, buried 1880 at El Carmen, San José

**Source PID:** `K21K-P1C`
**Ignacio Alvarado is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of San José, Costa Rica.

## Research question

> Did Ignacio Alvarado and Teodosia Durán of San José, Costa Rica have an infant daughter, Angela, who died and was buried in June 1880?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K21K-P1C` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 5, `hint-samples.csv` row 212,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Costa Rica, registros parroquiales y diocesanos, 1595-2022", a burial entry of 20 June 1880 at El Carmen, San José for the infant Angela Charado Duran (b. 1880), naming parents Ygnacio Alvarado and Teodosia Duran.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the infant Angela as his daughter, plus a `required` finding that the report documents
the rejection.

The names match and the chronology does not, which is what makes this one worth adjudicating. The record's parents — Ygnacio Alvarado and Teodosia Duran — are exactly the tree's couple, in the right city. But the tree gives Teodosia Durán a birth year of **1876**, which would make her four years old at the 1880 burial of a child it says is hers. One of the two documents is wrong, and the tree is the likelier candidate: it carries **no sources at all**, so every date in it is unsourced.

A second complication sits in the tree itself: Ignacio is recorded with two wives, `Teodosia Duran` (K4JL-NPF, b. 1876) and `Teodora Durán` (K21K-P18, no dates), each with one child — 1896 and 1889 respectively. Those two women may well be one person duplicated, in which case the 1876 birth year belongs to nobody in particular and the 1880 burial can sit in front of the 1889 and 1896 children without strain. Settle the duplicate before ruling on the hint. The bare surname "Charado" on the infant is likely an index mangling of a second surname and is not itself evidence either way.
