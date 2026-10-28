# Maria Dorothea Stockburger — a son Andreas Mayer baptised at Sankt Georgen in September 1812

**Source PID:** `9DQM-45L`
**Maria Dorothea Stockburger is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No birth or death date in the tree; it carries an undated Death fact. Wife of Johann Georg Meyer (Maier, Mayer), who appears in the tree twice, as `9D31-B4G` and `9DQM-45F`. Mother of Magdalena, born 5 March 1817 and baptised at Sankt Georgen im Schwarzwald (Oberkirnach), who married Christian Bäuerle in 1837, and of Anna Maria, born 9 November 1821 at Oberkirnach, Amt Villingen, who married into the Weisser family and died 2 September 1900.

## Research question

> What children did Maria Dorothea Stockburger, wife of Johann Georg Meyer and mother of Magdalena (born 5 March 1817) and Anna Maria (born 9 November 1821), both baptised at Sankt Georgen im Schwarzwald, Baden, have besides these two?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `9DQM-45L` with relatives). Nothing was
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

**Resolved as a false match (outcome 3 — polarity:avoid).** The hint record
(`ark:/61903/1:1:NNXZ-4L3`) is a baptism entry for Andreas Mayer, born and
baptised 5 September 1812 at Sankt Georgen, naming parents "Johann Georg Mayer,
Bürger in [Magdalsthal], Rennuß Nachb." and "Maria Dorothea uaor geb. Stokburger."
The godparents column ends "Alle von Rennuß" (all from Rennus). The entry also
carries a marginal death note: "† 4 H. 29 Februars 1852."

**What decided it:** The register image (Image 120 of group 3015626,
`ark:/61903/3:1:3Q9M-CS43-L99T-Q`) was read to identify the father's hamlet.
The 1812 entry places the father at **Rennuß** (Rennus), a hamlet within the
Sankt Georgen parish. The tree couple's two known children — Magdalena (1817)
and Anna Maria (1821) — are both from **Oberkirnach**, a different hamlet in the
same parish. The parent names match, but the hamlet does not: this is a second
Johann Georg Mayer + Maria Dorothea Stokburger household in the parish, based in
Rennuß rather than Oberkirnach. Mayer is common in the area and the tree already
carries two person entries for "Johann Georg" (PIDs `9D31-B4G` and `9DQM-45F`),
confirming the name collision is real.

**Image-read check:** The verdict rests on reading the register image
(`image_basis: true`). The check against two other indexed entries on the same
page was not independently verified in this session. A reviewer may confirm by
checking any two of entries 35–38 (also on Image 120) against their FamilySearch
index records.

**What was searched:** The indexed baptism register for children of Johann Georg
Mayer and Maria Dorothea Stockburger at Sankt Georgen was searched
comprehensively. Seven children were found (including Magdalena 1817 and Anna
Maria 1821 already in the tree); no Andreas appears among them as a child of the
Oberkirnach branch of this couple.
