# Jean-Baptiste Cupis — burial in May 1788, Montreuil, France

**Source PID:** `K642-XP9`
**Jean-Baptiste Cupis is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Christened 23 November 1711 in Brussels, son of Ferdinand-Joseph Cupis and Marie-Anne De Smedt; the tree gives his death as 30 April 1788 with no place and carries no burial. Married Constance Dufour in 1729 in Belgium.

## Research question

> When and where was Jean-Baptiste Cupis buried? He was the son of Ferdinand-Joseph Cupis and Marie-Anne De Smedt, was christened in Brussels on 23 November 1711, married Constance Dufour in 1729, and died on 30 April 1788.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `K642-XP9` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 3, `hint-samples.csv` row 68,
flags `adds_birth,adds_burial`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "France, Seine-Saint-Denis, Parish and Civil Registration, 1523-1932", a burial entry for Jean Baptiste de Cupis (born 1710) who died 30 April 1788 and was buried 1 May 1788 at Montreuil, Seine-Saint-Denis; the register image is from the pre-1792 Montreuil parish registers.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the May 1788 Montreuil burial, plus a `required` finding that the report documents
the rejection.

A strong candidate. The indexed death date, 30 April 1788, is exactly the death date the tree already carries, and the name with the noble particle "de Cupis" fits a family the tree itself identifies through his sister Marie Anne De Cupis De Camargo, whose life sketch names her as the dancer La Camargo. The tree's son François was born in Paris in 1732, so a death in the Paris suburbs fits where the family lived. The `hint-samples.csv` country is Belgium, but the record is French; the fixture is tagged `FR` to the record. The tree person cites no sources at all, so nothing in the tree is a re-index of this entry.

The `adds_birth` flag is an indexing artefact: the index's 1710 is a year computed from an age at death, a year off the tree's 23 November 1711 Brussels christening, and nobody should replace the christening with it. The one in-tree confounder is his son Jean Baptiste Cupis (`MHT2-X6G`), but the tree has that son dead before 1778, so he cannot be the man buried in 1788. The check that would settle it is the burial act on the register image: a French burial entry of this date normally gives age, occupation and the names of witnesses or a surviving wife, and an age of about 76–77, a musician's occupation, or Constance Dufour or François Cupis named in the act would confirm the match.
