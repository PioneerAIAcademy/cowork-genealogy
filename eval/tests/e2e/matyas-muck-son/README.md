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

**Resolved: true match (2026-07-31).** This fixture came from a hint batch (`filtered-list-samples.csv` row 19, flag `adds_son`, confidence 3) in which roughly half the hint records are false matches; this one holds up, but only after resolving a genuine identity conflict — see below. The hint record — ARK `1:1:VJRW-GQR` / `1:1:VJRW-GQY` (the same document; `GQR` is the father-person node within it), entry #44 in "Hungary, Reformed Church Christenings, 1624-1895" — is a baptism naming child **András Muck**, father **Mátyás Muck** (occupation "földmíves," farmer), and mother **Erzsébet Farkas**. "Farkas" is the literal Hungarian translation of "Wolf," a specific and distinctive linguistic clue tying this entry to Erzsébet **Wolf**, Mátyás's first wife (married 1866, until her death in 1900). The entry's own handwritten date is **19 October 1881 (baptized 22 October)** and its place is **Bikács** — Mátyás Muck's own birth and death village, and the father's stated occupation (farmer) matches his profile too. The record states the family's faith as **Evangelical**, despite being cataloged in FamilySearch's "Reformed Church Christenings" collection — evidently a mixed-denomination register, not evidence of a different family.

**One item of FamilySearch's index metadata for this exact document is wrong: the place.** It gives the place as **Bogyiszló** (the entry itself says Bikács, the residents' actual village — Bogyiszló is the parish seat, of which Bikács is a filial congregation). The index's *year* (1881) is correct, matching the original hint transcription — a date correction to "1887" was proposed at one point during adjudication but did not hold up against a full read of the register page (every entry on that page, including #44, falls under an "1881" heading; "1887" belongs to an unrelated family several rows down) and has been reverted.

**Identity conflict, resolved:** two automated re-reads of the image, plus a re-read of the neighboring 1873 entry for comparison, returned the father's given name as "Mihály" rather than "Mátyás," and one read mangled the surname into something closer to "Mench." This was resolved in favor of **Mátyás** by comparing letterforms against unambiguous "Mátyás" instances by the same scribe elsewhere on the same page, plus an independent instance in the couple's already-sourced 1874 baptism of daughter Éva — both matching entry #44's rendering. A same-village "Muck Mihály" household is real but is a different family. Automated OCR passes on this particular scan were unreliable on both the date and the identity question — a careful direct read of the image, cross-referenced against other entries by the same scribe, is what actually settled both.

The tree already has a son named **András Muck**, born 5 February 1873 and died 1 April 1873 (in infancy); a previously-unattached Reformed Church christening record for that same 1873 András (ARK `1:1:VJRW-KJZ`, same collection, same parents' names, same place) independently corroborates that this record set belongs to this exact family. Taken together, the family named a second son András after the one who died in infancy — the same necronym pattern documented in the committed `heinrich-dewus-children-death` fixture. `expected-findings.json`'s finding matches the original hint transcription's identification and date; only the place (Bikács, not Bogyiszló) is corrected from the index.

*(An earlier review pass on this fixture concluded the hint was a false match, describing a baptism naming a father "Mátyás Misch" — a misreading of the same record's father as this adjudication also encountered before resolving it in favor of Mátyás. A later pass also mistakenly corrected the date to 1887; both were superseded before landing.)*
