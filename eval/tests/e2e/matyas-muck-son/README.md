# Muck Mátyás — second son named András (b. 1881)

**Source PID:** `97M5-6H8`
**Mátyás Muck is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
25 August 1844, Bikács, Tolna, Hungary; died 31 December 1921, Bikács, Tolna, Hungary.

## Research question

> Did Mátyás Muck and his first wife Erzsébet Wolf of Bikács, Tolna, Hungary have a second son named András, baptized about 1881, after their first son András died in infancy in 1873?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `97M5-6H8` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Hungary, Reformed Church Christenings, 1624-1895: baptismal entry for András Muck, naming parents Mátyás Muck and Erzsébet Farkas. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming a second András Muck, plus a `required` finding that the report documents the rejection.

The tree **already has a son named András Muck**, born 5 February 1873 and died 1 April 1873 (in infancy) — so if this hint is a true match, the family named a later child after the one who died, exactly the necronym pattern already documented in the committed `heinrich-dewus-children-death` fixture. In favor: the mother's name "Erzsébet Farkas" in the hint is a literal Hungarian translation of "Erzsébet **Wolf**" ("farkas" = "wolf" in Hungarian), a specific and distinctive linguistic clue pointing to the same woman recorded under a translated form of her German surname. Mátyás Muck's first marriage (to Erzsébet Wolf, 1866) lasted until her death in 1900, so an 1881 birth falls comfortably within that marriage. Because the family already used the name András once, distinguishing this record from the 1873 infant (rather than accidentally double-counting the same child) is the crux of the adjudication.
