# Georg Gajdosch — wife Catharina and daughter Anna (b. 1718, Lidečko)

**Source PID:** `K69J-F7Y`
**Georg Gajdosch is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1690, Lidečko, Vsetín, Moravia; death not recorded in the tree.

## Research question

> Did Georg Gajdosch of Lidečko, Moravia have a daughter Anna, baptised 22 April 1718 — and was her mother named Catharina rather than the Dorothea the tree records as his wife?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K69J-F7Y` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 7, `hint-samples.csv` row 243,
flag `adds_spouse,adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Czech Republic, Births and Baptisms, 1637-1889", a 22 April 1718 baptism at Lidečko, Vsetín for Anna Gajdosch, naming parents Georg Gajdosch and Catharina.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Catharina as his wife and Anna as their daughter, plus a `required` finding that the report documents
the rejection.

This one is a conflict, not a simple addition, which is what makes it worth running. The father's name, the village and the chronology all fit: the tree's Georg Gajdosch was born about 1690 at Lidečko, married about 1710 there, and has a son Joannes baptised at Lidečko on 26 October 1714, so a daughter in April 1718 slots straight in.

What does not fit is the mother. The tree names Georg's wife **Dorothea**; the hint names **Catharina**. Those are not variants of one another, and one of the two documents is wrong. Three readings to choose between: the tree's Dorothea is itself unsourced — its single source is a derivative index entry for the son Joannes — and simply incorrect; Georg remarried between 1714 and 1718; or this is a second Georg Gajdosch in the same village, which in an early-modern Moravian parish is entirely ordinary. Weigh the tree lightly: its "about 1690 / about 1710" dates are the estimated values typical of patron-submitted early-modern lines, and it carries a `TitleOfNobility` fact on every member of this family with nothing behind it.
