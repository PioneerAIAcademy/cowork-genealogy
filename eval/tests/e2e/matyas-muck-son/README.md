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

**Resolved: false match, no findable substitute.** This fixture came from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches. The hint record (ARK `1:1:VJRW-GQR`) is a 22 September 1887 Evangelical (Lutheran) baptism in Bogyiszló, Pest-Pilis-Solt-Kis-Kun, naming the father as **Mátyás Misch** — a different surname and denomination than this family's documented baseline — and omitting the mother's surname entirely. Nothing ties it to this particular Mátyás Muck rather than another man of the same common name.

Mátyás Muck's baseline, from records already attached to the tree person, is a Reformed Church family in Bikács, Tolna: a son **András** born 5 February 1873 who died 1 April 1873 (in infancy), and a separate son **Mátyás** born 1879. No second son named András exists for Mátyás Muck and his first wife Erzsébet Wolf — the only András is the one who died in infancy. `expected-findings.json` has been corrected to a `polarity: "avoid"` finding naming the hint's false claim, paired with a `required: true` finding documenting the negative/exhausted-search conclusion, following the shape used in `thomas-seaver-other-wife`.
