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

**DIFFERENT ANSWER — the hint record is the wrong person.** Re-adjudicated 2026-10-14 based on reviewer finding (florencemashipei). The 1880 Kehlen census entry (`ark:/61903/1:1:6PBG-1Q63`) for Nicolas Uhres, single, born 1856, does NOT belong to tree person GYGJ-D1C. It belongs to a distinct second man of the same name living in the same commune.

**Evidence of two men named Nicolas Uhres in Kehlen.** The 1885 Kehlen census contains two simultaneous separate entries: a married Nicolas Uhres born 1858 (`ark:/61903/1:1:6PBR-163T`) and a single Nicolas Uhres born 1859 in Keispelt (`ark:/61903/1:1:6PBR-JWBD`). These are plainly different people — different marital status, different birth years — proving the two men co-existed. Earlier censuses (1861, 1875) likewise carry two entries for Nicolas Uhres, one born 1856 and one born 1858.

**The tree person is the one born 1858.** The 1890 Kehlen census (`ark:/61903/1:1:659M-7Z13`) gives the decisive record: Nicolas Uhres, married, born **13 May 1858** in Keispelt. The 1900 Kehlen census (`ark:/61903/1:1:6BD5-5ZXB`) confirms identity — same Nicolas, with wife Margreth Birgen/Birchen and children Jean (1883, Keispelt) and Josephine (1885, Keispelt) — matching the tree's Johann and Josephine exactly. The 1900 household proves who the tree person is; it does not establish that the 1880 single-man born 1856 is him.

**The hint record (6PBG-1Q63) belongs to the 1856 man.** He appears in the 1861, 1875, and 1880 censuses as born 1856; the 1885 and later censuses show him as a single man (born 1859 in the 1885 entry — birth year variance is common in Luxembourg census reporting). The correct tree person is the married 1858 man throughout.

**Correct birth:** 13 May 1858 in Keispelt, Luxembourg, from the 1890 Kehlen census.

No indexed civil marriage record for Nicolas Uhres and Marguerite Birchen was found in FamilySearch Luxembourg collections. The 1900 household evidence makes this unnecessary. The marriage may have been registered outside the indexed window or in a commune not yet fully indexed.
