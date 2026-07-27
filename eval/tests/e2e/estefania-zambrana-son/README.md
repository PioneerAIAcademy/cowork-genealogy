# Estefania Zambrana — additional son Ricardo (b. 1874)

**Source PID:** `9QTV-KDZ`
**Estefania Zambrana is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Estefania Zambrana and her husband Antonio Beisaga of Cochabamba, Bolivia have a son named Ricardo, baptized 1874, in addition to their two known children (b. 1867 and 1877)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9QTV-KDZ` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 7, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Bolivia, Catholic Church Records, 1566-2020: baptismal entry, 3 April 1874, Santo Domingo, Cochabamba, naming parents Antonio Veizaga and Estefania Zambrana. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1874 Ricardo baptism, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the father's surname is recorded as "Veizaga" in the hint record vs. "Beisaga" in the tree — a common regional spelling variant (both plausible renderings of the same Bolivian surname) also seen on the tree's own children (Beisaga Zambrana). The mother's name "Estefania Zambrana" matches exactly. A baptism in 1874 slots neatly between the tree's two known children (1867, 1877), and the parish (Cochabamba) matches the tree's known family location.
