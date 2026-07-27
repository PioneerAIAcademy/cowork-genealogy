# Susanna Dawson Kneale — marriage and father John Dawson

**Source PID:** `9KNQ-8YB`
**Susanna Dawson Kneale is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1840, Lezayre, Isle of Man; died not recorded in the tree (last residence 1901, England).

## Research question

> When and where did Susanna Dawson marry John Kneale, and who was her father?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9KNQ-8YB` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 21, flags `adds_father`/`adds_marriage`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Isle of Man, Parish Registers, 1598-2009: marriage entry, 21 October 1860, Lezayre, for John Kneale (son of Thomas Kneale) and Susanna Dawson (daughter of John Dawson). The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

This is one of the **stronger** candidate matches in the batch: the groom's name "John Kneale" matches the tree's recorded spouse exactly, the tree currently has **no** marriage date or father recorded for Susanna at all, and the marriage date (21 October 1860) falls almost exactly eleven months before the couple's first tree-recorded child (Thomas, b. 1861) — a textbook first-child interval. The father's name, John Dawson, matching the bride's surname "Dawson" (already part of the subject's full recorded name, "Susanna Dawson Kneale"), is an additional point in favor rather than a coincidence.
