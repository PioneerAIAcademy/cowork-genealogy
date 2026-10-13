# Sarah Maud Henderson — death in March 1928, Toronto, Canada

**Source PID:** `GF6Z-JC8`
**Sarah Maud Henderson is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1885 in Ontario; the tree carries an undated Death fact. Married George Coleman on 11 October 1906 in Toronto; living in Toronto in 1911 with him and their children William (born December 1907) and Margaret Maud (born 30 September 1909).

## Research question

> When and where did Sarah Maud Henderson die? Born about 1885 in Ontario, she married George Coleman in Toronto on 11 October 1906 and was living in Toronto with him and their children William and Margaret Maud in 1911.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GF6Z-JC8` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-3.csv` row 5, `hint-samples.csv` row 162,
flags `adds_death,adds_burial`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "BillionGraves Index", a grave entry for Sarah Maude Henderson Coleman, born 15 February 1886, died 21 March 1928, buried in Toronto; the index gives no cemetery name and no death place, and links to a BillionGraves page rather than a FamilySearch image.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the March 1928 death, plus a `required` finding that the report documents
the rejection.

A good candidate. The index carries both her maiden and married surnames, "Henderson Coleman", with the given names Sarah Maude, and the tree's own sources call her both Sarah Maud Henderson (the 1906 Toronto marriage) and Maude Henderson (mother on her son William's 1907 birth, `ark:/61903/1:1:QV9H-D6WC`). The 15 February 1886 birth sits a year off the tree's 1885, which most likely comes from an age on the 1911 census or the marriage, and the Toronto burial fits a family the tree has in Toronto in 1911 and 1931. The tree has George, William and Margaret in a 1931 Toronto census household and cites no 1931 entry for Sarah, which a 1928 death would explain, but those 1931 entries are indexed with no names, so that is not proof she was absent. No tree source is a death or burial record, so nothing here is a re-index of this entry.

What is thin is that a grave index is a derivative of a headstone, and this entry names no husband or parents, so the tie to George Coleman rests on the combination of surnames, given names and city. The check that would settle it is the Ontario civil death registration for 21 March 1928: it would name her husband and give her age and birthplace, and a husband George Coleman would confirm this as the tree's Sarah.
