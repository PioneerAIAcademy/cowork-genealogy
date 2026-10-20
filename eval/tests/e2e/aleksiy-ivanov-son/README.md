# Алексий Васильев Иванов — a son Павел born in Samara in November 1885

**Source PID:** `L8PL-3W8`
**Алексий Васильев Иванов is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No birth or death date in the tree; it carries an undated Death fact. Husband of Елизавета Васильева; father of Виктор, born 29 October 1894 in Samara, and Павел, born 15 February 1902 in Samara. His only attached source is Виктор's 1894 birth entry in the Samara metrical books, which names the parents as Алексей Васильев Иванов and Елизавета Васильева.

## Research question

> What children did Алексий Васильев Иванов of Samara, husband of Елизавета Васильева and father of Виктор (born 29 October 1894) and Павел (born 15 February 1902), have besides these two?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `L8PL-3W8` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 22, `hint-samples.csv` row 758,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Россия, Самарские метрические книги, 1748-1934", a birth entry for Павел Иванов, born 2 November 1885 in Samara, naming his parents as Василий Иванов and Степанида Иванова.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Павел (born 1885) as his son, plus a `required` finding that the report documents
the rejection.

Probably a false match. Both parents' given names differ from the tree couple: the hint's father is **Василий**, where the subject is Алексий (Алексей) Васильевич, son of a Василий; the hint's mother is **Степанида**, where the subject's wife is Елизавета. The hinting engine appears to have matched on surname, place and the son's name Павел, which the tree already gives to a child born in 1902. Ivanov is the commonest surname in Russia, so a Samara couple of that name with a son Павел is weak evidence on its own.

Two readings would keep it alive. The indexer may have taken the father's patronymic for his given name ("Алексей Васильев" read as "Василий"), and Степанида could be an earlier wife, dead before the 1894 entry. Even then, the image's own catalogue coverage is 1871–1875 against an indexed date of 1885, so the date itself needs checking.

The discriminating check is the 1885 register image: read the father's full entry (given name, patronymic and social estate) and the year at the head of the page. An entry reading "Алексей Васильев" makes this a candidate first marriage; "Василий" with any other patronymic settles it as someone else.
