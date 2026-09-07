# Joanni Jacobo Clotten — marriage to Maria Magdalena Weber, 30 June 1716

**Source PID:** `MZ13-TN6`
**Joanni Jacobo Clotten is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; father of two children christened at Boppard/Oberwesel, Rheinland in 1717 and 1720.

## Research question

> When did Joanni Jacobo Clotten marry the 'Mariae Magdalenae' the tree records as his wife, and what was her surname?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `MZ13-TN6` with relatives). Nothing was
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
(`filtered-list-samples-2.csv` row 23, `hint-samples.csv` row 719,
flag `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Deutschland, Rheinland, Bistum Trier, katholische Kirchenbücher, 1543-1958", a marriage entry of 30 June 1716 for Joannes Jacobus Klotten and Maria Magdalena Weber.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the 30 June 1716 marriage to a Maria Magdalena Weber, plus a `required` finding that the report documents
the rejection.

A strong candidate on chronology and on the shape of what it supplies. The tree records the wife as a bare **"Mariae Magdalenae"** with no surname at all — the state a register leaves behind when only baptismal entries have been read, since those name the mother by given name alone. The hint is the marriage that supplies the missing half: **Weber**.

The dates cooperate. A marriage on 30 June 1716 sits fifteen months before the first child's christening (Anna Maria, 3 October 1717) and rather less than four years before the second (Joannes, 8 February 1720) — an unremarkable interval either way. Clotten and Klotten are the same name; the tree's own sources already show the spelling drifting as far as "Dotten". And the collection is one the tree already cites twice, so the hint is not coming from an unrelated corner of the archive.

What to confirm: that the 1716 marriage is in the same parish as the 1717 and 1720 christenings — the tree places those at Boppard/Oberwesel, while the hint's index gives the diocese but not the parish. A Trier-diocese marriage forty kilometres away would be a different couple. It is a small check, and it is the whole check.
