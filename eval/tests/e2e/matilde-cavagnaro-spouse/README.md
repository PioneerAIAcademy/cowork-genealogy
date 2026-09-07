# Matilde Carmela Emanuela Cavagnaro — husband Pietro Dondero and a daughter born 1883 at Genova

**Source PID:** `G4Z4-RJ1`
**Matilde Carmela Emanuela Cavagnaro is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1866 in Lima, Peru, to Ligurian parents; death not recorded in the tree.

## Research question

> Was the Carmela Cavagnaro who bore a daughter, Maria Clementina Angelica Gentile Dondero, at Genova on 30 August 1883 with Pietro Dondero the same woman as Matilde Carmela Emanuela Cavagnaro, born 1866 in Lima?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G4Z4-RJ1` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 21, `hint-samples.csv` row 640,
flag `adds_spouse,adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Italia, Genova, Genova, Stato Civile (Tribunale), 1866-1929", a birth entry of 30 August 1883 at Genova for Maria Clementina Angelica Gentile Dondero, naming parents Pietro Dondero and Carmela Cavagnaro.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Pietro Dondero as her husband and the 1883 daughter as hers, plus a `required` finding that the report documents
the rejection.

The name fits and the age is the question. The subject's own third given name is Carmela and her surname is Cavagnaro, so "Carmela Cavagnaro" is a form she could plausibly be registered under, and the family's records are Genovese throughout even though she was born in Lima. But a daughter born 30 August 1883 makes her **17** at the birth — legal and not rare in 1880s Liguria, yet young enough that it has to be established rather than assumed, and no marriage to a Dondero appears anywhere in the tree.

The weight against is that Carmela Cavagnaro is an ordinary Ligurian name in the one city where the surname is commonest. The index gives the mother no age, no patronymic and no birthplace, so nothing in the hint itself distinguishes this Carmela from any other.

The reviewer should also resolve a defect in the tree first: the subject is given **two sets of parents** — Giuseppe Cavagnaro and Maddalena Boitano, and Angelo Vaglio and Maria Fereccio — with no indication which is right, and one of the tree's four sources belongs to a Paolo Andrea Vaglio. Until that is settled the tree cannot be used to confirm or refute anything about her.

Note for the corpus: the batch CSV labels this row Peru because she was born in Lima; every record involved is Genovese.
