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

**Resolved 2026-10-14: true match.** The hint record (`ark:/61903/1:1:6267-W22Q`), the 1 February 1868 Ballylooby (Tubbrid) Catholic parish marriage of "Thomam Hanrahan" and "Johan Ryan", is the marriage of tree person Thomas Hanrahan `KHGX-XWG` and Johanna Ryan `KC1J-LVB`. f1 stands as drafted; its `supporting_sources` now carry the hint's ark and the civil registration's ark. The identity call was made by the assigned genealogist (@Emruthwill). Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts` against live FamilySearch), plus the genealogist's own reading of the civil register page on irishgenealogy.ie.

**What decided it — the civil marriage registration the draft named as the discriminating check:**
- **The same event, independently registered.** "Ireland, Civil Registration, 1845-1913" indexes the marriage of Thomas Hanrahan and Judy Ryan on 1 February 1868 in the Roman Catholic chapel of Ballylooby, Clogheen registration district (`ark:/61903/1:1:QGV8-PQK7`; irishgenealogy.ie Group Registration ID 2989302; the civil index, `ark:/61903/1:1:FY97-HTY`, records a Thomas Hanrahan marriage in Clogheen in 1868, spouse not indexed). Same date, same chapel, same couple as the parish entry.
- **Judy is Johanna.** Both registers record one marriage. The parish register's Latin "Johan[nam]" gives her name as Johanna, and the civil return gives her familiar name, Judy.
- **Fathers:** John Hanrahan (groom) and Thomas Ryan (bride). Neither appears in the tree, so they neither confirm nor contradict the match.
- **No competing couple.** A search of the civil marriages 1862–1872 (Hanrahan, spouse anchored as Johanna Ryan, top 300 of 1,578 results) found this as the only Thomas Hanrahan × Ryan marriage. The other Hanrahan–Ryan couples were John × Margaret, John Ryan × Johanna Hanrahan and William Ryan × Catherine Hanrahan.
- **Place and timing.** Ballylooby is about 5 miles from Ardfinnan. There, the tree's son John was born on 28 November 1872 to Thomas Hanrahan and Johanna Ryan (`1:1:F5YK-84C`; civil birth `1:1:QPJL-5TVM`), and daughter Mary on 17 February 1871 (`1:1:F5GR-QBN`). A February 1868 marriage fits the first child in 1869. Neither of those records re-indexes the hint, and the tree held no marriage source.

**The page image: what it could and could not settle.** The civil register images on FamilySearch (`3:1:3Q9M-C9BX-6SCX-X`) and the parish image (`3:1:3Q9M-CSR6-M3SY-1`) both returned 403, so the genealogist read the civil page (page 782) on irishgenealogy.ie instead. Before relying on the reading, two other entries on the same page were checked against the FamilySearch index (names, fathers, date), and both matched:
- No. 14, Bernard Kelly × Kate Mulvey, 25 Jan 1868 (`1:1:QGV8-F2DW`)
- No. 15, Timothy Burke × Judy Hennessy, 1 Feb 1868 (`1:1:QGV8-N654`)

Row 16 gives both parties as **"full age"**, not a number. That means 21 or over: consistent with the tree's 28 and 23 (born 1840 and 1845), but it cannot confirm them, so the age check the draft hoped for is not available. The row also gives Thomas as a farmer of **Castlegrace**, a townland near Ardfinnan, and the witnesses as Thomas White and Ellen Wall. Under the image-reading rule the residence is unlicensed, so the verdict does not rest on it. The call rests on the indexed civil entry, so `image_basis` is off.

**Left open.** The 1880 census gives Elizabeth (1869) and Thomas (1870) as born in New York, which does not sit with a family registering births in Tipperary in 1871 and 1872. That strains the census, not this marriage. A search for an Irish birth for either child with these parents found none, but it looked only at the top 15 results per search.
