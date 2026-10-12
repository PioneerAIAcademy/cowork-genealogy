# Elio María Méndez — marriage in July 1924, Guaraque, Mérida, Venezuela

**Source PID:** `PQLG-9J4`
**Elio María Méndez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1910 in Tovar, Mérida (an estimate); the tree carries an undated Death fact. Husband of Domitila Castro (born about 1905, Tovar), with no marriage fact and no parents for either. Their children Elia Rosa (1926), José Ildemaro (1927), Ylda Antonia (1928) and José Angel (1929) were born in Guaraque and baptized at Santa Bárbara, Guaraque; Libsen (1931) was born in Tovar.

## Research question

> When and where did Elio María Méndez marry Domitila Castro, the mother of his children born 1926–1931 in Guaraque and Tovar, Mérida, Venezuela, and who were his parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `PQLG-9J4` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 30, `hint-samples.csv` row 974,
flags `adds_father,adds_mother,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Venezuela, Registro Civil, 1843-2021", a civil marriage registration for Elio María Méndez and Domitila Castro on 3 July 1924 at Santa Bárbara, Guaraque, Mérida, naming his parents Ángel Méndez and Magdalena Luna and hers Vicente Castro and Rosalina Rosalez.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the July 1924 Guaraque marriage and the parents Ángel Méndez and Magdalena Luna, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both spouses' full names match the tree, the marriage is in the very parish, Santa Bárbara de Guaraque, where four of the couple's children were baptized between 1926 and 1929, and a July 1924 marriage sits twenty months before the first of them (Elia Rosa, baptized 7 April 1926, `ark:/61903/1:1:QGKF-L619`). The tree's many sources for Elio are his children's baptisms, civil births and deaths; none is a marriage, so none can be a re-index of this one. The principal persona is indexed under the garbled name "Eli María Castro Francisca", but the record's own title reads "Elio María Méndez y Domitila Castro"; that is an indexing artefact, not a different groom.

The one real conflict is the tree's birth estimate of about 1910, which would make him fourteen at the marriage; it is an unsourced estimate and the likelier error, since his wife is put at about 1905. The new claims a reviewer must accept are the parents, which nothing in the tree corroborates. The discriminating check is one of the children's parish baptisms at Santa Bárbara de Guaraque: Mérida baptisms of this period usually name the grandparents, and paternal grandparents Ángel Méndez and Magdalena Luna (with maternal Vicente Castro and Rosalina Rosales) would confirm both the identification and the parents; different grandparents would mean a second Elio Méndez–Domitila Castro couple.
