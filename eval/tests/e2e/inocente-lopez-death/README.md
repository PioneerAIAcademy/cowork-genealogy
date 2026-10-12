# Inocente Lopez — death in January 1906, Suchitoto, El Salvador

**Source PID:** `L8GW-R6Y`
**Inocente Lopez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 11 June 1860 in Oratorio de Concepción, Cuscatlán; the tree carries an undated Death fact and no parents. Married Virginia Mendoza on 11 March 1885 at Oratorio de Concepción; children born 1884–1895 in Suchitoto and San Pedro Perulapán.

## Research question

> When and where did Inocente Lopez, born 11 June 1860 in Oratorio de Concepción, Cuscatlán, El Salvador, and married to Virginia Mendoza in 1885, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `L8GW-R6Y` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 8, `hint-samples.csv` row 331,
flags `adds_mother,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "El Salvador, Civil Registration, 1704-2001", a death entry for Inocente Lopez who died 13 January 1906, registered in Suchitoto, Cuscatlán, naming his mother as Santos Lopez; the index gives no age, spouse or birthplace.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the January 1906 death and the mother Santos Lopez, plus a `required` finding that the report documents
the rejection.

A plausible candidate on place, with almost nothing else to test it against. The name is exact and Suchitoto is the family's town: sons Feliz (1884) and Mariano (1895) were born there, and son Alberto married Felicita Lara there in May 1906 (civil entry 4 May, `ark:/61903/1:1:X97H-17N7`; church entry 5 May at Santa Lucía, `ark:/61903/1:1:661Y-SPG5`), both naming his parents as Inocente Lopez and Virginia Mendoza. But the index carries no age, no wife and no birthplace, and its one identifier — the mother Santos Lopez — cannot be checked, because the tree has no parents and no birth or baptism record for Inocente; every source it cites for him is one of Alberto's entries, so none is a re-index of this death. Inocente Lopez is not a rare name in Cuscatlán, and a death at 45 sits well before Virginia's death about 1960, so nothing contradicts it either.

The `adds_mother` flag is real data from the entry, not an artefact; a mother sharing the subject's surname fits a natural child, but nothing in the tree confirms or rules that out. The discriminating check is the death register image linked from the hint record: a Salvadoran death act of 1906 normally gives the deceased's age, civil status and spouse. An age near 45 and a wife named Virginia Mendoza would settle it as this man; a different age or spouse would make this another Inocente Lopez. (The May 1906 marriage images, if they call Alberto's father *difunto*, are a useful cross-check.)
