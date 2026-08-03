# Santiago Gonzalez — additional son Manuel (b. 1915)

**Source PID:** `G6MR-VHF`
**Santiago Gonzalez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Santiago Gonzalez and his wife Petra Tumbaco of Guayaquil, Ecuador have a son named Manuel de Jesus, born 1915, in addition to their two known daughters (b. 1921 and 1934)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G6MR-VHF` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: true match.** Manuel de Jesus Gonzalez Tumbaco is confirmed as a son of
Santiago Gonzalez and Petra Tumbaco, in addition to the two daughters already in the
tree (Maria Angela b. 1921, Maria Bartola b. 1934). `expected-findings.json` is
unchanged from the original hint transcription.

The call rests on the exact matches in the hint record combined with a plausible
explanation for its one apparent discrepancy: the surname "Tumbaco" and the father's
given name "Santiago Gonzalez" both match the tree exactly, and the mother's name —
recorded as "Petita Tumbaco" in the hint versus "Petra Tumbaco" in the tree — is a
plausible diminutive/nickname variant ("Petita" from "Petra"), not a contradiction. A
1915 birth predates the tree's two known daughters (1921, 1934), making Manuel the
presumed eldest child; there is no independent tree evidence (no marriage date, no
other pre-1921 record) that contradicts the couple already having a child by 1915,
and none was found to contradict this identification.
