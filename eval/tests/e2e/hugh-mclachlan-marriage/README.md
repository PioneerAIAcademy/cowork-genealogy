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

**Resolved 2026-10-15 (#3344): true match (outcome 1).** The hint, "Scotland, Marriages, 1561-1910", is a marriage of Hugh McLachlan and Catherine Muir on 30 May 1845 at Kilninian and Kilmore, Isle of Mull, entered in a Tobermory register (`ark:/61903/1:1:XTK4-QYM`). It concerns the tree couple, and `expected-findings.json` keeps it, now citing the records below. The hint batch (`filtered-list-samples-3.csv` row 23, `hint-samples.csv` row 792, flag `adds_marriage`, confidence 3) is roughly half false matches, so this one was checked rather than assumed.

**Baseline.** The tree is four people resting on two Campbeltown baptisms: Neil (`ark:/61903/1:1:XY8B-655`, born 25 May 1850) and James (`ark:/61903/1:1:XY8B-JVN`, born 7 December 1852, christened 20 June 1853), both to Hugh McLachlan and Catherine Muir. There is no marriage source, so the hint is not a re-index of anything already in the tree. The weak point was place: Kilninian is at the far end of Argyll from Campbeltown, and Hugh McLachlan is a common name across Argyll.

**What identifies the family.**
- **1851 census, Campbeltown** (`ark:/61903/1:1:VYYQ-ZGH`; indexed district "Cantyre", image group Campbeltown): Hugh Mclachlin, about 32, married, fisher, born Midlothian; Cathrine, about 27, born Argyll (county only); Flora, about 4; Agness, about 2; Niel, under 1. Niel is the tree's Neil, born May 1850.
- **1861 census, Campbeltown** (`ark:/61903/1:1:VB78-JSC`): Cathrine McLachlin, widow, laundress, about 36, born **Saddell**; Flora (about 1847), Annie (about 1849, the 1851 Agness), Neil (about 1851) and James (about 1853), all four given as born at **Tobermory**.
- **James's marriage, Southend, Argyll** (`ark:/61903/1:1:XSF1-FGNL`, "Scotland, Civil Registration"): James McLauchlan, coppersmith, born about 1852, son of Hugh McLauchlan and Catherine Muir. This ties the census family to the tree's James and confirms the maiden name Muir.

**What decided the call.** Neither spouse was born on Mull (Hugh in Midlothian, Catherine in Saddell, Kintyre). But the family has a direct tie to the hint's parish: Tobermory lies in Kilninian and Kilmore, the marriage itself is entered in a Tobermory parish register, and the 1861 census places the two eldest daughters' births there about 1847 and 1849. That puts the couple in Kilninian parish within two to four years of the 1845 marriage, before they moved to Campbeltown, where the 1851 census finds them on 30 March 1851, near Catherine's birthplace. A Kilninian marriage of this Hugh and Catherine Muir is what that sequence predicts, and nothing found contradicts it.

**How strong that evidence is.** The 1861 census is evidence of a Mull connection, not proof that every listed child was born there. Neil and James are also given as born at Tobermory, but their baptisms are in Campbeltown (October 1851 and June 1853). Neil was baptised seventeen months after his birth, so his Tobermory birthplace may be genuine. James's conflicts more directly with his baptism and may be the enumerator carrying Flora's birthplace down the column. The Tobermory tie therefore rests on one census, informant unknown. It is consistent with the 1851 household (two daughters, and possibly Neil, born before the family's first Campbeltown baptism in October 1851), and is not outweighed by anything found.

**Searched and not found.**
- Baptisms of Flora (about 1847) or Agnes/Ann (about 1849) in Kilninian and Kilmore with father Hugh: none indexed.
- No other marriage of Hugh McLachlan and Catherine Muir turned up in the FamilySearch indexes.
- A Hugh McLachlan marriage at Glasgow on 3 August 1851 was seen and set aside. The tree's Hugh was already married, with an infant, in Campbeltown on 30 March 1851.

**Method.** Retrieval was tool-assisted: `dev/try-record-search.ts` and `dev/try-record-read.ts` against live FamilySearch, using the "Scotland, Census, 1851" collection (2028673) and record reads of the 1861 census and civil-registration entries. The identity judgement was the genealogist's (Emruthwill). Everything rests on FamilySearch indexes. No page image was read, so `image_basis` is not set, and ScotlandsPeople was not used: the original Kilninian register and the 1851 and 1861 enumeration pages were not examined.
