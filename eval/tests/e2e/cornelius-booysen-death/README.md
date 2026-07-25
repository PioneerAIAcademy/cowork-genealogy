# Cornelius Hermanus Zacharias Booysen — death in the Transvaal

**Source PID:** `GWDS-CKP`
**Cornelius Hermanus Zacharias Booysen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1906; died not recorded in the tree.

## Research question

> When and where did Cornelius Hermanus Zacharias Booysen of Pretoria, Transvaal, South Africa die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GWDS-CKP` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 30, flag `adds_death`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — South Africa, Transvaal, Probate Records from the Master of the Supreme Court, 1869-1961: entry for Cornelis Hermanus Zacharias Booysen, place Transvaal, South Africa (no date in the indexed extract). The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the full name "Cornelis/Cornelius Hermanus Zacharias Booysen" is distinctive (four given/family name elements), making a same-name coincidence less likely than for the batch's more common names. The tree records his birth as 1906 and marriage as 1930 in Pretoria, Transvaal — the same province as the probate record, though the FamilySearch API extract captured no death date for this record, only the bare place. The agent researching this fixture would need to consult the underlying probate file (likely via `image_read` or `record_read` with fuller detail) to recover an actual date; this fixture may be better suited to testing whether the agent can locate and read through to that date rather than treating the bare hint as the full answer.
