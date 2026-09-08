# Kierstin Jonsdotter — a daughter Anna christened 1777 at Rättvik

**Source PID:** `K8LX-YMK`
**Kierstin Jonsdotter is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Anders Hansson, with two sons named Hans christened at Rättvik in 1771 and 1781.

## Research question

> Was the Anna christened 12 January 1777 at Rättvik, daughter of Anders Ersson and Kierstin Jöransdotter, a daughter of Kierstin Jonsdotter and Anders Hansson?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K8LX-YMK` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 27, `hint-samples.csv` row 853,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Sweden, Baptisms, 1611-1920", a christening of 12 January 1777 at Rättvik, Kopparberg for Anna, naming parents Anders Ersson and Kierstin Jöransdotter.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Anna as her daughter, plus a `required` finding that the report documents
the rejection.

Both halves of the couple carry the wrong patronymic, and in Swedish records that is two independent objections rather than one repeated.

The tree's husband is **Anders Hansson** — Anders, son of Hans. The hint's is **Anders Ersson**, son of Erik. The tree's wife is **Kierstin Jonsdotter**, daughter of Jon; the hint's is **Kierstin Jöransdotter**, daughter of Jöran. Neither pair is a spelling variant of the other, and the tree's version has internal support: the couple named both their sons **Hans**, which is what a family does when the paternal grandfather is Hans — consistent with a father named Anders Hansson and not with Anders Ersson.

What makes the hint attractive, and the test fair, is that a January 1777 daughter sits neatly in the gap between the tree's two sons (1771 and 1781), in the same parish. Rättvik in Dalarna, where Anders and Kierstin are among the commonest names in the register, will hold several couples of this description in the same decade.

One caution against dismissing it too fast: the tree carries only two sources, both from the same derivative index as the hint, so the tree's patronymics are themselves index readings and not register readings. The Rättvik husförhörslängder are what would settle which Anders held which farm.
