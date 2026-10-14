# Ásgeir Brinjólfsson — born 1777, Hvammur parish, Dalasýsla, Iceland

**Source PID:** `KHJ9-95M`
**Ásgeir Brinjólfsson is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree names him in the genitive, "Asgeirs Brinjolfssonar", as the baptism entries do, and carries no birth and an undated Death fact. Husband of Sigríður Pétursdóttir; daughters Málfríður (born 4 August 1808, christened 5 August 1808) and Sólveig (christened 25 June 1812, at Leysingjastaðir), both in Hvammur parish, Hvammssveit, Dalasýsla.

## Research question

> When and where was Ásgeir Brinjólfsson born, the husband of Sigríður Pétursdóttir and father of Málfríður (christened 5 August 1808) and Sólveig (christened 25 June 1812) at Hvammur in Hvammssveit, Dalasýsla, Iceland?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHJ9-95M` with relatives). Nothing was
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

**Resolved 2026-10-14 (#3335): true match, with a fuller answer (outcome 2).**
The hint record `ark:/61903/1:1:8LRG-VQMM` ("Iceland, Church Census,
1744-1965", the 1808 Hvammur household of Helgi Jónsson and Guðrún Pétursdóttir)
is tree person KHJ9-95M. It answers the question only as "about 1777, Iceland".
His baptism answers it in full: **christened 9 June 1777 at Hvammur in
Hvammssveit, Dalasýsla** (`ark:/61903/1:1:FGPJ-H29`). So f1 now gives the
birth as 1777 in Hvammur parish, Hvammssveit, Dalasýsla, not "about 1777,
Iceland". f1 carries only the year and the parish. The christening date and
the census chain below stay here and in its supporting sources, so a run that
records the birth correctly is not marked down for leaving them out.

**Parish, not farm.** The baptism names the parish church, Hvammur í
Hvammssveit, and it is the only record that places the birth. The family lives
at Ásgarður, a farm in that parish, in 1785–1792, and Ásgeir is there again in
1813. So the records support "born in Hvammur parish". A run that records
Ásgarður, or Hvammur parish, has the right answer. The hint came from
`filtered-list-samples-3.csv` row 13, `hint-samples.csv` row 486, flag
`adds_birth`, confidence 3.

**Baseline.** The tree's only sources for Ásgeir are his daughters' two
baptisms (`FGPF-X52`, Málfríður 1808; `FGPF-F85`, Sólveig 1812). The hint is
attached to no one, so it is new evidence, not a re-index.

**What decided it.** A chain of index entries, each linked to the next by
names, ages and parish:

- **1777, baptism** `1:1:FGPJ-H29`: Asgeir, christened 9 Jun 1777 at
  Hvammur í Hvammssveit. Parents: Brynjólfur Guðmundsson and Sigríður
  Svarthöfðadóttir.
- **1785–1792, church censuses** (1785 `1:1:WL1B-34PZ`, 1786 `1:1:WGS1-CX2M`,
  1788 `1:1:WGZQ-5DT2`, 1789 `1:1:WG3F-L5PZ`, 1792 `1:1:WG3F-G4PZ`): the same
  parents at Ásgarður, Hvammur parish, with "their son" Ásgeir Brinjólfsson,
  born 1777 in every year. A daughter Sólveig is with them, born 1781 (1786 in
  the 1789 entry).
- **1803** `1:1:8BN6-P3T2`: Ásgeir, born 1777, is "her child" in the household
  his mother Sigríður Svarthöfðadóttir heads.
- **1805** `1:1:86N8-MD2M` **and 1808 (the hint)**: farm hand in Helgi Jónsson's
  household, born 1777. Sigríður Pétursdóttir, born 1766, is a maid there in
  1808.
- **1813** `1:1:8HTT-9DZM` **and 1814** `1:1:8HTB-HM6Z`: Ásgeir, born 1777,
  heads his own household. With him are his wife Sigríður Pétursdóttir, born
  1766, and their daughter Málfríður, born 1808. This ties the 1777 age to the
  tree's family independently of the hint.
- **1830** `1:1:8HWF-RQ2M`: Ásgeir Brinjúlfsson, born 1776, farmer at Akur,
  with Sigríður Pétursdóttir (born 1765), Málfríður (born 1807), Sveinbjörn
  Jónsson and Helgi Sveinbjörnsson. It is the same family, with each age a year
  off.
- **1835**: church census `1:1:84Z9-HMPZ`. Ásgeir (1777) and Sigríður (1766)
  live with Málfríður, Sveinbjörn Jónsson and their son Helgi. The 1835
  national census indexes "Asgeir Brynjulfsson", married, born 1777, in
  Dalasýsla (`1:1:681T-JK7P`), but no household members alongside him. The
  tree's own 1835 source for Málfríður is "in entry for Sveinbjorn Jonsson"
  (`681T-ZV2K`).

The church censuses of 1785–1835 give 1777, except 1828 (`1:1:8HW5-K56Z`)
and 1830, which give 1776. The later ones (1842–1858)
and the 1860 national census (`1:1:62DW-VG76`, a widower) drift to 1776, the
usual slippage in old age. The daughter christened in 1812 is named Sólveig,
like Ásgeir's sister.

**A misleading place standard.** Entries from the 1821–1865 church census
register index the place as "Hvammur, Island". Checked: 1828 `8HW5-K56Z` and
1835 `84Z9-HMPZ`. FamilySearch standardizes that to place rep 37573,
"Hvammur, Borgarbyggð, Western, Iceland". That is a farm in another county, not
Hvammur in Dalasýsla, although the register image is catalogued under Hvammur,
Dalasýsla. A run that puts Ásgeir outside Dalasýsla on the strength of those
entries has followed the standardization, not the record.

**The wife's age.** The draft wondered whether the 1808 census misread
Sigríður's 1766 birth year, which makes her 42 and 46 at the two baptisms.
The 1813, 1814 and 1835 censuses repeat 1766, so it is not a one-off misread.
The tree's 1834 birth for her comes from a misattached 1840 entry for a
Sigríður Guðbrandsdóttir. That is live-tree work, not part of this card.

**Searched and empty.**
- FamilySearch holds no 1801 or 1816 national census (*manntal*) for Iceland,
  and no burial or death collection. `collections_search` for Iceland lists
  only Baptisms 1730-1905, Church Census 1744-1965, Census 1835, Census 1860
  and Marriages 1770-1920. So the issue's suggested checks (the 1801 census and
  his burial) cannot be run there. The baptism above replaces them.
- The 1860 census index carries no birthplace field.
- Marriages 1770-1920 has no entry for Ásgeir under Brinjólfsson or
  Brynjúlfsson.

**Retrieval.** All of it used the `packages/engine/mcp-server/dev/try-*.ts`
scripts against live FamilySearch:
- `try-person-read KHJ9-95M`;
- `try-source-attachments` on the hint;
- `try-collections-search Iceland`;
- `try-record-search` across the church census, the 1835 census, baptisms and
  marriages;
- `try-record-read` on every record cited above.

**No image was read.** Every fact above is index text, so `image_basis` stays
off. The identity call is the assigned genealogist's (@Emruthwill). Claude
retrieved and laid out the evidence at the genealogist's direction.
