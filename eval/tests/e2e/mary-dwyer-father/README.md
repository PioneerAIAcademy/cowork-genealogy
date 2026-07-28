# Mary Dwyer — father Patrick Dwyer

**Source PID:** `MNFL-T24`
**Mary Dwyer is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
May 1840, Ireland; died not recorded in the tree (immigrated 1856; last residence 1900, South Windsor, Connecticut).

## Research question

> Who was the father of Mary Dwyer, wife of Michael Dwyer of South Windsor, Connecticut?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `MNFL-T24` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 3, flag `adds_father`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Massachusetts, State Vital Records, 1638-1927: marriage entry, 21 April 1854, Chicopee, Hampden, Massachusetts, for Michael Dwyer (b. 1831, Ireland, son of John Dwyer) and Mary Dwyer (b. 1832, Ireland, daughter of Patrick Dwyer). The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Patrick Dwyer, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree's marriage date for Michael and Mary Dwyer is **20 April 1854 in Greenfield, Franklin, Massachusetts** — one day off and in a different town/county than the hint record's 21 April 1854, Chicopee, Hampden. A one-day marriage-date discrepancy is a common transcription variant, but the town/county mismatch (Chicopee/Hampden vs. Greenfield/Franklin — not neighboring counties) is a more serious divergence a reviewer should weigh against the exact-name, exact-year, same-country-of-origin (Ireland) match. The tree also records the groom's birth year as 1837, six years later than the hint record's 1831 — another point against a confident match. "Michael Dwyer" and "Mary Dwyer" are common Irish immigrant names, raising the odds of a same-name, different-family coincidence.
