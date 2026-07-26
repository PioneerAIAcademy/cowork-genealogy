# Susanna Szljacsan — husband Joannes Janeczky and daughter Susanna

**Source PID:** `LDK6-6SH`
**Susanna Szljacsan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
5 March 1850, Lisková, Ružomberok, Slovakia; died not recorded in the tree.

## Research question

> Who did Susanna Szljacsan of Lisková, Ružomberok, Slovakia marry, and did she have a daughter named Susanna, baptized about 1884?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LDK6-6SH` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 29, flags `adds_spouse`/`adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Slovakia, Church and Synagogue Books, 1592-1935: baptismal entry for Susanna Janeczky, naming parents Joannes Janeczky and Susanna Szliacsan. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Joannes Janeczky as the subject's husband, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree currently records no spouse or children at all for Susanna Szljacsan, so this record would be the first family data past her own baptism. The surname "Szliacsan" in the hint matches the tree's "Szljacsan" almost exactly (a one-letter transposition, a routine transcription variant), and the parish (Lisková, Ružomberok) matches her own baptismal parish exactly. A daughter baptized about 1884 would put Susanna at about age 34 — plausible, though there is no independent tree record of a marriage to cross-check the husband's name against.
