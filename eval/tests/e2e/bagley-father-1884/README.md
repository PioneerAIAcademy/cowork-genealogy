# Find the father of William A. Bagley (Topsham, VT, 1815-1884)

**Source PID:** `MJDL-Q8B`
**William A. Bagley is deceased.** (b. abt 1815, West Topsham, Orange
County, Vermont; d. 31 May 1884, Topsham, Orange County, Vermont.)
FamilySearch ToS requires all committed e2e fixtures to be about
deceased persons. His father David Bagley (b. 1777, d. 1854) and
mother Sarah "Sally" Andrews (b. 1777, d. 1847) are also long
deceased, as is his wife Ann Tillotson (b. 1826, d. 1876).

## Research question

> Who was the father of William A. Bagley, born about 1815 and died
> 31 May 1884 in Topsham, Orange County, Vermont?

## Expected answer

- **Father:** David Bagley — b. 22 February 1777, Newton, Rockingham
  County, New Hampshire; d. 5 October 1854, West Topsham, Orange
  County, Vermont.

David Bagley is named directly as father on William's own entry in
*Vermont, Town Clerk, Vital and Town Records, 1732-2005*, recorded at
William's death, 31 May 1884, Topsham. This is a single-record answer
— no cross-record reasoning or FAN research is required, which is a
deliberate authoring choice (see Notes).

## What was removed from the starting tree

- Removed person LVDV-DBC: David Bagley
- Removed relationship R2 (Couple LVDV-DBC/LVDV-6MK): cascaded from a removed person
- Removed relationship R3 (ParentChild LVDV-DBC/MJDL-Q8B): cascaded from a removed person
- Removed source 92ND-NS5: Willaim A. Bagley, "Vermont Vital Records, 1760-1954"
- Removed source SCYG-11X: William A Bagley, "Vermont, Town Clerk, Vital and Town Records, 1732-2005"
- Removed source SCYG-1X5: William A Bagley, "Vermont, Town Clerk, Vital and Town Records, 1732-2005"

William's mother, Sarah "Sally" Andrews, is deliberately **left in the
starting tree** (only the father was stripped). She has no
independently attested source connecting her to William as his
mother in this snapshot, so a "who were the parents" (both) question
would reproduce the same unrecoverable-mother problem seen in other
fixtures (e.g. `john-richardson-parents`) — not what this fixture is
for. Scoping the question to the father alone keeps this fixture
cheap and its answer unambiguous.

## Expected difficulty

easy — the father's name is stated directly on a single vital record
tied to William's own death entry. No competing candidates, no
surname-spelling problem beyond the ordinary variants already visible
in the source titles ("Bagley" vs "Willaim A. Bagley"), no FAN
research needed.

## Notes for reviewers

Authored to exercise the changes in
`docs/plan/research-guardrail-bypass-plan.md` end to end against a
real, cheap `/research` run — not as a benchmark stress case. The
authoring source data had two data-quality issues fixed by hand in
`unstripped-tree.gedcomx.json` before `strip`/`validate` would accept
it: two duplicate fact ids shared between William's wife Ann Tillotson
and William himself (`ebe0d4fe-...`/`ddb21ddf-...`, renamed with a
`-KHY4` suffix on Ann's copies) and an invalid lowercase `"cemetery"`
fact type on David Bagley (removed — it duplicated information already
present on his `Burial` fact).
