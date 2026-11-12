# William Mc Allister — son Thomas John McFerran (b. 1879, Downpatrick)

**Source PID:** `LZDC-MJN`
**William Mc Allister is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1844 in Scotland; death not recorded in the tree.

## Research question

> Did William Mc Allister and Mary Jane Magee have a son, Thomas John McFerran, born 4 June 1879 at Downpatrick, County Down?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LZDC-MJN` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-23: false match — outcome (c), avoid guard.** The hint
(`ark:/61903/1:1:QPKB-8F6F`, "Ireland, Civil Registration, 1845-1913": Thomas
John McFerran, born 4 June 1879, Downpatrick, County Down, parents William
McFerran and Mary Jane Magee McFeran) does not belong to William Mc Allister
(`LZDC-MJN`). `expected-findings.json` now carries an `avoid` finding (f1)
against adding this child to him, paired with a `required` finding (f2) that
the report documents why, from records.

**What decided it.** The same birth is indexed a second time from the church
register — `ark:/61903/1:1:FRQS-TZ1`, "Ireland, Births and Baptisms, 1620-1881":
Thomas John McFenan, born 4 June 1879, Quarterland, Down, father William
McFenan, mother Mary Jane McFenan Magee. That record is already attached in the
FamilySearch tree to a different man, **William McFerran (`GQ96-96N`)** —
christened Killinchy, County Down, 1831; married Ballygowan 1862; died 7 April
1913 — whose tree already lists this child as Thomas John McFerran
(`GQ96-J1C`). FamilySearch's own "Possible Tree Match" on the hint also points
to `GQ96-96N`, not `LZDC-MJN`. William Mc Allister is recorded as born about
1844 in Scotland, with children born in County Antrim and Scotland; the two
men are different people. The birth is therefore already accounted for in
someone else's family.

**The re-index question from the draft.** The attached "William McFerran in
entry for Thomas John McFerran" source on `LZDC-MJN` (`ark:/61903/1:1:FRQY-WQD`)
is **not** the 1879 birth: it is a separate event, 7 December 1864, Kilmood,
County Down. The draft's re-index hypothesis was wrong.

**What was searched and came up empty.** Ireland, Civil Registration Indexes,
1845-1958, McFerran births in County Down, 1875-1881: the only hit was the hint
itself, and no independent record ties William Mc Allister to a son born in
County Down in 1879.

**Left open, deliberately.** `LZDC-MJN` is a heavily merged profile — four
alternate names (William McFerran, William Mc Ferran, William Mc Callion,
William McGillivray) and three duplicate Mary Jane Magee spouses (`K8SF-V85`,
`LZDC-MTY`, `9DP7-MHK`) flagged by FamilySearch. Six of its ten attached
baptism sources name the child McFerran/Mc Ferran, and both the 1864 Kilmood
entry and the spouse's 1903 death at Killinchy are County Down, the same
district as `GQ96-96N`. Some of the McFerran material on `LZDC-MJN` may belong
to `GQ96-96N`; that is not adjudicated here and does not change the verdict.
The starting tree is left as captured (record-hint fixtures never edit it).

**How f1 is enforced — read before grading.** The judge grades f1 on meaning,
and `apply_avoid_guard` (`eval/harness/e2e/avoid_guard.py`) re-checks two things
the final tree can show. It fails f1 when a tree object cites one of the 1879
child's records (`wrong_candidate.records`, the `FRQS-T…` and `QPKB-8F6…`
personas), in any role. And it fails f1 on a new parent-child edge, absent from
the starting tree, that makes a person named Thomas John McFerran (or Ferran,
McFenan) a non-Step child of `LZDC-MJN`. A run that adds the 1864 Kilmood Thomas
John (`FRQY-WQD`) without attaching him to `LZDC-MJN`, or brings `GQ96-96N`'s son
(`GQ96-J1C`) in under his own father, trips neither check unless it cites the
1879 records. Never name the mother in the candidate: Mary Jane Magee is already
three spouse persons in the starting tree.

**Retrieval and review.** Retrieval was done by hand on familysearch.org. The
identity judgement was the genealogists': John identified `FRQS-TZ1` as the same
birth event and its attachment to `GQ96-96N`; senior genealogist Richard
Chestworth confirmed that `LZDC-MJN` and `GQ96-96N` are different people and
that the hint is not a valid match for `LZDC-MJN`. The run and grade for this
fixture are still owed (issue #2312).
