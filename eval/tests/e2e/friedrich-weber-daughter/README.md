# Friedrich Carl Weber — daughter Anna Maria Eva (b. 1870)

**Source PID:** `GTDL-981`
**Friedrich Carl Weber is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1846; died not recorded in the tree.

## Research question

> Did Friedrich Carl Weber and his wife Catharina Carell of Sindlingen, Hesse-Nassau have a daughter named Anna Maria Eva, born 1870?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GTDL-981` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-11 — true match, with one correction.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 14, flag `adds_daughter`, confidence 3) in which roughly half the hint records are false matches. This one is genuine: the tree's marriage date for Friedrich Carl Weber and Catharina Carell is 7 February 1869 in Sindlingen, Kreis Höchst — the same parish/district as the hint record's Höchst baptism. "Karl" is a routine short form of "Friedrich Carl", and "Karell"/"Carell" is an exact-sound surname match for the mother.

Every ark cited was opened directly via `record_read` and confirmed to describe the person the citation claims (per issue #864's fabricated-ground-truth caution — issues #855/#1346). Two independent entries in the same parish-register collection (`ark:/61903/1:1:D43D-J23Z` and `ark:/61903/1:1:D43H-7DN2`) both name Anna Maria Eva Weber, born 26 February 1870, to parents Karl Weber and Katharina Karell — the same collection, same parents, same birth date, one carrying a baptism date of 13 March 1870.

**Correction:** the original transcription called her "the couple's first known child." That is false. `run-2026-07-29_18-25-29.ann.json`'s annotation flagged that the agent's own research had already surfaced an earlier daughter, Rosina Weber, baptized 3 May 1869 in Nied — about nine months before Anna Maria Eva and roughly three months after the couple's marriage. Verified directly (`ark:/61903/1:1:D4WC-V9PZ`): parents Carl Friedrich Weber and Catharina Karel, the same couple. Rosina is cited in `expected-findings.json`'s `supporting_sources` as evidence for the correction, per issue #864's instruction — not added as a second finding, since the fixture's question is only about Anna Maria Eva.

Two things worth a reviewer's attention, neither a problem with the identification:

- **Premarital conception.** The couple married 7 February 1869; Rosina was born 3 May 1869 — about 85 days later. Conception preceded the marriage by roughly six months. Common and unremarkable in a 19th-century rural Catholic parish (often the reason for the marriage's timing), not evidence against the parentage.
- **No source names the two children as siblings.** Each is attested only by her own independent baptismal entry — no document lists Anna Maria Eva and Rosina together. The sibling relationship is inferred by correlating the same parents' names (Karl/Carl Friedrich Weber + Katharina/Catharina Karell/Karel, spelling and given-name-order variants) across the two separate entries, exactly as the agent's own `ps_001` proof summary frames it ("a genuinely independent evidence unit... presented by different informants on a different day"). Standard GPS indirect-evidence correlation, not a direct documentary link.
