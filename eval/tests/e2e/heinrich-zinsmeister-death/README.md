# Heinrich Zinsmeister — birth, death and burial (Bavaria, 1854)

**Source PID:** `KD72-C6D`
**Heinrich Zinsmeister is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree (undated Death fact only).

## Research question

> When and where was Heinrich Zinsmeister of Steinwenden, Pfalz, Bavaria born, and when and where did he die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `KD72-C6D` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 5, flags `adds_birth`/`adds_death`/`adds_burial`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Germany, Deaths and Burials, 1582-1958: Heinrich Zinssmeister, born about 1768, died 15 December 1854, buried 17 December 1854, Bavaria, spouse Elisabetha Engel. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1854 death/burial claim, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh **against** the match: if Heinrich Zinsmeister was born about 1768, he would have been 51 years old at the birth of his tree-recorded eldest daughter Maria Catharina (christened 1819) and 60 at the birth of his youngest recorded daughter Elisabetha (christened 1828) — an unusually late (though not impossible) span for fathering children in this era, and worth checking against a second marriage or a generational mismatch. In favor: the spouse name "Elisabetha Engel" is a plausible abbreviation of the tree's "Elisabetha Engelskircher", and the daughters' baptismal parish (Evangelisch, Steinwenden, Pfalz, Bavaria) is consistent with the hint record's Bavarian origin.
