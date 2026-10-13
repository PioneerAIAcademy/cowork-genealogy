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

**Resolved 2026-10-13 (issue #3328): the hint is a true match.** Adjudicated by Ikennaya1. The hint record (`ark:/61903/1:1:QV1B-V142`, "BillionGraves Index") gives Sarah Maude Henderson Coleman, born 15 February 1886, died 21 March 1928, buried in Toronto. A grave index alone names no husband or parents, so the call rests on two original registrations found by independent search:

- **Ontario civil death registration** (`ark:/61903/1:1:JKW2-LBP`, "Canada, Ontario, Deaths, 1869-1937 and Overseas Deaths, 1939-1947"): Maude Coleman, married, died 21 March 1928 in York County, Ontario, born 1886, father **Alexander Henderson**, mother **Margaret Draper**. These are the parents the tree's own source for this woman, her 11 October 1906 Toronto marriage to George Alfred Coleman (`ark:/61903/1:1:KZ17-BGL`), gives the bride Sarah Maud Henderson ("Alex Henderson" and "Margaret Draper"). Maiden name, married name, both parents and the death date agree, so this is the deciding record.
- **Toronto Trust Cemeteries register** (`ark:/61903/1:1:276Q-ZXZ`): Maud Coleman, died 21 March 1928 in Toronto, buried 23 March 1928 in Toronto, born 1886, with a George Coleman named on the entry. It ties the death to her husband and supplies the burial date the hint lacks. A Find a Grave entry (`ark:/61903/1:1:QVLG-DM11`) repeats the hint's data.

The place agrees across records: the civil registration names the county (York) and the cemetery register the city (Toronto), which lies in York County. The hint is not a re-index of an existing source: none of the 17 record arks already in the tree is a death or burial record. The 1886 birth year against the tree's 1885 is the usual one-year spread between a census or marriage age and a death record.

**Retrieval** was tool-assisted (`record_read`, `record_search` through the engine, in Claude Code); the identity judgement is the genealogist's. The FamilySearch indexes settled it: no page image was read, so no image-reading calibration applies and `image_basis` is not set.
