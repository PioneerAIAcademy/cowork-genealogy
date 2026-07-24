# Friedrich Carl Weber — daughter Anna Maria Eva (b. 1870)

**Source PID:** `GTDL-981`
**Friedrich Carl Weber is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1846; died not recorded in the tree.

## Research question

> Did Friedrich Carl Weber and his wife Catharina Carell of Sindlingen, Hesse-Nassau have a daughter named Anna Maria Eva, born 1870?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GTDL-981` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 14, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Deutschland, Hesse-Nassau, Diözese Limburg, Katholische Kirchenbücher, 1601-1919: baptismal entry for Anna Maria Eva Weber, b. 26 Feb 1870, naming parents Karl Weber and Katharina Karell. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1870 Anna Maria Eva Weber birth, plus a `required` finding that the report documents the rejection.

This is one of the **stronger** candidate matches in the batch: the tree's marriage date for Friedrich Carl Weber and Catharina Carell is 7 February 1869 in Sindlingen, Kreis Höchst — the same parish/district as the hint record's Höchst baptism, and the birth (26 Feb 1870) falls almost exactly eleven months after the marriage, a very typical first-child interval. "Karl" is a routine short form of "Friedrich Carl", and "Karell"/"Carell" is an exact-sound surname match for the mother. The tree currently records no children for this couple, so this would be their first.
