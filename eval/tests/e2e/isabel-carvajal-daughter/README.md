# Isabel Carvajal Chinchilla — additional daughter Juana (m. 1929)

**Source PID:** `LR2Y-X3H`
**Isabel Carvajal Chinchilla is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Isabel Carvajal Chinchilla and her husband Emilio Martínez of Santander, Colombia have a daughter named Juana, married 1929, in addition to their six known children (b. 1881-1895)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LR2Y-X3H` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 10, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Colombia, Catholic Church Records, 1576-2019: marriage entry, 9 October 1929, Matanza, Santander, for Ismael Alvarez and Juana Martinez, naming the bride's parents as Emilio and Isabel Carvajal. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Juana Martinez as the subject's daughter, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the hint record gives the father's name only as "Emilio" (matching the tree's Emilio Martínez by given name only, no surname corroboration in the extracted record) and the mother as "Isabel Carvajal" (matching the subject's given name and first surname exactly, dropping her second surname "Chinchilla" — a routine Colombian naming simplification). The tree's six known children span 1881-1895; a daughter marrying in 1929 would need to have been born in the 1900s-1910s, a full research task in itself since no birth/christening record for Juana was captured in this hint.
