# Lucia Skora — parents named on an 1807 Przecław baptism

**Source PID:** `LHBJ-WSN`
**Lucia Skora is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth or baptism. She married Laurentius Skrzypek on 12 November 1832; six children of the couple were baptised at Przecław (then Galicia, now Podkarpackie, Poland) between 1833 and 1846, and she appears as their mother, indexed as Skora, Skura, Skara and Skóra, and again as godmother in 1851 and 1856. The tree names no parents for her.

## Research question

> Who were the parents of Lucia Skora, who married Laurentius Skrzypek on 12 November 1832 and bore him six children baptised at Przecław, Poland, between 1833 and 1846?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LHBJ-WSN` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 21, `hint-samples.csv` row 684,
flags `adds_father,adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Poland, Tarnow, Roman Catholic Diocese Church Books, 1612-1900", the baptism of Lucia Skora at Przecław on 13 November 1807, daughter of Antonius Skora and Elisabeth Skrownionka. The index gives no birth date, godparents or house number.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Antonius Skora and Elisabeth Skrownionka as her parents, plus a `required` finding that the report documents
the rejection.

A plausible candidate on name and place. Same given name and surname, same parish, and an 1807 baptism makes her about 25 at the 1832 marriage and 39 at the last child's baptism in 1846 — ordinary ages. None of the subject's ten attached sources is her own baptism or her marriage; every one is a child's baptism or a godparent entry from 1833 to 1856, so this is not a re-index of anything already in the tree.

The gap is that nothing in the index ties the 1807 infant to the 1832 bride beyond the name, and Skóra is a common surname in the Mielec area, so a second Lucia Skóra baptised at Przecław within a few years is a live alternative the index alone cannot exclude. The discriminating check is the 1832 Przecław marriage entry for Laurentius Skrzypek and Lucia Skóra: Galician registers of this period usually state the bride's age and parents. A bride of about 25 who is a daughter of Antonius Skóra and Elisabeth (Skrownionka) settles it; different parents make this a different Lucia. The Austrian-format baptism registers of her own children from 1833 on may also name the mother's parents, and are a second route if the marriage is not indexed.
