# Elisabetha Sugecz — parents Thomas Sugecz and Susanna Petrich

**Source PID:** `G4C9-Y6C`
**Elisabetha Sugecz is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree (married abt. 1814, Madžarevo, Varaždin, Croatia); died not recorded in the tree.

## Research question

> Who were the parents of Elisabetha Sugecz, wife of Thomas Pofuk-Harmicar of Madžarevo, Varaždin, Croatia?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G4C9-Y6C` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 11, flags `adds_father`/`adds_mother`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Croatia, Church Books, 1516-1994: baptismal entry, 14 August 1786, Madžarevo, Varaždin, naming parents Thomæ Sugecz and Susanæ Petrich. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Thomas Sugecz and Susanna Petrich as the subject's parents, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree has **no** birth or baptismal date at all currently recorded for Elisabetha Sugecz, so this record would be the first anchor date for her. Her marriage to Thomas Pofuk-Harmicar is dated "about 1814" in the same parish (Madžarevo, Varaždin), and a 1786 baptism would make her about 28 at marriage — plausible. The surname "Sugecz" matches exactly and the parish matches exactly, which is a reasonably strong signal for a name this specific, though there is no independent date already in the tree to cross-check the 1786 baptism against.
