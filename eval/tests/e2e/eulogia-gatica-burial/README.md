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

**Resolved: TRUE MATCH.** The hint record — Chile, Cemetery Records,
1701-2021: burial entry, 30 May 1908, Santiago, for Eulogia Gatica Alfaro —
is confirmed to belong to Eulojia del Carmen Gatica Alfaro (`LZ3Z-RHM`).
Research on this fixture is successful when that burial record is attached
to her. The findings in `expected-findings.json` are kept as transcribed.

What decided it: the tree already records Eulojia's death as 29 May 1908
in Santiago, and the cemetery burial record is dated one day later
(30 May 1908) in the same city — an expected death → burial sequence in one
locality, not a coincidence. No competing same-named Santiago candidate with
a conflicting death/burial date turned up to unseat the identification.

The one wrinkle is the estimated birth year (1865) conflicting with the
tree's already-recorded christening date (2 October 1862) by three years.
Cemetery-record birth-year estimates (typically derived from an age-at-death
notation) are commonly a few years off a true birth/christening date, so this
is graded bonus-only (`required: false`) rather than treated as disqualifying;
it does not weaken the burial identification.
