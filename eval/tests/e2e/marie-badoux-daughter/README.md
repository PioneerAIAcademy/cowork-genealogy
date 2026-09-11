# Marie Badoux — daughter Claudine Thénot (b. 1781, Romenay)

**Source PID:** `LT9H-SK3`
**Marie Badoux is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; married Philippe Thénot at Romenay, Saône-et-Loire in 1773.

## Research question

> Was Claudine Thénot, baptised 12 October 1781 at Romenay to Philippe Thénot and Marie Joly, a daughter of Marie Badoux — or of a second wife?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LT9H-SK3` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 11, `hint-samples.csv` row 377,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "France, Saône-et-Loire, registres paroissiaux et d'état civil, 1530-1892", a baptism of 12 October 1781 at Romenay for Claudine Tenot, naming parents Philipe Tenot and Marie Joly.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Claudine Thénot as her daughter, plus a `required` finding that the report documents
the rejection.

The hint names the mother as **Marie Joly**; the subject is **Marie Badoux**. Same given name, different surname, and the reviewer's job is to decide whether that is an index error or a different woman.

The tree contains its own strong hint that it is a different woman. The couple relationship between Philippe Thénot and Marie Badoux carries **two marriage dates** — 22 February 1773 and 27 June 1780 — at the same parish, Romenay. A second wedding seven years on, followed by an October 1781 baptism naming a Marie with a different surname, reads naturally as Philippe remarrying to Marie Joly after Marie Badoux's death, with Claudine belonging to the second marriage. If that is right, this fixture is a false match with an unusually specific reason, and the correct outcome (c) guard is that Claudine must not be attached to Marie Badoux.

The competing reading is that the 1780 date is a duplicate-entry artifact and "Joly" is a mis-indexed "Badoux", which the original Romenay register would settle in one page. Note that the tree carries only two sources, both from the same collection as the hint, so nothing independent is available on the tree side.
