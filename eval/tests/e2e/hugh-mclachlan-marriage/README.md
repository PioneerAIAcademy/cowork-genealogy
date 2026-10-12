# Hugh Mclachlan — marriage in 1845, Kilninian, Argyll, Scotland

**Source PID:** `KCWN-N2T`
**Hugh Mclachlan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree gives him no birth and an undated Death fact. Husband of Catharine Muir, with no marriage fact on the couple; father of Neil (born 25 May 1850, christened 24 October 1851) and James (born 7 December 1852, christened 20 June 1853), both christened in Campbeltown, Argyll.

## Research question

> When and where did Hugh Mclachlan marry Catharine Muir, the parents of Neil (born 1850) and James (born 1852), both christened in Campbeltown, Argyll?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KCWN-N2T` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 23, `hint-samples.csv` row 792,
flag `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Scotland, Marriages, 1561-1910", a marriage entry for Hugh McLachlan and Catherine Muir in 1845 (year only) in Kilninian, Argyll, on the Isle of Mull. The entry carries no ages, parents, residences or image.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1845 Kilninian marriage, plus a `required` finding that the report documents
the rejection.

A name-only match. Both names agree with the tree couple exactly (the tree's own baptism indexes spell her Catherine and Catharine), and 1845 is five years before the first child the tree knows of, which is unremarkable. The tree is four people resting on two baptism entries, Neil's (`ark:/61903/1:1:XY8B-655`) and James's (`ark:/61903/1:1:XY8B-JVN`); there is no marriage source, so this is not a re-index of anything already in the tree.

The place is the weak point. Kilninian is on the Isle of Mull, at the far end of Argyll from Campbeltown, where both sons were christened five to eight years later, and Hugh McLachlan is a common name across Argyll. Scottish parish registers often entered a marriage in each party's parish, so a Mull entry for a couple who settled in Kintyre is possible, but nothing in the tree ties either of them to Mull. The discriminating check is the 1851 census of Campbeltown, which should show Hugh, Catharine and the infant Neil with their parishes of birth: a birthplace on Mull for either spouse supports the match, and both born in Kintyre points to a different couple.
