# Anna Macek — additional son František (b. 1867)

**Source PID:** `PW3W-LJN`
**Anna Macek is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1851; died not recorded in the tree.

## Research question

> Did Anna Macek and her husband Václav Jičinský of Rohovládova Bělá, Pardubice, Czechia have a son named František, baptized 1867?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `PW3W-LJN` with relatives). Nothing was
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

**Resolved: false match.** This fixture came from a hint batch
(`filtered-list-samples.csv` row 12, flag `adds_son`, confidence 3) in which
roughly half the hint records are false matches. The genealogist reviewed
both the tree person and the hint record and confirmed this is one of them.

**Why it's rejected**: the tree records Anna Macek's own birth as **1851**
and her marriage to Václav Jičinský as **7 February 1871**. The hint's
baptismal entry — Czech Republic, Church Books, 1552-1981, 26 June 1867,
Rohovládova Bělá, Pardubice, naming parents Václav Jičinsky and Anna —
dates nearly four years *before* that marriage, and would require Anna to
have given birth at age 16. Both facts independently rule out the match:
a child cannot predate his parents' marriage, and the age is
biologically implausible on top of that. The baptismal entry's bare-forename
mother ("Anna") and common Czech husband-surname ("Jičinský") point to a
different couple of the same names in the same parish, not this Anna Macek.
No substitute son was found for Anna Macek and Václav Jičinský; the tree
currently records no children for her, and that stands as the negative
conclusion.
