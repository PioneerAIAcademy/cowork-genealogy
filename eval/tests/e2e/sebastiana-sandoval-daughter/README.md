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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 23, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — México, Oaxaca, Registro Civil, 1861-2002: death registration, 28 October 1879, Tlaxiaco, for Juana Aguilar (b. 1876, d. 1879), naming parents Jose Maria Aguilar and Sebastiana Sandoval. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Juana Aguilar as the subject's daughter, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the father's name is recorded with a middle name, "Jose **Maria** Aguilar", in the hint vs. plain "Jose Aguilar" in the tree — a routine expansion, not a conflict. Juana's birth year (1876) is one year before the tree's earliest recorded child, Juan (b. 1877) — close enough to be a full sibling from the same set of pregnancies rather than a contradiction, though a reviewer should confirm the two aren't the same birth event misindexed under two names. The region (Oaxaca) matches the family's other records exactly.
