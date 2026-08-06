# Mary E. Kavanaugh — additional son James (b. 1872, Cohasset)

**Source PID:** `G95C-GFP`
**Mary E. Kavanaugh is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1843, Manchester, England; died 10 December 1904, Whitman, Plymouth, Massachusetts.

## Research question

> Did Mary E. Kavanaugh and her husband Charles H. Williston of Cohasset, Massachusetts have a son born before their four known children (1877-1880), in addition to the four already in the tree?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G95C-GFP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**RESOLVED — true match (2026-07-27).** This fixture came from a hint batch (`filtered-list-samples.csv` row 2, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches. A genealogist reviewed both the tree person's existing sources and the hint record by hand on familysearch.org and confirmed the hint: the death entry in Massachusetts, State Vital Records, 1638-1927 for James A. Welliston (born 1872, died 1876, Cohasset, Massachusetts) explicitly names the child's mother as **Mary Kavanagh** — directly corroborating the parent-child relationship to Mary E. Kavanaugh (`G95C-GFP`), not merely a place/date coincidence. `expected-findings.json` is left unchanged from the transcribed hint.

Supporting reasoning: the tree already has a son **James B. Williston, b./d. 1880** — with this hint confirmed, the family named two sons James (a necronym pattern after an infant death, as in the committed `heinrich-dewus-children-death` fixture's 'Walter'). The place (Cohasset, Norfolk, Massachusetts) matches the tree family's residence and the birthplace of the 1880 twins exactly. The father/son surname is spelled **Williston** in the committed snapshot (`starting-tree.gedcomx.json`, captured 2026-07-24) but currently renders as **Willistone** on the live FamilySearch tree page as of this review (2026-07-27) — upstream drift since the snapshot, not a data error in this fixture. Both, along with the hint's **Welliston** and the tree's **Kavanaugh** vs. the hint's **Kavanagh**, are routine period/transcription variants of the same names, not discrepancies that weigh against the match.

**2026-08-03: added a resolvable ark (issue #970).** Neither this fixture's
committed run logs nor an `eval/e2e-project/` directory exist for
`mary-kavanaugh-son`, so — unlike the other fixtures fixed alongside this
one — there was no already-completed research artifact to pull the ark
from. Logged into FamilySearch and ran a live `record_search` for the
same record this fixture already cites (James A. Welliston, b. 1872,
d. 1876, Cohasset, Norfolk, Massachusetts, parents Charles H. Welliston
and Mary Kavanagh). It resolves to `ark:/61903/1:1:NWZ7-TFK` in the
"Massachusetts, State Vital Records, 1638-1927" collection — the same
collection and identical parent/child names/dates the fixture already
described, confirming this is the same record already cited by name, not
a new record substituted in. (A duplicate indexing of the identical
record also exists at `ark:/61903/1:1:NWL6-TLG`; a related record for the
same death in "Massachusetts, Town Clerk, Vital and Town Records,
1626-2001" — "James Alexander Williston," 2 May 1876 — exists at
`ark:/61903/1:1:FHZ7-CLQ` and independently corroborates the same event.)
