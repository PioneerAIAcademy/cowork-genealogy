# Micaela Salgado — additional son Guillermo (b. 1889)

**Source PID:** `9XGG-PW4`
**Micaela Salgado is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1854, Tegucigalpa, Honduras; died not recorded in the tree.

## Research question

> Did Micaela Salgado of Tegucigalpa, Honduras have a son named Guillermo, baptized 1889, in addition to her two known daughters (b. 1874 and 1884)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9XGG-PW4` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 18, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Honduras, Catholic Church Records, 1633-1978: baptismal entry, 20 October 1889, San Miguel, Tegucigalpa, for Guillermo Salgado, naming mother Micaila Salgado with no father recorded. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Guillermo Salgado as the subject's son, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree does not record a spouse for Micaela Salgado at all, and the hint baptismal record likewise names no father — an internally consistent pattern (a single mother's baptismal entry) rather than a contradiction. The parish (Tegucigalpa, Francisco Morazán) matches the tree's other children exactly, and a 1889 baptism fits neatly after the tree's two known daughters (1874, 1884) as a later child. The surname "Salgado" alone, without a father to cross-check, leaves some risk of a different same-named Micaela Salgado in the same parish.
