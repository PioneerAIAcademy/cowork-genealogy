# Claudia Almada — birth about 1861, Buenos Aires, Argentina

**Source PID:** `G5RB-GL5`
**Claudia Almada is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth and an undated Death fact for her. Daughter of Gregoria Almada; married Alejandro Sequeira on 12 May 1879 at Nuestra Señora de la Merced, General Lavalle, Buenos Aires; mother of Lujana Juana Sequeira, baptized there on 19 August 1880.

## Research question

> When and where was Claudia Almada born, the daughter of Gregoria Almada who married Alejandro Sequeira on 12 May 1879 at Nuestra Señora de la Merced, General Lavalle, Buenos Aires, Argentina?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G5RB-GL5` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 34, `hint-samples.csv` row 16,
flag `adds_birth`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Argentina, National Census, 1869", an entry for Claudia Almada, Argentine, born 1861 in Buenos Aires, enumerated at Ajó, Buenos Aires (register image filed under General Lavalle); the birth year is computed from her census age.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the birth about 1861, plus a `required` finding that the report documents
the rejection.

A plausible candidate on place and age. The census district is Ajó, the partido whose register images are filed under General Lavalle, the parish where the tree's Claudia married in 1879 and baptized her daughter in 1880; a girl of about eight in 1869 is a bride of about 18 in 1879. The tree's only record source for her is that 1880 baptism (`ark:/61903/1:1:XNDD-ZL1`), which gives no age; her marriage and her mother come from the Computer-Generated Tree, so none is a re-index of the census. A search of the parish collection finds her 1879 marriage investigation file in General Lavalle, which indexes her birth year as 1860 and her mother as Gregoria Almada — consistent with the census.

What is thin is that the census names no parent: Claudia is indexed next to a Dolores Almada, single, born about 1845 in Córdoba, not Gregoria. The census also carries a second index entry for the same Claudia (and the same Dolores) at Ajó, which looks like a duplicate of one enumeration rather than a second girl. And the census may not be the best answer: the Dolores parish has a baptism for Claudia Jesus Almada, born 30 October 1860 and christened 8 June 1863, mother Gregoria Almada, about 65 km west of General Lavalle. The discriminating check is the birthplace stated in the 1879 marriage investigation file: Dolores would make that baptism hers, and the finding should then become the 30 October 1860 birth in Dolores rather than the census's "about 1861, Buenos Aires".
