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

**Resolved: true match (2026-07-31).** This fixture came from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches; this one holds up. The hint record — ARK `1:1:VJRW-GQR` / `1:1:VJRW-GQY` (the same document; `GQR` is the father-person node within it), collection "Hungary, Reformed Church Christenings, 1624-1895" — records a baptism in 1881 naming child **András Muck**, father **Mátyás Muck**, and mother **Erzsébet Farkas**. "Farkas" is the literal Hungarian translation of "Wolf," a specific and distinctive linguistic clue tying this entry to Erzsébet **Wolf**, Mátyás's first wife (married 1866, until her death in 1900 — 1881 falls comfortably inside that marriage).

The record is filed under the Bogyiszló Reformed parish (a nearby parish seat), but the handwritten entry itself names the family's residence as **Bikács** — Mátyás Muck's own birth and death village — consistent with Bikács being a filial congregation of the Bogyiszló parish rather than a mismatch. The tree already has a son named **András Muck**, born 5 February 1873 and died 1 April 1873 (in infancy); a previously-unattached Reformed Church christening record for that same 1873 András (ARK `1:1:VJRW-KJZ`, same collection, same parents' names, same place) independently corroborates that this record set belongs to this exact family. Taken together, the family named a second son András after the one who died in infancy — the same necronym pattern documented in the committed `heinrich-dewus-children-death` fixture. `expected-findings.json` is unchanged from the original transcription of the hint, which had it right from the start.

*(An earlier review pass on this fixture concluded the hint was a false match, describing an 1887 Evangelical baptism naming a father "Mátyás Misch" — that description does not correspond to what is actually recorded at this ARK, per a direct `record_read` and a firsthand look at the record image. That resolution was superseded before landing.)*
