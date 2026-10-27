# James F. Gleason — the 1893 Boston "wife Norah / son Robert" hint is a false match

**Source PID:** `L4ZG-21Q`
**James F. Gleason is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1 March 1865 in Boston, son of John Gleason and Delia A. Fitzgerald; died in Boston on 13 August 1896. The tree records no spouse and no children for him. His parents' other children are Francis J. (1867–1891), John A. (1869–1885), Emma Letitia (b. 1871), and four born in Lowell between 1886 and 1893.

## Research question

> Did James F. Gleason, born 1 March 1865 in Boston, son of John Gleason and Delia A. Fitzgerald, who died in Boston on 13 August 1896, marry and have children?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L4ZG-21Q` with relatives). Nothing was
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

**Resolved: FALSE MATCH** (adjudicated 2026-10-23; index-based). Retrieval was
tool-assisted (MCP `record_read` / `record_search` against live FamilySearch);
the identity judgement is the genealogist's. The hinted record —
"Massachusetts, Town Clerk, Vital and Town Records, 1626-2001", a Boston birth
register entry for Robert F. Gleason, born 20 May 1893, naming his parents as
James F. Gleason and Norah (`ark:/61903/1:1:F4NM-W8P`) — is **not** established
as recording a spouse or child of the subject.

**The father persona carries nothing identifying.** In the hint record the
father "James F. Gleason" (`ark:/61903/1:1:F4NM-W8P`) is indexed with **no age,
no birthplace, no parents, and no occupation** — only the name. Nothing in the
record ties him to the subject beyond the shared name "James F. Gleason", Boston,
and the era. On name, place and date the hint fits (same given name and middle
initial, Boston, and the subject would have been 28), but that is the whole of
the fit.

**The disproving record (index only).** The subject's own death record, already
a tree source ("Massachusetts, State Vital Records, 1638-1927", James F. Gleason,
13 Aug 1896; `ark:/61903/1:1:NWCJ-F72`), indexes his **marital status as Single**,
his occupation as clerk, and names his parents as **John Gleason and Delia A.
Fitzgerald** — matching the subject exactly. A man indexed single at his 1896
death is not the married father in an 1893 birth entry. This rests on the
**index**: the 1896 death-register **image was not examined** (`image_basis:
false`), so "Single" is an indexed value, not a reading of the original return.

**A plausible — but unproven — alternative family.** A collection search for a
Gleason groom and a bride Norah/Nora in Massachusetts, c. 1888–1893, surfaced a
**different** James Gleason: **James Frank Gleason**, b. ~1870 Brooklyn, New York,
son of **John Gleason and Anne McNamara** (not Delia Fitzgerald), who married
**Nora Teresa Carey** on 1 Jun 1892 in Newton, Middlesex, Massachusetts
(`ark:/61903/1:1:N47V-Z57`); and a 1900 US census household of a New-York-born
James F. Gleason with a wife Norah/Morah and an Elizabeth **Carey** in the
household, Brookline, Norfolk, Massachusetts (`ark:/61903/1:1:M9TJ-BLT`). These
show that "James F. Gleason + Norah" in 1890s greater Boston was a real family
belonging to **someone other than the subject**. They do **not** establish that
the 1893 Robert F. Gleason was that couple's child — Robert does not appear in
the 1900 household, and the two James records disagree on birth year (1860 vs
1870) — so **Robert's actual parentage was not established**. The point is only
that a distinct James-and-Norah Gleason family exists; the identification of
Robert's father is left open.

**Net.** The hint is a false match: the subject is indexed single at death with
parents John and Delia Fitzgerald, the 1893 father persona carries no facts
linking him to the subject, and no record establishes that the subject married or
had any children. The fixture therefore tests that the agent declines the hint
and documents the negative conclusion rather than attaching Norah as a wife or
Robert as a son. The CSV tags this row "British Colonial America"; the record and
every tree event are in Boston, so the fixture is tagged `US-MA`.

**Second opinion (Isaac Boateng).** A second genealogist, Isaac Boateng,
independently reviewed the case and concurs with the false-match conclusion:
James F. Gleason (`L4ZG-21Q`) probably died unmarried and childless — his 1896
death record identifies him as single and matches his parents and birthplace —
and the Robert F. Gleason birth hint belongs to a **different** James F. Gleason,
the one who married Nora Carey (Isaac notes that this other James was still
living in 1910, outliving the Boston subject who died in 1896). This is a
concurring genealogist's *assessment*, distinct from the record evidence set out
above: the documentary basis for rejecting the hint remains the subject's 1896
death record (`ark:/61903/1:1:NWCJ-F72`) and the distinct 1892 marriage and
1900-census family (`ark:/61903/1:1:N47V-Z57`, `ark:/61903/1:1:M9TJ-BLT`) — the
"living in 1910" point is Isaac's own, not a record retrieved for this fixture.
His opinion supports rejecting the hint as a match to the subject but, like the
record evidence, does **not** conclusively establish Robert's parentage.
