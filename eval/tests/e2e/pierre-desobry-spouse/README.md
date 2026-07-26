# Pierre Henri DESOBRY — wife Clemence Sauselle and son Julien

**Source PID:** `L6L3-BB8`
**Pierre Henri DESOBRY is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
Pecquencourt, Nord, France (baptized 1753 and 1774 — two baptismal facts already conflict in the tree); died 11 October 1849, Aniche, Nord, France.

## Research question

> Who was the wife of Pierre Henri Désobry of Pecquencourt, France, and did they have a son named Julien who died in infancy in 1809?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `L6L3-BB8` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 17, flags `adds_spouse`/`adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — France, Nord, Parish and Civil Registration, 1524-1893: death registration, 8 September 1809, Pecquencourt, for Julien Désobri (infant), naming parents Pierre Henri Désobri and Clemence Sauselle. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Clemence Sauselle as the subject's wife, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: a son born 1808 and dying 1809 fits neatly between the tree's Philibert (b. 1800) and Jean Baptiste Aimé (b. 1813), and the parish (Pecquencourt) matches every other record for this family exactly. The tree oddly carries **two conflicting baptismal facts** for Pierre Henri Désobry himself (1753 and 1774, a 21-year gap, possibly two different men already conflated in the starting tree — a pre-existing tree data-quality issue, not something this fixture introduces or resolves), which should make a reviewer cautious about how reliable the existing tree profile is before trusting a new spouse/child hint against it. This is the family's first recorded spouse in the tree.
