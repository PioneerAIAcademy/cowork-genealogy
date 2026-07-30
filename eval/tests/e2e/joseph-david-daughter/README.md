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

**Resolved: false match (no findable substitute).** The genealogist reviewed the FamilySearch hint (`filtered-list-samples.csv` row 33, flag `adds_daughter`, confidence 3) — England and Wales, Census, 1901: household of Joseph Davies and Hannah Davies, Merthyr Tydfil, Glamorgan, with daughter Elizabeth A Davies (b. 1899, Treharris) — and concluded it does **not** belong to the subject Joseph David (`GNR6-VWS`). Successful research is therefore that the agent does **not** add Elizabeth A. Davies as Joseph David's daughter. `expected-findings.json` now carries a `"polarity": "avoid"` guard against that assertion plus a `required` finding documenting the negative conclusion.

**Why the match fails.** The hint rests entirely on the common Welsh surname David/Davies and shared given names, while both spouses' recorded details conflict with the tree on two independent axes each:

- Census **Joseph Davies** — born **1876 in Hirwaun**; tree **Joseph David** — born **1873 in Clydach near Llantrisant**. Different year *and* different town.
- Census **Hannah Davies** — born **1878 in Llanidloes, Montgomeryshire**; tree **Hannah David** — born **1875 in the same Clydach parish as her husband**. Different year *and* a completely different county.

"David"/"Davies" is one of the most common surnames in Wales; a census-household hint on shared given names with two independently conflicting birthplaces for *both* spouses is a textbook false-hint. No independent evidence was found tying an Elizabeth A. born 1899 to the subject's family, so there is no corrected daughter to substitute — the correct outcome is a documented rejection, leaving the tree's three known children (Ethel b. 1897, Illiam G. b. 1900, Enid b. 1908) unchanged.
