# Creszentia Haas — birth and christening (May 1835, Lichtental, Baden)

**Source PID:** `9DZX-B29`
**Creszentia Haas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; known only as the mother of Genofeva Haas, christened 7 January 1855 at Durbach, Amt Offenburg, Baden.

## Research question

> When and where was Creszentia Haas — mother of Genofeva Haas (chr. 1855, Durbach, Baden) — born and christened?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `9DZX-B29` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 3, `hint-samples.csv` row 45,
flag `adds_birth,adds_christening`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Germany, Births and Baptisms, 1558-1898", a christening entry for Creszentia Haas, born 25 May 1835 and christened 26 May 1835 at Lichtental, Amt Baden, naming parents Mathias Haas and M. Anna Steinel.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 25 May 1835 Lichtental birth, plus a `required` finding that the report documents
the rejection.

A weak candidate, and the batch needs some. The father's name matches — the tree's Matthias Haas against the record's Mathias Haas — and the chronology works: a woman born in 1835 bearing a child in January 1855 is 19. Nothing else lines up cleanly.

The mother's surname is the problem. The tree records Creszentia's mother as Maria Anna **Schmieder**; the hint names **M. Anna Steinel**. Those are not transcription variants of one another, and one of the two has to be wrong. Geography is the second problem: the hinted christening is at Lichtental in Amt Baden, while the tree's only dated event is the daughter's 1855 christening at Durbach in Amt Offenburg — a different parish and a different district, roughly 45 km apart. Weigh both against the fact that the tree's entire content for this family rests on one derivative index entry for the daughter Genofeva, with no dates at all on either parent; the reviewer may well conclude the tree is the weaker document. "Haas" with a "Mathias" father in 1830s Baden is not a discriminating combination on its own.
