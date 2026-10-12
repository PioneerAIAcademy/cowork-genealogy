# Ásgeir Brinjólfsson — birth about 1777, Iceland

**Source PID:** `KHJ9-95M`
**Ásgeir Brinjólfsson is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree names him in the genitive, "Asgeirs Brinjolfssonar", as the baptism entries do, and carries no birth and an undated Death fact. Husband of Sigríður Pétursdóttir; daughters Málfríður (born 4 August 1808, christened 5 August 1808) and Sólveig (christened 25 June 1812, at Leysingjastaðir), both in Hvammur parish, Hvammssveit, Dalasýsla.

## Research question

> When and where was Ásgeir Brinjólfsson born, the husband of Sigríður Pétursdóttir and father of Málfríður (christened 5 August 1808) and Sólveig (christened 25 June 1812) at Hvammur in Hvammssveit, Dalasýsla, Iceland?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KHJ9-95M` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-3.csv` row 13, `hint-samples.csv` row 486,
flag `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Iceland, Church Census, 1744-1965", the 1808 household of Helgi Jónsson and Guðrún Pétursdóttir in Dalasýsla (register image from Hvammur, 1803–1814), listing Ásgeir Brinjólfsson, farm hand (*vinnumaður*), born 1777; the census gives ages, not birthplaces.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the birth about 1777, plus a `required` finding that the report documents
the rejection.

A strong candidate on identity. The same household lists a maid (*vinnukona*), Sigríður Pétursdóttir — the name of the tree's wife — so in 1808 Ásgeir Brinjólfsson and Sigríður Pétursdóttir were servants under one roof in Hvammur parish, the year and parish of the baptism that names them as Málfríður's parents (`ark:/61903/1:1:FGPF-X52`, August 1808). Both names, the parish and the year line up, and the surname is spelled Brinjólfsson as in the tree's baptism entries. The tree's sources for him are only his daughters' two baptisms, so none is a re-index of this census; Málfríður's own 1812 church census entry is a different household (Jón Jónsson and Helga Helgadóttir).

What is thin is the year itself: it is an age in a church census turned into a birth year, good to a year or so, with no birthplace. The census gives Sigríður a birth year of 1766, which would make her 42 at Málfríður's birth and 46 at Sólveig's — possible, but enough to wonder whether an age was misread. The tree cannot test that, because its wife's birth (1834) and 1840 residence come from a misattached 1840 census entry for a Sigríður Guðbrandsdóttir. The discriminating check is an independent age for Ásgeir — the 1801 national census (*manntal*) or his burial entry: an age that also points to about 1777 settles the year; a clearly different one would mean the census age, or the man, is not the tree's.
