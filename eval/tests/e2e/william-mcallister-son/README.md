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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 19, `hint-samples.csv` row 602,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Ireland, Civil Registration, 1845-1913", a birth entry of 4 June 1879 at Downpatrick, County Down for Thomas John McFerran, naming parents William McFerran and Mary Jane Magee McFeran.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Thomas John McFerran as his son, plus a `required` finding that the report documents
the rejection.

Check first whether this is a re-index of something already attached. Among the tree's ten sources is "William McFerran in entry for **Thomas John McFerran**, Ireland, Births and Baptisms, 1620-1881" — apparently the same 1879 birth, indexed from the church register rather than the civil registration. If so, the hint adds a citation and not a person, and the right outcome may be (b) rather than (a).

Beyond that, the fixture is really about the surname mess, which is why it is worth running. This one man appears across his own children's records as **McAllister**, **McCallion** and **McFerran**, with the tree recording him as William Mc Allister, born about 1844 in Scotland, and giving his children the surnames Mc Callion (three, born Antrim 1869-1873) and Mc Allister (one, born Scotland 1870). The mother is entered three separate times as Mary Jane Magee (K8SF-V85, LZDC-MTY, 9DP7-MHK), with three duplicate couple relationships to match — one of the three carrying a full life (b. 1844 Balbriggan, emigrated 1865, d. 1903 Killinchy, Co. Down) and the other two empty.

So the reviewer has two questions, and they are separable: is the 1879 Downpatrick birth this family's (the move from Antrim to Down between 1873 and 1879 is the thing to establish), and does the tree's own duplication have to be resolved before the answer means anything.
