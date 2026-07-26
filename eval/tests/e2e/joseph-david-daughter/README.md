# Joseph David — a different Joseph Davies household? (1901 census)

**Source PID:** `GNR6-VWS`
**Joseph David is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1873, Clydach near Llantrisant, Glamorgan, Wales; died not recorded in the tree.

## Research question

> Did Joseph David and his wife Hannah David of Clydach, Glamorgan, Wales have a daughter named Elizabeth A., born 1899, in addition to their three known children (b. 1897-1908)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GNR6-VWS` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 33, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — England and Wales, Census, 1901: household of Joseph Davies and Hannah Davies, Merthyr Tydfil, Glamorgan, with daughter Elizabeth A Davies (b. 1899, Treharris). The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Elizabeth A Davies as the subject's daughter, plus a `required` finding that the report documents the rejection.

**Strong reason to doubt this match**: the census household's Joseph Davies is recorded born **1876 in Hirwaun**, versus the tree's Joseph David born **1873 in Clydach near Llantrisant** — a different year and a different town. The household's Hannah Davies is recorded born **1878 in Llanidloes, Montgomeryshire** — a town in a completely different county from the tree's Hannah David (b. 1875, same Clydach parish as her husband). "David"/"Davies" is one of the most common surnames in Wales, and a household census match on common given names with two independently conflicting birthplaces for both spouses is a classic false-hint pattern. This fixture is a strong candidate for outcome (c) (false match — most likely an unrelated, same-named couple) but is left as a recover-type draft finding pending the genealogist's review.
