# Robert Lord — children James and Betsy in the 1911 Rochdale census

**Source PID:** `GSPY-NFZ`
**Robert Lord is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1858, Lancashire; resident at Rochdale St Chad and Spotland in 1891; death not recorded in the tree.

## Research question

> Is the Robert Brierley enumerated at Rochdale in 1911 with wife Ellen and children James and Betsy the same man as Robert Lord (b. 1858, son of Abel Brierley), and did he have those two children?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GSPY-NFZ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 9, `hint-samples.csv` row 332,
flag `adds_son,adds_daughter,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "England and Wales, Census, 1911", the Rochdale, Lancashire household of Robert Brierley (b. 1866, Rochdale) and Ellen Brierley (b. 1869, Rochdale) with children James (b. 1895) and Betsy (b. 1899).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming James and Betsy Brierley as his children, plus a `required` finding that the report documents
the rejection.

The whole fixture turns on a surname. The tree calls the subject **Robert Lord** while giving him a father named **Abel Brierley** and a mother Alice — a discrepancy the tree never explains, and exactly the shape left behind by an illegitimate birth, a step-father, or an indexing error. The hint is a Robert **Brierley** in the right town.

For the match: his wife. The tree records Robert's wife as Ellen, b. 1870 in Lancashire, resident at Rochdale St Chad in 1891; the 1911 census household has Ellen Brierley, b. 1869 in Rochdale. That is a good fit on both name and year, and Rochdale St Chad is the same registration area. Against the match: the birth years for Robert himself are eight years apart — the tree says 1858, the census says 1866 — which no amount of census slop covers.

The tree has exactly one source (the 1891 census) and carries a LifeSketch that may explain the surname; read it first. If the identification fails, this becomes a clean restraint test, since attaching two children to the wrong Lancashire mill-town Robert is precisely the error the benchmark is meant to catch.
