# Domingo Olivera Y Valadyo — parents named on a 1925 Vega Baja birth registration

**Source PID:** `GN5K-19C`
**Domingo Olivera Y Valadyo is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1867 in Puerto Rico; resident at Río Abajo, Vega Baja in 1920; death not recorded in the tree.

## Research question

> Who were the parents of Domingo Olivera y Valadyo (b. 1867), and is the Domingo Olivera named as a father on the 1925 Vega Baja birth registration of Carmen Ester Olivera Martínez this man or his son?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GN5K-19C` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 24, `hint-samples.csv` row 738,
flag `adds_father,adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Puerto Rico, Registro Civil, 1805-2002", the birth registration of Carmen Ester Olivera Martínez, born 30 June 1925 at Vega Baja, naming her parents as Domingo Olivera and Francisca González and her paternal grandparents as Domingo Oliviery and Francisca Gonzalez.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Domingo Oliviery and Francisca Gonzalez as his parents, plus a `required` finding that the report documents
the rejection.

Read the generations before reading the names. The hint proposes parents for the subject: Domingo **Oliviery** and Francisca **Gonzalez**, taken from the grandparent fields of a 1925 birth registration whose parents are Domingo Olivera and Francisca González. But the subject's own wife is **Francisca González Maysonet**, and his son **Domingo Olivera y Gonsález** was born in 1897. Line those up and the natural reading inverts the hint: the 1925 child is the *son's*, and the "grandparents" the index reports are the subject and his own wife — meaning the hinting engine has slid the subject down one generation and offered him his own household as parents.

Two more things point the same way. The subject's wife was born about 1871, which would make her about 54 at a June 1925 birth. And the subject's own recorded surname is **Olivera y Valadyo** — the Puerto Rican form naming his mother's surname as Valadyo, not González, which directly contradicts the hinted mother.

So the likely outcome is (c), with the `avoid` guard on Francisca Gonzalez-as-mother, and the reviewer should be ready to state what the tree's surname convention alone already establishes. Note the child's own surname, Olivera **Martínez**, does not agree with either Francisca either — the index has more than one problem, and the register page is the only way to sort it.
