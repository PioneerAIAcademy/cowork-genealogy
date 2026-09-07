# Francis Maria Fisher — husband Alfred George Holding (m. 1895)

**Source PID:** `LZZ9-YL3`
**Francis Maria Fisher is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 23 July 1871, Hobart, Tasmania; died 24 January 1940, Hobart.

## Research question

> Did Francis Maria Fisher of Hobart, Tasmania (b. 1871) marry Alfred George Holding, and if so when?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LZZ9-YL3` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 2, `hint-samples.csv` row 23,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Australia, Marriages, 1810-1980", an 1895 marriage entry for Alfred George Holding (b. 1871) and Frances Maria Fisher (b. 1872).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 1895 marriage to Alfred George Holding, plus a `required` finding that the report documents
the rejection.

The strongest candidate in the batch on internal evidence. The tree already attaches a daughter surnamed **Holding** — Frances Holding, b. about 1898 in Hobart, d. 14 July 1918 — to Francis Maria Fisher with no father recorded anywhere. A marriage to a Holding three years before that birth is exactly what the dangling surname predicts, and the tree records no husband to compete with it. Francis/Frances and the one-year birth-year difference (1871 vs 1872) are routine index variance.

The caution is that this collection is a name-only index: it gives no place beyond "Australia", no parents, and no registration number. Confirm the Tasmanian registration itself before treating the identification as settled — Holding is not a rare surname, and the tree's Tasmanian civil-registration sources should make the check cheap.
