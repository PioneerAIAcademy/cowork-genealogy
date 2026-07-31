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

**Resolved: true match (2026-07-31).** This fixture came from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches; this one holds up, but only after resolving a genuine identity conflict — see below. The hint record — ARK `1:1:VJRW-GQR` / `1:1:VJRW-GQY` (the same document; `GQR` is the father-person node within it), entry #44 in "Hungary, Reformed Church Christenings, 1624-1895" — is a baptism naming child **András Muck**, father **Mátyás Muck** (occupation "földmíves," farmer), and mother **Erzsébet Farkas**. "Farkas" is the literal Hungarian translation of "Wolf," a specific and distinctive linguistic clue tying this entry to Erzsébet **Wolf**, Mátyás's first wife (married 1866, until her death in 1900). The entry's own handwritten date is **19 October 1887 (baptized 22 October)** and its place is **Bikács** — Mátyás Muck's own birth and death village, and the father's stated occupation (farmer) matches his profile too. The record states the family's faith as **Evangelical**, despite being cataloged in FamilySearch's "Reformed Church Christenings" collection — evidently a mixed-denomination register, not evidence of a different family.

**The FamilySearch index metadata for this exact document is unreliable and should not be trusted on its own:** it gives the year as **1881** (the entry itself says 1887) and the place as **Bogyiszló** (the entry itself says Bikács, its residents' actual village — Bogyiszló is the parish seat, of which Bikács is a filial congregation). Both were caught only by reading the record image directly, not the index fields.

**Identity conflict, resolved:** two automated re-reads of the image, plus a re-read of the neighboring 1873 entry for comparison, returned the father's given name as "Mihály" rather than "Mátyás," and one read mangled the surname into something closer to "Mench." A clean, careful direct read of the image resolved this in favor of **Mátyás**: the entry's specific combination of name, occupation (farmer), and residence (Bikács) is a multi-point match to the subject person that a misread "Mihály"/different-family theory doesn't have a comparable case for. Automated OCR passes on this particular scan were not reliable — treat any single OCR/index read of this record with caution; a direct human look at the image is what actually settled both the date and the identity question.

The tree already has a son named **András Muck**, born 5 February 1873 and died 1 April 1873 (in infancy); a previously-unattached Reformed Church christening record for that same 1873 András (ARK `1:1:VJRW-KJZ`, same collection, same parents' names, same place) independently corroborates that this record set belongs to this exact family. Taken together, the family named a second son András after the one who died in infancy — the same necronym pattern documented in the committed `heinrich-dewus-children-death` fixture. `expected-findings.json`'s finding is a corrected version of the original hint transcription: same identification, corrected date (Oct 1887, not "about 1881").

*(An earlier review pass on this fixture concluded the hint was a false match, describing an 1887 Evangelical baptism naming a father "Mátyás Misch" — a description that turned out to share the correct denomination (Evangelical) and year (1887) but the wrong surname reading, on what is actually the same record as the hint. That resolution, and a subsequent true-match resolution that kept the index's incorrect 1881 date, were both superseded before landing.)*
