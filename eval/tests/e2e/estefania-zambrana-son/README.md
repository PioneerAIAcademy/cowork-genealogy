# Estefania Zambrana — additional son Ricardo (b. 1874)

**Source PID:** `9QTV-KDZ`
**Estefania Zambrana is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Estefania Zambrana and her husband Antonio Beisaga of Cochabamba, Bolivia have a son named Ricardo, baptized 1874, in addition to their two known children (b. 1867 and 1877)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9QTV-KDZ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — a false-match adjudication (the answer is that the hint is wrong);
see "Notes for reviewers" below for the evidence that decided it.

## Notes for reviewers

**Resolved (issue #857): FALSE MATCH — insufficient evidence; the hint does not meet the Genealogical Proof Standard.** The hint — Bolivia, Catholic Church Records, 1566-2020: baptism of Ricardo, 3 April 1874, Santo Domingo, Cochabamba, naming parents "Antonio Veizaga" and "Estefania Zambrana" — should **not** be attached to the tree couple Estefania Zambrana (`9QTV-KDZ`) and Antonio Beisaga (`9QTV-KD3`).

What decided it:
- **The only record naming Ricardo is this one baptism.** It establishes only that a child named Ricardo was baptized to parents *named* Antonio Veizaga and Estefania Zambrana — not that those parents are the couple in the tree.
- **No corroborating marriage.** A marriage of this Antonio and Estefania could not be located. The closest Cochabamba marriage found — 22 October 1877, Narsiso Zurita & Antonina Beisaga, Tarata — is an unrelated couple and provides no support.
- **The 1877 Geronimo baptism does not help.** The tree's known son Geronimo's baptism neither mentions Ricardo nor identifies the 1874 baptism's family, so it cannot link Ricardo to the tree couple.
- **Surname variation alone is not proof.** Beisaga/Beizaga/Veizaga are plausibly the same surname (betacismo, Z/S interchange — common in Bolivian records), but orthographic variation by itself does not establish identity; the GPS requires independent corroborating evidence tying the records to the same individuals.

**Rebuttal of the automated true-match reading (pre-empting a re-run).** A Cowork agent reached a *probable true match* by treating the surnames as scribal variants and citing an **1870 marriage** of Antonio and Estefania as corroboration. On review that marriage **could not be found** — so the corroboration does not stand, and the case reduces to a single uncorroborated baptism, which does not meet the GPS. Accordingly `expected-findings.json` is a `polarity: "avoid"` guard (the agent must not attach the 1874 Ricardo to this couple) paired with a `required` documented-negative-conclusion finding.
