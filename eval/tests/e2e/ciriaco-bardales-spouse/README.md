# Ciriaco Bardales — an earlier partner, Carmen Morales, and an infant son who died in 1905

**Source PID:** `KNYF-2Z8`
**Ciriaco Bardales is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1870, Quezaltepeque, Chiquimula; died 11 April 1933, Guatemala.

## Research question

> Before his marriage to Clara Amelia Palacios Oliva, did Ciriaco Bardales have a son by a Carmen Morales — an infant Ciriaco who died 12 August 1905 in Guatemala City?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KNYF-2Z8` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 14, `hint-samples.csv` row 422,
flag `adds_spouse,adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Guatemala, Guatemala, Registro Civil, 1874-2008", a death registration of 13 August 1905 for an infant Ciriaco Bardales, born 1905 and died 12 August 1905, naming parents Ciriaco Bardales and Carmen Morales.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Carmen Morales as an earlier partner and the 1905 infant as his son, plus a `required` finding that the report documents
the rejection.

Chronologically this fits and evidentially it is unsupported, which is the interesting combination. The subject was born in 1870 and married Clara Amelia Palacios Oliva in 1906/1907; an infant born and dead in August 1905 would sit in the gap before that marriage, when he was 35. Nothing in the record is impossible.

The problem is that this man is unusually well documented — the tree carries **29 sources**, spanning three Guatemalan civil-registration collections and the diocesan records, covering nine children from 1907 to 1929 — and not one of them mentions a Carmen Morales or an earlier child. A hint that proposes a whole prior relationship for a heavily-sourced subject, on the strength of one infant death registration, deserves the sceptical read first.

What the reviewer has to rule out is a second Ciriaco Bardales in Guatemala City. The name repeats inside this family — a son born in 1924 is Ciriaco de Jesús Bardales Palacios — which is evidence that it repeats in the wider surname group too. The registration gives no age or residence for the father, so the discriminator will have to come from the register page itself.
