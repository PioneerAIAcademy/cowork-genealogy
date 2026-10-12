# Maria Bracero — marriage in June 1907, Mayagüez, Puerto Rico

**Source PID:** `LL4N-82C`
**Maria Bracero is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1880 in Puerto Rico; living in Hormigueros in 1910 and 1920 and a widow by 1930. The tree couples her with Gregorio Morales (born 1850) and with a second, undated Gregorio Morales, with no marriage fact on either couple and no parents for her; children born 1904–1922.

## Research question

> When and where did Maria Bracero, born about 1880 in Puerto Rico and living in Hormigueros in 1910 and 1920, marry Gregorio Morales, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `LL4N-82C` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 21, `hint-samples.csv` row 743,
flags `adds_father,adds_mother,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Puerto Rico, Registro Civil, 1805-2002", a marriage entry of 23 June 1907 registered in Mayagüez, Puerto Rico, for Gregorio Morales (born 1849, son of Tomas Morales and Leonarda Bracero) and Maria Bracero (born 1883, daughter of Juan Bracero and Juana Irizarri).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the June 1907 marriage and the parents Juan Bracero and Juana Irizarri, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both names match the tree couple, the groom's 1849 is a year off the tree's 1850 for Gregorio Morales (G8M9-59S), and the bride's 1883 is three years off her census-derived 1880. Mayagüez borders Hormigueros, and the tree's children already carry Mayagüez birth registrations (Maria Jovita, born 1905; Eufemia, 1910; Marcos, 1912). The mother's surname is independently corroborated by the tree's own sources: the 1920 census indexes her as "Maria Bracero Y Irizarry", and a 1973 civil entry (`ark:/61903/1:1:QVJX-8L5R`) pairs "Maria Bracero Irizarry" with a Juan Bracero. No existing source is dated 1907 or indexed as a marriage, so this is not a re-index of anything already in the tree.

The one oddity is that the marriage postdates the couple's eldest children (Jovita 1904, Maria Jovita 1905, Julia and Cárlos 1906). That is common in Puerto Rico when a consensual union was formalised, but it means the tree's children do not on their own date the marriage. The tree also has two Gregorio Morales spouses for her (G8M9-59S and the undated GRDB-7WY, father of Maria Jovita), probably one man entered twice; the hint does not resolve that. The discriminating check is the register image linked from the hint record: a Puerto Rican civil marriage act states the bride's residence and often lists the children the marriage legitimated. Hormigueros as her residence, or the 1904–1906 children named on the act, would settle it.
