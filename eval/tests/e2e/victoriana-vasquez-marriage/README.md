# Victoriana Vasquez — marriage in January 1875, Degollado, Jalisco, Mexico

**Source PID:** `GFG9-7H4`
**Victoriana Vasquez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her, and no dates, places or sources for anyone in the family. Daughter of Remigio Vasquez and Bernarda Sandoval; wife of Jose Cleofas Gutierrez, with no marriage fact on the couple; mother of Silveria Gutierrez.

## Research question

> When and where did Victoriana Vasquez, daughter of Remigio Vasquez and Bernarda Sandoval, marry Jose Cleofas Gutierrez?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GFG9-7H4` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 32, `hint-samples.csv` row 935,
flag `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Mexico, Marriages, 1570-1950", an index entry for the marriage of Jose Cleofas Gutierrez and Victoriana Vazquez on 9 January 1875 in Degollado, Jalisco; the entry names only the couple, with no parents, ages or residences, and has no linked image. The CSV's country column says "Unknown"; the record's jurisdiction is Jalisco, Mexico, so the fixture is tagged `MX`.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the January 1875 Degollado marriage, plus a `required` finding that the report documents
the rejection.

A plausible candidate that rests on names alone. Both partners match the tree: the bride's given name exactly, her surname as the common Vazquez/Vasquez variant, and the groom's compound given name Jose Cleofas with the surname Gutierrez — a pairing less likely to recur by chance than a plain Jose Gutierrez. Beyond the two names there is nothing to test, in either direction: the tree has no dates or places for anyone, so neither the 1875 date nor Jalisco can be checked against it, and the index names no parents, so the tree's Remigio Vasquez and Bernarda Sandoval are neither confirmed nor contradicted. The tree cites no records, so this cannot be a re-index of an existing source.

Gutierrez and Vázquez are both common surnames in western Mexico, so two couples with these names in the same generation are possible. The discriminating check is the parish marriage entry itself (or its *información matrimonial*) in the Degollado registers for January 1875: a Mexican Catholic marriage entry normally names both sets of parents, and Remigio Vázquez and Bernarda Sandoval as the bride's parents would settle the match; different parents would make this another Victoriana. A baptism for a Silveria Gutiérrez in Degollado naming Cleofas Gutiérrez and Victoriana Vázquez as parents would also tie the couple to this place.
