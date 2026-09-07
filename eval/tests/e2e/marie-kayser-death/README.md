# Marie Philippine Kaÿser — death in July 1780, Luxembourg

**Source PID:** `GKZY-81X`
**Marie Philippine Kaÿser is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Theodore Hochhertz and mother of Jodoc Frederic (b. 1776) and Nicolas (b. 1778) Hochhertz.

## Research question

> When did Marie Philippine Kaÿser, wife of Theodore Hochhertz of Luxembourg, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GKZY-81X` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 18, `hint-samples.csv` row 556,
flag `adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Luxembourg, Church and Civil Registration, 1601-1923", a death entry of July 1780 at Luxembourg for Maria Philippina Kayser, naming her spouse as Theodori Hochbertz.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the July 1780 death, plus a `required` finding that the report documents
the rejection.

A clean, narrow candidate. The record names the husband — Theodori Hochbertz, an ordinary Latin-register form of the tree's Theodore Hochhertz — which is the single most discriminating element a death entry of this period offers, and the date sits naturally two years after the birth of the tree's younger son Nicolas (1778) and four after Jodoc Frederic (1776). A death shortly after a second confinement is the commonest shape there is for a woman of this era.

The reviewer's work is mostly on the tree side, which is thin: no dates at all on the subject, and a single source drawn from "Luxembourg, Registres d'état civil, 1796-1941" — a collection that begins **sixteen years after** the hinted death, so whatever it is, it cannot be about her death and probably reaches her through a son's civil-era record. Establish what that source actually says about her before treating the tree as a constraint. If the 1780 entry holds, it also caps her lifespan and should be checked against any age it gives.
