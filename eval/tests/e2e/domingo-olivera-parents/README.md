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

**Resolved: answerable, but differently. The hint is a generation shift (issue #2317).**

The hint (persona `ark:/61903/1:1:QVJW-7HR1`, the father on record
`ark:/61903/1:1:QVJW-7HRB`) proposes Domingo Oliviery and Francisca Gonzalez as
the subject's parents. They are the subject himself and his own wife, read one
generation too high.

Retrieval was tool-assisted: `record_read`, `record_search` and the
FamilySearch image fetcher, run from the engine build against live
FamilySearch. The identity judgement is the reviewer's.

**Every finding rests on the FamilySearch index, not on an image reading.** All
three register images were viewed, but none can be calibrated. Each image holds
only one other acta:

- 1925 image `ark:/61903/3:1:9Q97-YSRS-ZH4`: acta 563, Virma Nereida Colón
  Martínez.
- 1926 image `ark:/61903/3:1:9Q97-YS6R-2GG`: acta 303, Timoteo Sierra Maisonet.
- 1902 image `ark:/61903/3:1:9Q97-YSX6-95F`: only the closing lines of the
  preceding acta.

That is fewer than the two indexed entries the calibration check needs, so
every reading of these pages is **unlicensed**. One unlicensed observation is
worth a future reviewer's look. On the 1925 page, clause 2 appears to void "y
Francisca González" with *digo*, and the declarant, Genoveva Martínez Pabón,
signs as "madre legítima". If so, the index's mother "Francisca González" is an
indexing error, which would explain the child's surname Olivera Martínez and the
maternal grandparents Eloy Martínez and Ubardina Pabón. No finding depends on
this.

**The 1925 hint record (index).** Carmen Ester Olivera Martínez was born
30 June 1925 at Vega Baja. The index gives:

- father: Domingo Olivera;
- paternal grandparents: Domingo Oliviery and Francisca Gonzalez;
- maternal grandparents: Eloy Martínez and Ubardina Pabón.

A father Domingo whose parents are a Domingo Olivera and a Francisca González is
the subject's son, **Domingo Olivera y González (GN52-SH9, b. 1897)**. The
subject's wife is Francisca González Maysonet (GN5K-L8W, b. about 1871), who
would have been about 54 at a 1925 birth. The tree already carries this record
(source `74KQ-ZKV`, cited from the grandfather persona `6T48-QDLZ`). So the hint
re-offers an attached source under the wrong role.

**The subject's actual parents (index).**

- **1902 birth, Ciales** (`ark:/61903/1:1:QVJQ-P1N7`). Juan Félix Olivera
  González, born 1 July 1902, is the tree's Felix (GN52-9LV, b. 1902).
  - Father: Domingo Olivera Albaladejo (`ark:/61903/1:1:DHD2-RYMM`).
  - Mother: Francisca, daughter of Victoriano Gonsalez and Carlina Maísonet.
    That matches the Maysonet surname of the subject's wife.
  - Paternal grandparents: **Juan José Olivera Rolón and Concepción
    Albaladejo**.
- **1926 death, Vega Baja** (`ark:/61903/1:1:QVJ3-6GZM`). Domingo Olivera
  Albaladejo died 24 August 1926.
  - Born 1856.
  - Spouse: Francisca González.
  - Parents: **José Olivera and Concepción Albaladejo**.

"Valadyo" in the tree (from the 1920 census) is a mis-transcription of
Albaladejo; the maternal surname agrees with Concepción. Two conflicts remain,
and neither breaks the identification:

- The death index's birth year of 1856 conflicts with 1867 from the census. A
  death-record age is informant-dependent.
- The father is "Juan José" in 1902 and "José" in 1926.

The two records agree on the wife's name, with her own parents named in 1902,
and on the family's move from Ciales to Vega Baja.

**Searched.** "Puerto Rico, Registro Civil, 1805-2002" (collection 1682798), for
Domingo Olivera with spouse Francisca González, and for Domingo Olivera born
1862–1872.

**The findings.**

- **f1 (required):** the subject's parents.
- **f2 (bonus, `required: false`):** the second half of the research question,
  that the 1925 father is the son. It is a bonus because recall is graded from
  the tree only. The tree can show it only if the agent adds the granddaughter
  Carmen under GN52-SH9, which is outside a parents question. A run that
  correctly concludes "it's the son" in `research.json` alone would otherwise
  fail.
- **f3 (`avoid`):** the hinted pair must not be asserted as the subject's
  parents.

**f3's mechanical guard names only the father, and is partial by
construction.** `apply_avoid_guard` matches ASCII name tokens from
`wrong_candidate.name`, which for f3 are `{domingo, oliviery}`. So it catches a
parent added as "Domingo Oliviery". Asserting the shifted pair requires
asserting the father, so naming him alone loses nothing. Francisca is left out
on purpose (the #2640 fix, as in #2855). The wife GN5K-L8W is legitimately in
the tree and is not exempt. A run that rewrote her surname unaccented
("Gonzalez Maysonet", as the 1925 index spells it) would otherwise force f3
false for doing nothing wrong. The guard misses "Domingo Olivera" (the surname
token is absent). It cannot be widened: adding `olivera` collides with
GN52-SH9, which would force f3 false on every run, a perfect one included (spec
§3.4). The judge's semantic grade still covers that spelling. Only the
deterministic backstop is partial.
