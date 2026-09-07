# Ísleifur Ísleifsson — a son Einar by Thórunn Einarsdóttir (chr. 1856, Kross)

**Source PID:** `KCS6-8SG`
**Ísleifur Ísleifsson is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 12 October 1832 at Kross, Rangárvallasýsla; died 10 January 1870 and buried 17 January 1870 at Kross.

## Research question

> Did Ísleifur Ísleifsson of Kross, Rangárvallasýsla have a son Einar christened 28 September 1856 by a Thórunn Einarsdóttir — or does that baptism belong to a different Ísleifur Ísleifsson?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KCS6-8SG` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 15, `hint-samples.csv` row 485,
flag `adds_spouse,adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Iceland, Baptisms, 1730-1905", a christening of 28 September 1856 at Kross, Rangárvallasýsla for Einar, naming parents Isleifur Isleifsson and Thorun Einarsdr.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Thórunn Einarsdóttir as a partner and Einar as his son, plus a `required` finding that the report documents
the rejection.

The arithmetic is the whole case. The tree already has a daughter of this man, Steinunn Ísleifsdóttir, christened at Kross on **16 September 1856**. The hinted Einar was christened at the same church on **28 September 1856** — twelve days later. No woman bears both, and they are not twins, since twins are christened together.

The mother's name says the same thing: the tree names Guðríður Gunnlaugsdóttir, the hint names Thórunn Einarsdóttir, and Icelandic patronymics leave no room to read those as one name misspelled.

So the likely reading is a second Ísleifur Ísleifsson in Kross parish. That is not a stretch: Icelandic patronymics regenerate the same name every other generation — this subject's own father is Ísleifur Eyjólfsson, and any son of any Ísleifur is an Ísleifsson — so a single parish routinely holds several. Before concluding, though, weigh the one thing that cuts the other way: the tree's marriage to Guðríður is dated only "about 1857", so *both* the tree's own 16 September child and the hinted 28 September child precede the recorded marriage, and the tree's date is an estimate rather than a record. The reviewer should decide whether the parish's own ministerial book (prestþjónustubók) resolves the two households, since the tree already cites it for the 1861 son and the 1870 death.
