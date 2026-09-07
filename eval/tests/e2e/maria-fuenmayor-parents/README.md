# María Concepción Fuenmayor — parents Juan and Graciliana, and a 1912 Maracaibo marriage

**Source PID:** `GMH9-3BJ`
**María Concepción Fuenmayor is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1893 in Maracaibo; death not recorded in the tree.

## Research question

> Who were the parents of María Concepción Fuenmayor of Maracaibo, and when did she marry Eduardo Berrueta Fernández?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GMH9-3BJ` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 30, `hint-samples.csv` row 972,
flag `adds_father,adds_mother,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Venezuela, registros parroquiales y diocesanos, 1577-2022", a marriage entry of 13 January 1912 for Eduardo Berrueta (son of Andrés Berrueta and María del Rosario Fernández) and María Tereza Fuenmayor (daughter of Juan and Graciliana Fuenmayor).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Juan and Graciliana Fuenmayor as her parents, plus a `required` finding that the report documents
the rejection.

The groom's side settles the identification and the bride's given name is the only thing in the way. The record's Eduardo Berrueta is the son of **Andrés Berrueta and María del Rosario Fernández** — which is exactly what the tree's spelling of the husband, **Eduardo Berrueta Fernández**, encodes under the Venezuelan two-surname convention, and the tree gives that name from the children's baptisms without naming his parents. The date works cleanly: a marriage on 13 January 1912 comes sixteen months before the couple's first recorded child, María Rosario Berrueta Fuenmayor, baptised 10 May 1913 at Nuestra Señora de la Chiquinquirá in Maracaibo — the same parish complex as the marriage.

What the reviewer has to decide is **María Tereza** against the tree's **María Concepción**. Both are Fuenmayor, both in Maracaibo, both marrying an Eduardo Berrueta in the right window. The likeliest readings are an index slip or a fuller baptismal name recorded differently at marriage; the least likely, though it must be excluded, is two Fuenmayor brides. The tree carries **14 sources**, all from this one collection, in which she appears as María Concepción, Concepción, María, and "María Concepcion Fuenmayor de Berrueta" — so her own name is already known to vary, and one of those fourteen may be this very entry.

If it holds, the hint supplies her parents (Juan Fuenmayor and Graciliana Fuenmayor — note both surnamed Fuenmayor, which is worth a look in itself) and a marriage date the tree lacks entirely.
