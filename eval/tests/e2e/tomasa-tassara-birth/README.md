# Tomasa Tassara — birth about 1864, Buenos Aires, Argentina

**Source PID:** `GW82-2VP`
**Tomasa Tassara is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth and an undated Death fact for her. Wife of Juan Rossello; mother of Juan Felipe Marcelo (born 18 June 1885, christened 15 August 1885), Catalina (born 1888), Angela (born 31 July 1889), Bartolome (born 1892, died 1975) and Maria (born 19 November 1898, christened 25 February 1899), all in Mercedes, Buenos Aires.

## Research question

> When and where was Tomasa Tassara born, the wife of Juan Rossello and mother of Juan Felipe Marcelo (christened 15 August 1885), Angela (born 31 July 1889) and Maria (christened 25 February 1899) Rossello at Mercedes, Buenos Aires, Argentina?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GW82-2VP` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 33, `hint-samples.csv` row 13,
flag `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Argentina, National Census, 1895", an entry for Tomasa Tassara, married, born 1864 in Buenos Aires, enumerated in Cuartel 01 (Población rural) of Mercedes, Buenos Aires (register image from Mercedes); the birth year is computed from her census age.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the birth about 1864, plus a `required` finding that the report documents
the rejection.

A strong candidate on identity. A search of the same 1895 census returns, in the same rural district of Mercedes and with record numbers adjacent to hers, a married Juan Rossello born 1858 in Italy and children Juan (1886), Catalina (1888), Angela (1890) and Bartolome (1892) — the tree's husband and four of its children, with birth years one off at most. A married woman of about 31 fits a mother whose first child was christened in Mercedes in 1885. The tree's three sources for her are her children's baptisms, which index her as Tomasa Passara (1885, `ark:/61903/1:1:66M1-15HH`), Pasara (1889) and Tassaro (1899); none gives an age or birthplace, and none is a re-index of the census.

What is thin is the fact itself: an age turned into a year, good to a year or so, and a birthplace of only "Buenos Aires", which in this census can mean the province or the city. The surname is also unsettled — the baptisms read Passara or Pasara as often as Tassara. The discriminating check is the census sheet itself: confirming that Tomasa is listed as Juan Rossello's wife in the household with Juan, Catalina, Angela and Bartolome settles identity, and her marriage or death entry would then fix the year and the place more closely than an age can.
