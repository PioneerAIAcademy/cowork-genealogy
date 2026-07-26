# Eulojia del Carmen Gatica Alfaro — burial record (Santiago, 1908)

**Source PID:** `LZ3Z-RHM`
**Eulojia del Carmen Gatica Alfaro is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
christened 2 October 1862, Los Andes, Aconcagua, Chile; died 29 May 1908, Santiago, Chile.

## Research question

> Where and when was Eulojia del Carmen Gatica Alfaro of Santiago, Chile buried, and does a cemetery record corroborate her recorded death date and birth year?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LZ3Z-RHM` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 9, flags `adds_birth`/`adds_burial`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Chile, Cemetery Records, 1701-2021: burial entry, 30 May 1908, Santiago, for Eulogia Gatica Alfaro, with an estimated birth year of 1865. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

This is the **strongest** candidate match in the batch: the tree already records Eulojia's death as 29 May 1908 in Santiago, and the cemetery burial record is dated one day later (30 May 1908) in the same city — an entirely expected sequence, not a coincidence needing much scrutiny. The one wrinkle is the estimated birth year (1865) conflicting with the tree's already-recorded christening date (2 October 1862) by three years; cemetery-record birth-year estimates (often derived from an age-at-death notation) are commonly a few years off a true birth/christening date, so this is marked bonus-only (`required: false`) rather than treated as disqualifying.
