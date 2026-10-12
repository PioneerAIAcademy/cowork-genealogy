# Umbelina Maria Azevedo — death in November 1910, Rio de Janeiro, Brazil

**Source PID:** `GXSQ-V3L`
**Umbelina Maria Azevedo is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree gives her no dates; it carries an undated Death fact. Wife of Francisco Antônio Pariz; mother of Alice Umbelina (born about 1902), Antônio Francisco (1909, Espírito Santo), Maria Glória (1912, Espírito Santo), Florita Umbelina (1915, Espírito Santo) and Maura Umbelina (1918), who died in Rio de Janeiro state between 1971 and 1990.

## Research question

> When and where did Umbelina Maria Azevedo die? She was the wife of Francisco Antônio Pariz and the mother of Alice Umbelina, Antônio Francisco, Maria Glória, Florita Umbelina and Maura Umbelina, born between about 1902 and 1918, several of them in Espírito Santo.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GXSQ-V3L` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 4, `hint-samples.csv` row 104,
flags `adds_birth,adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Brasil, Rio de Janeiro, Registro Civil, 1804-2013", a death entry for Umbelina Azevedo Da Silva (born 1879) who died 14 November 1910, registered in the city of Rio de Janeiro; the register image is a 1910–1911 Rio de Janeiro death book.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the November 1910 death, plus a `required` finding that the report documents
the rejection.

A weak candidate that the tree itself contradicts. The only overlap is the given name and one surname: the index gives just "Umbelina Azevedo Da Silva", a computed birth year and the date, with no spouse or parents. Against it, the tree has three of her children born after November 1910 — Maria Glória in 1912 and Florita Umbelina in 1915, both in Espírito Santo, and Maura Umbelina in 1918 — so a mother dead in 1910 is impossible unless all three years are wrong. Those years most likely come from ages on the children's own 1978–1982 death entries, which can be off by a year or two, but not by five to eight. The tree also puts the children born 1909–1915 in Espírito Santo, not the city of Rio. The children's death entries the tree cites name her as Umbelina Maria de Azevedo or Umbelina Maria Pariz de Azevedo (e.g. `ark:/61903/1:1:79FM-TFN2`), never with "da Silva"; none of them is a re-index of this entry.

The `adds_birth` flag is the index's 1879, a year computed from an age at death; it is no evidence on its own. The check that would settle it is the death act on the register image: a Rio civil death act of 1910 normally names the deceased's spouse and parents. A husband named Francisco Antônio Pariz would make this her and the children's birth years wrong; any other husband or a single woman would make this a different Umbelina.
