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

**Resolved: true match.** The genealogist confirmed the hint as transcribed after reviewing both the tree person and the hint record on familysearch.org.

The tree person (GQSW-B3V) already carries one attached source: a death record for his daughter Francesca (d. 1938), from "Italia, Ravenna, Ravenna, Stato Civile (Tribunale), 1866-1943." Simone Mingazzini's death entry (d. 4 Jan 1933, Solarolo) comes from that same civil-registration collection and jurisdiction — this family is already documented in this exact archive, so the hint isn't introducing an unfamiliar source, just another entry from an office that has already proven reliable for them.

The father's given name, "Sebastiano," matches exactly. The mother's surname is recorded as "Silvestri" in the hint versus "Silvestrini" in the tree — a routine Italian surname-suffix variant, not a contradiction; the "-ini" ending is commonly dropped or added depending on the clerk or informant.

Geography is consistent rather than identical: the three known children were born in Castel Bolognese, while Simone's death record gives his birthplace as Faenza. Both are neighboring towns within the same Ravenna civil district, and a short-distance move across an 11-year gap between births is unremarkable.

Chronology fits without strain: the known children were born in 1849, 1852, and 1853; a fourth child in 1860 extends the pattern by a plausible seven years, and the mother (b. abt. 1830) would have been about 30 — biologically unremarkable.

No point of actual contradiction turned up: no name that's flatly wrong, no place that's implausible, no date that breaks the timeline. Combined with the shared source collection, the evidence supports keeping the hint as transcribed.
