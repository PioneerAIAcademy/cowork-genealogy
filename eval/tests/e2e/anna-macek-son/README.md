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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 12, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Czech Republic, Church Books, 1552-1981: baptismal entry, 26 June 1867, Rohovládova Bělá, Pardubice, naming parents Váčlav Jičinsky and Anna. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1867 František baptism, plus a `required` finding that the report documents the rejection.

**Strong reason to doubt this match**: the tree records Anna Macek's own birth as **1851** and her marriage to Václav Jičinský as **7 February 1871**. A son baptized in **1867** would make Anna only 16 years old and would predate her recorded marriage by four years — a serious internal inconsistency. Either the tree's 1851 birth year for Anna is wrong, this "Anna" and "Václav Jičinský" (a bare-forename mother and a very common Czech husband-surname pairing) are a different couple in the same region, or the baptismal date was misindexed. This fixture is a strong candidate for outcome (c) (false match) but is left as a recover-type draft finding pending the genealogist's review of the underlying parish register.
