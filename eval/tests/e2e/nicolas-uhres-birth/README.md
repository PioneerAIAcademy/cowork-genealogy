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

**TRUE MATCH.** Adjudicated 2026-10-14. The 1880 Kehlen census entry (`ark:/61903/1:1:6PBG-1Q63`) for Nicolas Uhres, single, born 1856 in Keispelt, is the correct tree person GYGJ-D1C.

The discriminating evidence is the 1900 Kehlen census (`ark:/61903/1:1:6BD5-5ZXB`), which shows a household headed by Nicolas Uhres (married, born ~1857, Keispelt) with wife Margreth Birgen (born ~1857, Keispelt) and children Jean (born 1883, Keispelt) and Josephine (born 1885, Keispelt). Jean and Josephine match the tree's Johann (5 December 1883, Keispelt) and Josephine (23 July 1885, Keispelt) exactly — same names, same birth years, same birthplace. Marguerite Birchen/Birgen is the wife the tree names. This household cannot be a coincidence or a different Nicolas Uhres.

The 1885 Kehlen census (`ark:/61903/1:1:6PBR-163T`) corroborates: Nicolas Uhres, married, born 1858, Keispelt, Kehlen — consistent with the 1880 single entry. The birth year across records oscillates between 1856 and 1858, a common variation in Luxembourg census reporting.

No indexed civil marriage record for Nicolas Uhres and Marguerite Birchen was found in FamilySearch Luxembourg collections (collection 5000012, the Kehlen civil register is 100% indexed). The 1900 household evidence makes this unnecessary: the children's identities alone settle the question. The Kehlen civil register was searched in both directions (groom and bride) with no result; the marriage may have been registered outside the indexed window or in a commune not yet fully indexed.
