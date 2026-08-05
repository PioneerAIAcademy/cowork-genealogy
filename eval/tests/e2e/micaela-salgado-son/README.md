# Micaela Salgado — additional son Guillermo (b. 1889)

**Source PID:** `9XGG-PW4`
**Micaela Salgado is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1854, Tegucigalpa, Honduras; died not recorded in the tree.

## Research question

> Did Micaela Salgado of Tegucigalpa, Honduras have a son named Guillermo, baptized 1889, in addition to her two known daughters (b. 1874 and 1884)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9XGG-PW4` with relatives). Nothing was
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

**Resolved: true match.** Guillermo Salgado, baptized 20 October 1889 in San
Miguel, Tegucigalpa (Honduras, Catholic Church Records, 1633-1978), is a son of
the subject Micaela Salgado (`9XGG-PW4`), in addition to her two daughters
already in the tree (Raimunda b. 1874, Maria Norberta b. 1884). The
`expected-findings.json` transcribed from the hint record stands as written.

What decided it:
- **The record is already attached to Micaela** (`9XGG-PW4`) on FamilySearch —
  the hint has been confirmed as a source, not just a machine-matched guess.
- **Place matches exactly.** The 1889 baptism is in the same parish
  (San Miguel, Tegucigalpa, Francisco Morazán) as Micaela's two known daughters.
- **No father recorded is consistent, not contradictory.** The tree records no
  spouse for Micaela, and the baptismal entry names no father — an internally
  consistent single-mother pattern.
- **Chronology fits.** An 1889 birth falls neatly after the two known daughters
  (1874, 1884) as a later child.

The one risk weighed at draft — a different same-named Micaela Salgado in the
same parish, since the surname alone can't be cross-checked against a father —
was resolved by the record already being attached to this specific person and
by the exact parish + chronological fit against her known children.
