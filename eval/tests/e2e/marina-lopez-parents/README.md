# Marina López — parents Manuel López and Carmen Nelia Casado (1927 marriage)

**Source PID:** `P874-7BV`
**Marina López is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of San José de Ocoa, Dominican Republic.

## Research question

> Who were the parents of Marina López, wife of Juan de Dios Pichardo Chalas of San José de Ocoa, and when was she born and married?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `P874-7BV` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 8, `hint-samples.csv` row 283,
flag `adds_father,adds_mother,adds_birth,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "República Dominicana, Registro Civil, 1744-2019", a 7 October 1927 marriage entry for Juan De Dias Chalas (b. 1894) and Manna López (b. 1903), naming the bride's parents as Manuel López and Carmen Nelia Casado and the groom's mother as Lidelina Chalas.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Manuel López and Carmen Nelia Casado as her parents, plus a `required` finding that the report documents
the rejection.

"Manna López" reads as an indexing slip for Marina López, and the groom — "Juan De Dias Chalas" — is recognisably the tree's Juan de Dios Pichardo Chalas, in the right town. The couple's known children (b. 1934 and 1935) sit comfortably after a 1927 marriage.

The discriminator to check is the groom's birth year: the record says 1894, the tree says 8 December 1902, and the tree's own christening entry (6 May 1913) does not settle which is right. The tree also already carries a "Manuel Lopez" source from this same civil-registration collection attached to Marina, so establish whether the hinted father is genuinely new information or a re-index of a record already attached.

Four claims ride on this single record — both parents, her 1903 birth year, and the 1927 marriage — and they can be true or false separately. If the identification holds but the index is unreliable on dates, outcome (b) with the marriage kept and the birth year dropped is the likely shape.
