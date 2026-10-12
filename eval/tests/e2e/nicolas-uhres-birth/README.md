# Nicolas Uhres — birth about 1856, Keispelt, Luxembourg

**Source PID:** `GYGJ-D1C`
**Nicolas Uhres is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for him — no birth. Wife Marguerite Birchen (undated); children Johann (5 December 1883, Keispelt, Kehlen) and Josephine (23 July 1885, Keispelt; died 1958 in Owatonna, Minnesota). The couple has no marriage fact.

## Research question

> When and where was Nicolas Uhres born, the husband of Marguerite Birchen and father of Johann (born 1883) and Josephine (born 1885) Uhres of Keispelt, Luxembourg?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GYGJ-D1C` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 16, `hint-samples.csv` row 552,
flags `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Luxembourg, Census Records, 1843-1900", the 1880 census of Kehlen commune (canton Capellen), an entry for Nicolas Uhres, single, born 1856 in Keispelt (the birth fact is indexed twice, identically).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1856 Keispelt birth, plus a `required` finding that the report documents
the rejection.

A plausible candidate on place and life stage, thin on identifiers. Keispelt is a village in Kehlen commune, the tree's children were both born in Keispelt, and Johann's 1883 birth entry in the tree (`ark:/61903/1:1:6LY5-7MX2`) sits in the Kehlen birth register — the same commune this census covers. A man single in 1880 and born in 1856 would be 27 at a first child in December 1883, which fits. None of the tree's sources is a re-index of this census entry; they are civil entries of 1883, 1912 and 1914 that name him as a parent.

What is thin: the index carries only name, birth year, birthplace and marital status — no parents, and no household members are returned with it — and Uhres is a local Keispelt surname, so a cousin of the same name is a real risk. The tree has no birth or marriage date for Nicolas to compare against, so nothing in it can contradict the 1856 year either. The discriminating check is the Kehlen civil marriage act of Nicolas Uhres and Marguerite Birchen (about 1882–1883), which states the groom's exact birth date and place and his parents: a groom born in 1856 at Keispelt settles it; a groom born years away, or elsewhere, makes the census man a namesake.
