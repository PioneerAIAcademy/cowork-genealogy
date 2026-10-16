# Thomas Hanrahan — marriage in February 1868, Tipperary, Ireland

**Source PID:** `KHGX-XWG`
**Thomas Hanrahan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1840 in Ireland; the tree carries an undated Death fact and an 1880 residence in Saratoga, New York. Wife Johanna Ryan (born 1845, Ireland); children Elizabeth (1869) and Thomas (1870), both given as born in New York, Mary (17 February 1871, Ireland) and John (28 November 1872, Ardfinnan, Tipperary). The couple has no marriage fact.

## Research question

> When and where did Thomas Hanrahan, born about 1840 in Ireland and living in Saratoga, New York, in 1880, marry Johanna Ryan?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHGX-XWG` with relatives). Nothing was
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

**Resolved 2026-10-16: false match (outcome 3).** The hint record (`ark:/61903/1:1:6267-W22Q`) is the 1 February 1868 Ballylooby (Tubbrid) Catholic parish marriage of "Thomam Hanrahan" and "Johan Ryan". It is **not** the marriage of tree person Thomas Hanrahan `KHGX-XWG`, the man living in Saratoga, New York, in 1880. It belongs to an Irish couple of the same names. f1 is now an `avoid` finding: the agent must not attribute that marriage to the Saratoga couple. f2 requires the report to explain the rejection from the New York records and to say the Saratoga couple's marriage is unidentified. The identity call was made by the assigned genealogist (@Emruthwill), after a reviewer on PR #3426 brought the New York records forward. An earlier version of this fixture called the hint a true match. Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts` against live FamilySearch), plus the genealogist's own reading of the civil register page on irishgenealogy.ie.

**The records that disprove the match: the Saratoga couple were in New York throughout.**
- **1865**, New York State census, Northumberland, Saratoga County: Thomas Hanrahan (about 1843), Joanna (about 1846) and Mary (1865) (`ark:/61903/1:1:QVNN-7MNR`).
- **1880**, US census, Saratoga (`ark:/61903/1:1:MZF2-Y55`): Thomas, a stone mason (1840, Ireland); Johannah (1845, Ireland). All four children are given as born in New York: Mary 1865 (working in a cotton mill), Elizabeth 1869, Thomas 1870 and John 1872.
- **1900**, US census, Saratoga (`ark:/61903/1:1:MSG7-614`): Thomas, born March 1843, immigrated 1860; Johanna, born November 1844, immigrated 1853.

**The Irish couple are a different family.** The Ballylooby marriage is real and independently registered. The civil return gives Thomas Hanrahan and Judy Ryan, 1 February 1868, the Roman Catholic chapel of Ballylooby, Clogheen district (`ark:/61903/1:1:QGV8-PQK7`; irishgenealogy.ie Group Registration ID 2989302). It names the fathers John Hanrahan and Thomas Ryan, gives both parties as "full age", and gives Thomas's residence as Castlegrace. Two other entries on the same register page were checked against the FamilySearch index and matched: No. 14, Bernard Kelly × Kate Mulvey (`1:1:QGV8-F2DW`), and No. 15, Timothy Burke × Judy Hennessy (`1:1:QGV8-N654`). That couple's children were registered in Tipperary: Mary on 17 February 1871 (`1:1:F5GR-QBN`) and John on 28 November 1872 at Ardfinnan (`1:1:F5YK-84C`; civil `1:1:QPJL-5TVM`). The Saratoga family had a Mary born in 1865 and a John born in 1872 in New York. Two Marys six years apart and two Johns born in different countries in the same year are two families. The live tree has merged them: Mary `93RB-RTD` and John `M8R7-2TR` each carry the 1880 census entry and an Irish birth.

**The earlier argument that does not hold.** The true-match version said a February 1868 marriage "fits the first child in 1869". That child is Elizabeth, whom the 1880 census gives as born in New York, and the Saratoga family already had Mary in 1865. The timing fits the Irish couple, not the Saratoga one.

**What remains unknown.**
- **The Saratoga couple's marriage.** Searches of the FamilySearch United States marriage indexes, 1858–1872, for Thomas Hanrahan with the spouse anchored as Johanna or Joanna found only other couples, in Kentucky, Massachusetts, Ohio and New Jersey. Not finding a record does not show that the couple never married. The 1900 census's "married 29 years" (about 1871) conflicts with Mary's 1865 birth and is not taken as evidence of a date.
- **Johanna's maiden surname.** "Ryan" for the Saratoga woman comes only from the Irish records attached to the merged children. It is not independently established, although the fixture's research question repeats it.
