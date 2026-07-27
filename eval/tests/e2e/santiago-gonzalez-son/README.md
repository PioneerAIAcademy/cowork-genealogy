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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 15, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Ecuador, Cemetery Records, 1862-2020: burial entry for Manuel de Jesus Gonzalez Tumbaco (b. 1915, d. 5 Dec 1985, Ecuador), naming parents Santiago Gonzalez and Petita Tumbaco. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Manuel de Jesus Gonzalez Tumbaco as the subject's son, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the mother's name is recorded as "Petita Tumbaco" in the hint vs. "Petra Tumbaco" in the tree — a plausible diminutive/nickname variant ("Petita" from "Petra"), and the surname "Tumbaco" and father's given name "Santiago Gonzalez" both match exactly. A birth in 1915 predates the tree's two known daughters (1921, 1934), making Manuel the presumed eldest child — plausible but with no independent tree evidence (no marriage date, no other pre-1921 records) to corroborate the couple already having children by 1915.
