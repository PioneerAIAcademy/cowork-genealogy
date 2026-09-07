# Catharina Gosnerin — daughter Magdalena Schedler (chr. 1743, Triesen)

**Source PID:** `KZS8-RS7`
**Catharina Gosnerin is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Joannes Schedler of Triesen, with four children christened there between 1741 and 1756.

## Research question

> Did Catharina Gosnerin and Joannes Schedler of Triesen, Liechtenstein have a daughter Magdalena, christened 12 June 1743?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KZS8-RS7` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 17, `hint-samples.csv` row 539,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Liechtenstein, Births and Baptisms, 1650-1875", a christening of 12 June 1743 at Triesen for Magdalena Schedler, naming parents Joannes Schedler and Catharina Schedlerin.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Magdalena Schedler as her daughter, plus a `required` finding that the report documents
the rejection.

A good candidate, and the point of interest is how the mother is named. The record calls her **Catharina Schedlerin** — the husband's surname with the feminine `-in` ending, which is exactly how eighteenth-century Alemannic registers write a wife — while the tree calls her **Catharina Gosnerin**, her own maiden surname under the same convention. The two are compatible, not contradictory, and a reviewer who reads `Schedlerin` as a different woman has misread the convention.

Everything else lines up. The father is Joannes Schedler, the same name the tree gives; the parish is Triesen, where all four of the tree's known children were christened; and a daughter in June 1743 fills the gap between Antonius (December 1741) and Josephus (November 1751) in a family whose christenings are otherwise spaced two to five years apart.

What the reviewer still has to rule out is a second Joannes Schedler couple in the same parish — Schedler is a common Triesen surname, which is precisely why the register resorts to `Schedlerin` rather than a maiden name — and to check whether this baptism is already among the four "Liechtenstein, Births and Baptisms" sources the tree carries.
