# Gertrudis Hoffmans — additional daughter Elisabeth (b. 1713)

**Source PID:** `KN19-Q19`
**Gertrudis Hoffmans is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
about 1677, Wanrooij, Noord-Brabant, Netherlands; died not recorded in the tree.

## Research question

> Did Gertrudis Hoffmans and her husband Petrus Jansen of Wanroij, North Brabant, Netherlands have a daughter named Elisabeth, baptized 1713, in addition to their three known sons (christened 1709-1717)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `KN19-Q19` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 24, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Netherlands, Archival Indexes, Vital Records, 1600-2000: baptismal entry, 30 March 1713, Wanroij, naming parents Petrus Jansen and Geertrudis Gerits. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Elisabeth Jansen as the subject's daughter, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the mother's recorded surname in the hint, "**Gerits**" (a patronymic, "daughter of Gerit"), differs from the tree's "**Hoffmans**" (a family surname) — in Dutch records of this era patronymics and family surnames were used somewhat interchangeably for the same person (Gertrudis's own father is recorded in the tree as "Gerrit Gerrits Hoffmans", so "Gerits" is plausibly a patronymic drawn from her father's given name Gerrit), so this is a routine-looking variant rather than a clear mismatch. The father's name "Petrus Jansen" matches exactly, the parish (Wanroij) matches every other tree record for this family, and a 1713 baptism fits neatly between the tree's two sons (christened 1709 and 1717).
