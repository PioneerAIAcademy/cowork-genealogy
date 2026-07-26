# Juan Rodríguez Martínez — additional son Juan (b./d. 1801)

**Source PID:** `9634-PS9`
**Juan Rodríguez Martínez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
16 November 1777, Pozuelo, Albacete, Spain; died buried 18 January 1855, San Bartolomé, Pozuelo, Albacete, Spain.

## Research question

> Did Juan Rodríguez Martínez and his wife Marcelina Garcia of Pozuelo, Albacete, Spain have a son also named Juan, who died in infancy in 1801, in addition to their eight known children (b. 1799-1822)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9634-PS9` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 31, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — España, Diócesis de Albacete, registros parroquiales, 1504-1979: burial entry, 17 February 1801, San Bartolomé, Pozuelo, naming parents Juan Rodriguez and Marcelina Garcia. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming this 1801 infant Juan Rodriguez, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: both parents' names match the tree exactly (Juan Rodriguez and Marcelina Garcia — the tree's fuller "Juan Rodríguez Martínez" and "Marcelina Garcia"), and the parish (San Bartolomé, Pozuelo) matches every other child's record exactly. A son who died as an infant in 1801 is chronologically close to the tree's daughter Juana (b. 1799) and son Francisco (christened 4 December 1801) — a reviewer should check whether this burial could in fact be the same event as Francisco's christening (i.e., possibly the same child recorded twice under different names, rather than a genuine additional son) before accepting this as a distinct new child.
