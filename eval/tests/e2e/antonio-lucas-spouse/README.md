# Antonio Fernandes Lucas — a second wife, Antonia de Jesus?

**Source PID:** `GK89-82B`
**Antonio Fernandes Lucas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1838, Santo António, Funchal, Madeira, Portugal; died not recorded in the tree.

## Research question

> Did Antonio Fernandes Lucas of Funchal, Madeira have a wife named Antonia de Jesus, distinct from his tree-recorded wife Maria Joana (m. 1890), and a daughter named Maria who died young?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GK89-82B` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 27, flags `adds_spouse`/`adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Portugal, Registro Civil, 1437-2023: death registration for Maria (b. Jul 1894, Santo António, Funchal, Madeira), naming parents Antonio Fernandes Fernandes Lucas and Antonia de Jesus de Jesus. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Antonia de Jesus de Jesus as a wife of the subject, plus a `required` finding that the report documents the rejection.

**Strong reason to doubt this match**: the tree already records Antonio Fernandes Lucas married to **Maria Joana** on 8 February 1890, with two children (Antonio b. 1896, Julia b. 1899). The hint record instead pairs him with an entirely **different** wife, "Antonia de Jesus de Jesus", and a daughter "Maria" born 1894 — squarely in the middle of his documented marriage to Maria Joana, yet naming a different mother. "Antonio Fernandes Lucas" (and the doubled-surname variant "Fernandes Fernandes Lucas", a known Portuguese patronymic-doubling quirk) is a common name combination in the small parish of Santo António, Funchal, raising real odds that this record belongs to a different man of the same name. This fixture is a strong candidate for outcome (c) (false match) but is left as a recover-type draft finding pending the genealogist's review; the daughter finding is marked `required: false` given it rides entirely on the more doubtful spouse claim.
