# Anna Marie Findejsová — additional daughter Agnes (b. 1818)

**Source PID:** `P915-7QP`
**Anna Marie Findejsová is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
13 March 1784, Bystré, Polička, Bohemia; died not recorded in the tree.

## Research question

> Did Anna Marie Findejsová and her husband Maxmilián Michl have a daughter named Agnes, born 1818, in addition to their daughter Anna (b. 1823)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `P915-7QP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 4, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Czech Republic, Church Books, 1552-1981: baptismal entry, 1 March 1818, Svitavy, Moravská Třebová, naming parents Maxmilian Michal and Anna. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1818 Agnes baptism, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the tree's spouse is recorded only as "Maxmilián Michl" (surname spelled without the hint record's "Michal"/"Michalová" variant) with no forename for the mother in the hint record beyond "Anna" — a first-name-only match against a subject whose full name is Anna Marie Findejsová. The tree's only other child, Anna Michlová, was born 16 September 1823 in the same parish (Bystré/Svitavy area) and died in infancy (1833) — a second daughter born five years earlier, in 1818, is chronologically plausible for a couple of Anna Marie's generation (b. 1784) but rests on a bare-forename match with no surname or patronymic corroboration in the extracted record.
