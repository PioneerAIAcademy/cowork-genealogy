# Sármán Rozál — additional daughter Viktoria (b. abt. 1892)

**Source PID:** `P873-TWP`
**Rozál Sármán is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
27 September 1872, Livada, Arad, Romania; died not recorded in the tree.

## Research question

> Did Rozál Sármán and her husband István Juhász of Torontál, Hungary have a daughter named Viktoria, baptized about 1892, in addition to their known daughter Ágnes (b. 1894)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `P873-TWP` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 28, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Hungary, Catholic Church Records, 1636-1895: baptismal entry, Kiszombor, Torontál, naming parents Istvan Juhasz and Rozal Szaz. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Viktoria Juhász as the subject's daughter, plus a `required` finding that the report documents the rejection.

**Reason to doubt this match**: the mother's surname in the hint record is "**Szaz**", which does not resemble the subject's tree surname "**Sármán**" at all — similar to the row-20 Katalin Horák/Liskovics case, this is a materially weaker name link than most of this batch. The father's name "István Juhász" matches the tree's recorded spouse exactly, and a daughter baptized about 1892 fits neatly two years before the tree's known daughter Ágnes (b. 1894) — plausible as an older sibling. The place (Torontál) is consistent with the tree family's documented region. A reviewer should weigh the surname mismatch heavily against the otherwise-consistent father's name and timeline.
