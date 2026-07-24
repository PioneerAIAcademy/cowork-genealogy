# Pierre Albert Tullier — additional son Pierre Jacques Dominique (b. 1796)

**Source PID:** `GPX7-28P`
**Pierre Albert Tullier is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
4 March 1777, Stavele, Alveringem, West Flanders, Belgium; died 11 March 1846, Bambecque, Nord, France.

## Research question

> Did Pierre Albert Tullier and his wife Constance Dorothé Leys have a son, Pierre Jacques Dominique, born 1796, in addition to their five children recorded from 1805 onward?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GPX7-28P` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 6, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — France, Nord, Parish and Civil Registration, 1524-1893: marriage entry, 21 June 1825, Bambecque, for Pierre Jacques Dominique Tuilier (son of Pierre Tuilier and Constance Ley) and Constance Victoire Depuydt. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1796 Pierre Jacques Dominique Tuilier birth, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh **against** the match: the tree records Pierre Albert Tullier's marriage to Constance Dorothé Leys as 24 September 1800 — but a son born in 1796 would predate that marriage by four years, which either means the couple had a child before their recorded marriage date, the tree's marriage date is wrong, or this is a different Pierre Tuilier/Tullier and Constance Leys/Ley pairing in the same small Bambecque parish ("Pierre" and "Constance" are common regional names, and "Tuilier"/"Tullier" is a spelling variant pair already present elsewhere in the tree, e.g. the subject's own name). In favor: same given names for both parents, and the same parish (Bambecque, Nord).
