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

**Resolved (issue #857): FALSE MATCH — the 1874 Ricardo hint is not proven to belong to this couple.** The hint — Bolivia, Catholic Church Records, 1566-2020: baptism of Ricardo, 3 April 1874, Santo Domingo, Cochabamba, naming parents "Antonio Veizaga" and "Estefania Zambrana" — should **not** be attached to the tree couple Estefania Zambrana (`9QTV-KDZ`) and Antonio Beisaga (`9QTV-KD3`) without a record that positively ties it to them.

What decided it:
- **The couple is real and well-documented.** An 1870 marriage exists (23 March 1870, San José, Cochabamba; ark `QL7X-YN65`; Antonio Beizaga b. 1845 × Estefania Zambrana b. 1848), and the couple had children across 1867–1878: Fructuosa (1867), Luis (1871), Tomaza (1875), Geronimo (1877), Maria de la o (1878). The surname is recorded variantly as Beisaga/Beizaga (betacismo), confirmed by the marriage register itself.
- **But none of their documented children is a Ricardo.** A broad indexed child search (Beisaga and Beizaga spellings) for 1865–1880 returns the five children above and no Ricardo. The only "Ricardo Beisaga" locatable is himself a *father* in a 1908 Sicaya baptism (ark `QGJC-FX3Y`) whose own parents are not named — no link to Antonio + Estefania.
- **A parent-name match alone is not proof.** The 1874 Santo Domingo baptism names parents "Antonio Veizaga" and "Estefania Zambrana," which matches — but with the couple's actual children fully accounted for and none a Ricardo, and no record positively tying the 1874 baptism to them, the additional son is not established.

**Correction to an earlier draft of this note:** a prior version claimed no marriage could be found and rested the verdict on that. That was wrong — the 1870 marriage exists (`QL7X-YN65`). The verdict stands on the corrected basis above: the couple is documented, but the specific 1874 Ricardo is not proven to be their child.

**Residual caveat (for re-derivation).** The hint spells the father "Veizaga" (V); the negative child search covered the "Beisaga"/"Beizaga" (B) spellings, so the absence of Ricardo is strong but not exhaustive of every spelling. The verdict is therefore "not proven → do not attach," not a positive disproof; attaching Ricardo would require reading the 1874 baptism (ark `QPCP-VQHZ`) and positively tying it to this documented couple. Accordingly `expected-findings.json` is a `polarity: "avoid"` guard (do not attach the 1874 Ricardo without a positive tie) paired with a `required` documented-negative-conclusion finding.
