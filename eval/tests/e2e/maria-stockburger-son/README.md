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

**Resolved as a true match (outcome 1).** The hint record
(`ark:/61903/1:1:NNXZ-4L3`) is the baptism of Andreas Mayer, born and baptised
5 September 1812 at Sankt Georgen, entry 34 on Image 120 of group 3015626
(`ark:/61903/3:1:3Q9M-CS43-L99T-Q`). It names his parents as Johann Georg Mayer
and Maria Dorothea Stokburger and places the family at Kirnach. Andreas is a son
of the tree couple. Reviewed by Edmond against the image and the index.

**What decided it:**

1. **Same household.** Entry 34 and Magdalena's 1817 baptism entry
   (`QPD6-95WX`) both point to family register page 70. One register page is
   one household.
2. **The children fit one sequence.** The index returns 11 children of this
   couple at Sankt Georgen, spaced 14 to 35 months apart with no overlaps.
   Andreas falls cleanly between Jacob (December 1810) and Dorothea
   (January 1814). A second couple of the same names would show as overlapping
   or crowded births; there are none.

**Image-read check.** The register image was read, so the reading was checked
against two other indexed entries on the same page first. Entry 35
(`N87L-45S`, Anna Weisser): the mother reads Rosenfelder, matching the index.
Entry 38 (`NCC4-6G7`, Christoph Mayer): the mother reads Lupfer, matching the
index. Both match, so the reading is licensed for child, parents and date. The
check does not license the residence word "Kirnach"; the verdict does not rest
on it.

Retrieval was by hand on familysearch.org.
