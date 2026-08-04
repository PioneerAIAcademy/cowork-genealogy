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
tied to William's own death entry. No surname-spelling problem beyond
the ordinary variants already visible in the source titles ("Bagley"
vs "Willaim A. Bagley"), no FAN research needed. **Correction (see
"First live run" below): this originally said "no competing
candidates" — that was wrong.** Topsham has a contemporary "David
Bagley Jr." the authoring pass never surfaced; recovering the father's
*name* is easy, but pinning that name to a specific, identity-scored
individual (distinct from the Jr.) is not as trivial as the original
authoring made it look.

## Notes for reviewers

Authored to exercise the GPS guardrail-enforcement changes
(`docs/specs/guardrail-enforcement-spec.md`) end to end against a
real, cheap `/research` run — not as a benchmark stress case. The
authoring source data had two data-quality issues fixed by hand in
`unstripped-tree.gedcomx.json` before `strip`/`validate` would accept
it: two duplicate fact ids shared between William's wife Ann Tillotson
and William himself (`ebe0d4fe-...`/`ddb21ddf-...`, renamed with a
`-KHY4` suffix on Ann's copies) and an invalid lowercase `"cemetery"`
fact type on David Bagley (removed — it duplicated information already
present on his `Burial` fact).

## First live run (2026-07-27)

`run-2026-07-27_20-01-40` — judge scored **pass** (proof_quality 3/3),
but the blind annotation (`run-2026-07-27_20-01-40.ann.json`)
downgrades it to **partial**: David Bagley is correctly added as a new
person with a `ParentChild` link to William, sourced to the 1884
death entry, but the person is not pinned to an identity — no birth
fact (expected 22 Feb 1777, Newton, Rockingham, NH), no death fact —
and the agent's own narrative surfaces a co-resident **"David Bagley
Jr."** in Topsham that the tree as written does not distinguish from
the father. This is a real confounder on FamilySearch that the
original authoring pass (this README's "no competing candidates"
line) missed — recovering the *name* "David Bagley" is genuinely easy;
confirming *which* David Bagley, with a pinned birth/death and an
explicit ruling-out of the Jr., is not, and this fixture's expected
findings don't currently require it.

Separately, the same run is the source example in
`docs/specs/guardrail-enforcement-spec.md` §3 and GitHub issues
[#911](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/911)
and
[#913](https://github.com/PioneerAIAcademy/cowork-genealogy/issues/913):
the father was linked across 13 `person_evidence` entries entirely
inline (never through `person-evidence`), with `same_person` called
zero times in the whole run. That bug and this identity-pinning gap
are independent findings from the same run, not the same issue — fixing
the orchestration bypass does not by itself fix the Jr./Sr. confusion,
which is a separate, ordinary research-quality gap.

Not yet decided: whether to add a required finding for the birth/death
facts and the Jr. disambiguation (raising this fixture's real
difficulty above "easy"), or leave it as encountered and accept
"partial" as this fixture's realistic ceiling until person-evidence's
identity-scoring gap (the orchestration bug) is fixed. Revisit once a
run exists that goes through `same_person` properly for this record.
