# Rafael Reyes — daughter Rita (b./d. 1913)

**Source PID:** `MTNY-RXQ`
**Rafael Reyes is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Rafael Reyes and his wife Serapia Benavides Cueva of Usulután, El Salvador have a daughter named Rita, born and died in 1913?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `MTNY-RXQ` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 16, flag `adds_daughter`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — El Salvador, Civil Registration, 1704-2001: death registration, 22 July 1932, Santa Elena, Usulután, for Rita Reyes (b./d. Jan 1913), naming parents Manuel Rafael Reyes and Serapia Benavides. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming Rita Reyes as the subject's daughter, plus a `required` finding that the report documents the rejection.

**Strong reason to doubt this match**: the tree records Rafael Reyes's marriage to Serapia Benavides Cueva as **19 January 1860** in Usulután. A daughter born in **1913** would be 53 years after that marriage — an implausible span for a single couple, and far more consistent with a grandson or great-grandson bearing the same repeated family names ("Rafael Reyes" + "Serapia Benavides" recurring in the same small Salvadoran community across generations is entirely plausible). The hint record's father is also named with a middle name, "**Manuel** Rafael Reyes", which the tree's "Rafael Reyes" does not carry — consistent with this being a different, later man of the same family. This fixture is a strong candidate for outcome (c) (false match, most likely a different, later generation) but is left as a recover-type draft finding pending the genealogist's review.
