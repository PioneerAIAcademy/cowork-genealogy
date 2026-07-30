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

**Resolved: true match.** This fixture came from a hint batch (`filtered-list-samples.csv` row 31, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches. `expected-findings.json` is transcribed from the hint record — España, Diócesis de Albacete, registros parroquiales, 1504-1979: burial entry, 17 February 1801, San Bartolomé, Pozuelo, naming parents Juan Rodriguez and Marcelina Garcia — and a genealogist review confirmed it stands as written.

Both parents' names match the tree exactly (Juan Rodriguez and Marcelina Garcia — the tree's fuller "Juan Rodríguez Martínez" and "Marcelina Garcia"), and the parish (San Bartolomé, Pozuelo) matches every other child's record exactly. The open question was whether this 17 February 1801 burial could actually be the same event as son Francisco's 4 December 1801 christening — i.e., the same child recorded twice under different names rather than a genuine additional son. It cannot: the two dates are ten months apart, and a burial recorded in February cannot describe the same event as a christening the following December. If both record dates are accurate, they document two distinct children. Taken together with the exact name/parent/parish match, this reads as a genuine additional son, Juan, distinct from Francisco (christened later in 1801) and Juana (b. 1799), who died in infancy shortly after his February 1801 burial.
