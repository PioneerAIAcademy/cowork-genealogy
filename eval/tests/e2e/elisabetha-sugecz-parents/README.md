# Elisabetha Sugecz — parents Thomas Sugecz and Susanna Petrich

**Source PID:** `G4C9-Y6C`
**Elisabetha Sugecz is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree (married abt. 1814, Madžarevo, Varaždin, Croatia); died not recorded in the tree.

## Research question

> Who were the parents of Elisabetha Sugecz, wife of Thomas Pofuk-Harmicar of Madžarevo, Varaždin, Croatia?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G4C9-Y6C` with relatives). Nothing was
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

**Resolved: false match, no findable substitute.** This fixture came from a hint batch (`filtered-list-samples.csv` row 11, flags `adds_father`/`adds_mother`, confidence 3) in which roughly half the hint records are false matches. The genealogist reviewed both the tree person and the hint record and confirmed this is one of them.

**Why it's rejected:** the tree records no birth or baptismal date at all for Elisabetha Sugecz directly, but it does record her children — and her last recorded child, Andreas Harmiczar, was baptized 8 October 1837 (`ark:/61903/1:1:QKMN-LM5B`) in the same parish (Madžarevo, Varaždin). A birth in 1786, per the hint's baptismal entry, would make Elisabetha about 51 years old at that 1837 birth — not a credible age for the mother of record still bearing children into the 1830s. The exact surname and parish match make the hint a plausible-looking candidate on its face, but the age-implausibility it creates against her own documented childbearing rules it out. No substitute baptism or marriage establishing her actual parents was found anywhere in Croatia, Church Books, 1516-1994 for the Madžarevo, Varaždin parish register series across the date range her documented life spans; that absence has no ark to cite by definition (spec §3.6.1) and stands as the negative conclusion alongside the disproving 1837 record, which does.
