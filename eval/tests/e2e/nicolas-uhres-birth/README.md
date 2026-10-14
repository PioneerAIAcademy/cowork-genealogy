# Nicolas Uhres — birth about 1856, Keispelt, Luxembourg

**Source PID:** `GYGJ-D1C`
**Nicolas Uhres is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for him — no birth. Wife Marguerite Birchen (undated); children Johann (5 December 1883, Keispelt, Kehlen) and Josephine (23 July 1885, Keispelt; died 1958 in Owatonna, Minnesota). The couple has no marriage fact.

## Research question

> When and where was Nicolas Uhres born, the husband of Marguerite Birchen and father of Johann (born 1883) and Josephine (born 1885) Uhres of Keispelt, Luxembourg?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GYGJ-D1C` with relatives). Nothing was
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

**TRUE MATCH — the 1880 hint record is the tree person.** Re-adjudicated 2026-10-14 (twice); final verdict from florencemashipei, supported by image evidence from benter. The 1880 Kehlen census entry (`ark:/61903/1:1:6PBG-1Q63`) for Nicolas Uhres, single, born 1856, Keispelt, IS tree person GYGJ-D1C as a young single man living in his family of origin.

**The namesake identified.** A second Nicolas Uhres — born 1859, son of Jean Uhres (born 1821, Nospelt) and Barbe Kirsch — lived in the same commune. His 1880 entry is indexed as "Nas Uhres" (`ark:/61903/1:1:6PBP-9LZV`); the name variant is why an index-only search for "Nicolas Uhres" missed him. Florence's first review accepted the 1856 man as the namesake without finding "Nas"; benter's image evidence corrected this.

**Household images separate the two families.** The 1880 census image (`ark:/61903/3:1:3QS7-8971-YDYD`) shows hint-record Nicolas (born 1856, `6PBG-1Q63`) in the household of widow Margrethe Teller alongside siblings Louis Uhres (born 1863, `6PBP-Z4Y6`) and Marie Uhres. A separate 1880 image (`ark:/61903/3:1:3QS7-8971-YDV5`) shows "Nas" Uhres (born 1859, `6PBP-9LZV`) in the household of Jean Uhres (born 1821, `6PBP-QCDF`) and Barbe Kirsch — a completely different family. The 1885 census confirms the split: the tree person appears as a married head with wife Margretha Birgen and children Jean (born 1883) and Josephine (born 1885) (`ark:/61903/1:1:6PBR-163T`; image `ark:/61903/3:1:3QS7-8971-2481`), while the namesake appears single with Jean Uhres b. 1821 (`ark:/61903/1:1:6PBR-JWBD`; image `ark:/61903/3:1:3QS7-L971-27C5`).

**Birth year conflict — do not require 13 May 1858.** The tree person's birth year varies across census decades: 1856 in the 1861, 1875, and 1880 censuses (childhood, when his mother was likely the informant); 1858 in the 1885 and 1890 censuses (1890 entry `ark:/61903/1:1:659M-7Z13` gives the full date 13 May 1858, Keispelt); and 1857 in the 1900 census (`ark:/61903/1:1:6BD5-5ZXB`). This variation is typical in Luxembourg census reporting. The fixture accepts any answer placing the birth in the range 1856–1858 in Keispelt, or an answer that correctly notes the conflict among census entries. Only the Kehlen civil birth register can settle the exact date.

**Birthplace note.** Reviewer benter noted that at least one census entry can be read as "Meispelt" rather than "Keispelt" — likely a handwriting ambiguity. All indexed entries give Keispelt; the agent should accept Keispelt.

**Image reading check.** The household-grouping identification rested on reading original page-scan images. Check on 1880 image `3QS7-8971-YDYD`: Louis Uhres (indexed as `6PBP-Z4Y6`, b. 1863) — image matches index ✓. Marie Uhres (`6PBP-Z417`) — index gives 1850, image reads differently; reading not licensed for Marie's birth year. Marie's birth year is not relied upon in this finding; only the household grouping (consecutive rows under the same head) is used.

**Marriage act not found.** No indexed civil marriage record for Nicolas Uhres and Marguerite Birchen was found in FamilySearch's Luxembourg, Civil Registration, 1793–1979 collection, searched for Kehlen commune across 1880–1890 (the plausible window given Johann born 1883). The marriage may have been registered in a commune not yet fully indexed, or outside the indexed date range.
