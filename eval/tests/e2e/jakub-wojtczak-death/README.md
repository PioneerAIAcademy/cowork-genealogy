# Jakub Wojtczak — death in March 1997, Waterbury, Connecticut

**Source PID:** `PM7N-7HV`
**Jakub Wojtczak is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, an undated Death fact, no places and no sources for him. Husband of Helena Bazelak; father of Irena (25 October 1932 – 12 January 2011), Stefan (25 August 1935 – 17 January 2012) and Kazimierz (10 June 1942 – 9 December 2022), none of whom has a place in the tree either.

## Research question

> When and where did Jakub Wojtczak die, the husband of Helena Bazelak and father of Irena (born 25 October 1932), Stefan (born 25 August 1935) and Kazimierz (born 10 June 1942) Wojtczak?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `PM7N-7HV` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 31, `hint-samples.csv` row 928,
flags `adds_father,adds_birth,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Connecticut, Death Index, 1949-2001", an entry for Frank J Wojtczak, born 2 December 1917 in Connecticut, a married retired pattern maker of Naugatuck who died 19 March 1997 in Waterbury, New Haven County, with a spouse indexed as Helen and a father indexed by surname only. The CSV's country column says "Unknown"; the record's jurisdiction is Connecticut, so the fixture is tagged `US-CT`.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the March 1997 Waterbury death, plus a `required` finding that the report documents
the rejection.

A weak candidate that the tree's own dates argue against. The only things the record shares with the tree are the surname and a wife's given name, Helen against the tree's Helena. The given name is Frank, which is the English form of Franciszek, not of Jakub; the middle initial J could stand for Jakub, but nothing shows it does. The birth year is the real problem: born December 1917, Frank would have been 14 at Irena's birth in October 1932 and 17 at Stefan's in 1935. The children's Polish given names and a tree with no places at all fit a family that stayed in Poland at least as well as a Connecticut one. The tree cites no records for anyone in the family, so there is no existing source this could be a re-index of.

The `adds_father` flag is an indexing artefact: the father appears only as the surname "WOJTCZAK", the father's-surname field of the death index, and adds no one. `adds_birth` is the index's own 1917 Connecticut birth, which is what makes the match doubtful. The discriminating check is the 1940 U.S. census for Frank Wojtczak in Connecticut (about age 22): a household with a wife Helen and children Irena and Stefan, aged about 7 and 4, would mean the tree's children's dates are wrong and the hint is right; a young single man or a household without them would mean the Jakub of the tree is someone else, most likely in Poland.
