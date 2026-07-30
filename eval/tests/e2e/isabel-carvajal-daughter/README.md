# Isabel Carvajal Chinchilla — additional daughter Juana (m. 1929)

**Source PID:** `LR2Y-X3H`
**Isabel Carvajal Chinchilla is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Isabel Carvajal Chinchilla and her husband Emilio Martínez of Santander, Colombia have a daughter named Juana, married 1929, in addition to their six known children (b. 1881-1895)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LR2Y-X3H` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — a confirmed true match; see "Notes for reviewers" below for the
corroboration that decided it.

## Notes for reviewers

**Resolved (issue #860): TRUE MATCH.** The hint — Colombia, Catholic Church Records, 1576-2019: marriage of Ismael Alvarez and Juana Martinez, 9 October 1929, Nuestra Señora de las Mercedes, Matanza, Santander, naming the bride's parents as "Emilio" and "Isabel Carvajal" — **does** establish Juana Martinez as a daughter of the tree couple Isabel Carvajal Chinchilla (`LR2Y-X3H`) and Emilio Martínez (`G5CM-DZW`), in addition to their children already in the tree.

What confirmed it (five converging lines, no conflicting evidence):
- **Both-parents couple match.** The record names both parents — Emilio and Isabel Carvajal — and the bride is surnamed Martinez, which independently confirms the father's surname (Martínez). A two-person couple match is far stronger than the lone given-name match the draft worried about.
- **Place consistency.** Every documented event for the couple's known children — two burials (1911) and two marriages (1923) — occurred at the same parish, Nuestra Señora de las Mercedes, Matanza, where this 1929 marriage took place. The family was demonstrably active in that exact parish in that era.
- **Behavioral pattern.** The couple married off Adelaida and Eugenio at that parish in 1923; a daughter marrying there in 1929 continues the pattern.
- **Chronological fit.** The known children were born ~1881–1895, so a daughter of marriageable age in 1929 fits with no timeline strain.
- **No competing candidate.** A targeted search of Santander records for any child of an Emilio × Isabel Carvajal couple returned only this marriage (indexed twice from the same register page). There is no second Emilio Martínez / Isabel Carvajal couple in the region the record could belong to instead.

With five independent points converging and zero conflicting evidence, acceptance is the sound conclusion; rejecting it would require positing an otherwise-invisible duplicate couple in the same parish. `expected-findings.json` keeps its original finding: Juana Martinez, who married Ismael Alvarez on 9 Oct 1929 at Matanza, is a daughter of this couple.
