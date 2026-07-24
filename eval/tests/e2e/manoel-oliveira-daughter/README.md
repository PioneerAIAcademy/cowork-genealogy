# Manoel Melquiades de Oliveira — additional daughter Josefa (m. 1926)

**Source PID:** `GHJ6-2WV`
**Manoel Melquiades de Oliveira is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Manoel Melquiades de Oliveira and his wife Cândida Damasceno de Oliveira of Rio Grande do Norte, Brazil have a daughter named Josefa, married 1926, in addition to their known children Abel and Maria Lila (b. 1901)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GHJ6-2WV` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 8, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Brasil, Rio Grande do Norte, Registros da Igreja Católica, 1755-2019: marriage registration, 12 March 1926, Natal, for Elfridio Justino Da Silva and Josefa Dias Da Conceição, naming the bride's parents as Manuel Melchiades de Oliveira and Candida de Oliveira. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Josefa Dias Da Conceição as the subject's daughter, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh **against** the match: the proposed daughter's surname, "Dias Da Conceição", bears no resemblance to the father's surname "de Oliveira" — Brazilian naming customs of the era sometimes drew a child's surname from a godparent or the mother's line, but this is a materially weaker surname link than most of this batch's other candidates. The parents' given names (Manuel Melchiades / Manoel Melquiades, and Candida / Cândida Damasceno) match closely, and the record is from the same state (Rio Grande do Norte) and era as the tree's known daughter Maria Lila (b. 1901, d. 1995, Natal).
