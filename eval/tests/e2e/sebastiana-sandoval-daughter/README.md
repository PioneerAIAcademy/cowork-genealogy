# Sebastiana Sandoval — additional daughter Juana (b. 1876, d. 1879)

**Source PID:** `K2GV-D61`
**Sebastiana Sandoval is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Sebastiana Sandoval and her husband Jose Aguilar of Oaxaca, Mexico have a daughter named Juana, born 1876 and died 1879, in addition to their four known children (b. 1877-1885)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `K2GV-D61` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: true match.** This fixture came from a hint batch (`filtered-list-samples.csv` row 23, flag `adds_daughter`, confidence 3) in which roughly half the hint records are false matches. A genealogist reviewed the tree person (Sebastiana Sandoval / Jose Aguilar, K2GV-D61) and the hint record (México, Oaxaca, Registro Civil, 1861-2002: death registration, 28 October 1879, Tlaxiaco, for Juana Aguilar, b. 1876, d. 1879, naming parents Jose Maria Aguilar and Sebastiana Sandoval) and confirmed the hint is correct; `expected-findings.json` is unchanged from the draft transcription.

Two points the review turned on:

- **Father's name.** "Jose **Maria** Aguilar" on the hint record vs. plain "Jose Aguilar" in the tree is a routine middle-name expansion, not a conflict — same person.
- **Birth-year proximity to an existing child.** Juana's birth year (1876) sits one year before the tree's earliest recorded child, Juan Aguilar Sandoval (male, b. 1877) — close enough to raise the question of whether the hint was the same birth event misindexed under two names. It is not: Juan is recorded male and Juana is recorded female, with distinct birth years (1877 vs. 1876) and Juana's own death record (1879). They are two separate children of the same couple, not a duplicate.

The region (Oaxaca) matches the family's other records exactly.
