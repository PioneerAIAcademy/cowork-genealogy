# Sebastiano Mingazzini — additional son Simone (b. 1860)

**Source PID:** `GQSW-B3V`
**Sebastiano Mingazzini is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1826, Castel Bolognese, Ravenna, Italy; died not recorded in the tree.

## Research question

> Did Sebastiano Mingazzini and his wife Lucia Silvestrini of Castel Bolognese, Ravenna, Italy have a son named Simone, born 1860, in addition to their three known children (b. 1849-1853)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GQSW-B3V` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 22, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Italy, Ravenna, Ravenna, Civil Registration (Tribunale), 1866-1943: record for Simone Mingazzini (b. 1860 Faenza, d. 4 Jan 1933 Solarolo), naming parents Sebastiano and Lucia Silvestri. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Simone Mingazzini as the subject's son, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the mother's surname is recorded as "Silvestri" in the hint vs. "Silvestrini" in the tree — a routine Italian surname-suffix variant. The father's given name "Sebastiano" matches exactly, the region (Ravenna, Emilia-Romagna) matches, and a birth in 1860 fits neatly after the tree's three known children (1849, 1852, 1853) as a later child, though the birthplace shifts from Castel Bolognese (the other children) to nearby Faenza — a plausible short-distance move within the same district, but a difference worth noting.
