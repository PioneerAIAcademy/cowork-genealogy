# Inocencio Gonzales — a daughter Juana baptised in July 1895, Sacaca, Potosí, Bolivia

**Source PID:** `GY75-S9D`
**Inocencio Gonzales is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no dates or places for him. He is known only as the father named on two Potosí marriages of a daughter Victoria: to Severino Cruz on 7 May 1905 (bride born about 1887, mother indexed Antonia Elsaque) and to Evaristo Mamani Inuca on 13 October 1914 (bride born about 1886, mother indexed Antonia Uraque). The tree holds these as two wives (Antonia Elsaque `PSPZ-47D`, Antonia Uraque `P9BB-7GZ`) and two daughters Victoria (`PSPZ-CLD`, `GY75-7TJ`), which are very likely one wife and one daughter each. An Antonia Uraque born about 1853 also married Antonio Gonzales in Potosí on 31 October 1903; the tree attaches that entry to `P9BB-7GZ`.

## Research question

> Inocencio Gonzales (also Gonzalo) and his wife Antonia Uraque (also indexed Elsaque) are known from their daughter Victoria's Potosí marriages of 1905 and 1914, which give her birth as about 1886. What other children did Inocencio and Antonia have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GY75-S9D` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 2, `hint-samples.csv` row 91,
flag `adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Bolivia, Catholic Church Records, 1566-2020", the baptism of Juana Gonsalo, born 19 July 1895 and baptised 21 July 1895 at Sacaca, Alonzo de Ibáñez, Potosí, naming her parents as Inocencio Gonsalo and Antonia Araque.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Juana as Inocencio's daughter, plus a `required` finding that the report documents
the rejection.

A plausible candidate on names. The father's given name is uncommon and his surname is spelled Gonzalo on the 1905 entry, which is the hint's spelling. The mother's surname, Araque, sits within the spread the tree's own two entries already show for her (Uraque, Elsaque). Juana would be about nine years younger than Victoria. Both tree records are Potosí marriages, and Sacaca is in Potosí department. The tree holds no baptism for any child, so this is not a re-index of an existing source.

Two things weaken it. First, the tree's sources give no parish for the marriages. They are indexed only as "Bolivia", so nothing yet puts the family in Sacaca rather than elsewhere in Potosí, and Gonzalo/Gonzales is a common surname. Second, the tree's 1853 birth year for Antonia Uraque comes from her 1903 marriage to Antonio Gonzales. If that bride is the subject's wife, she was about 42 at a July 1895 birth, which is late but possible. It would also mean Inocencio died before October 1903. That woman may be someone else, though, which would leave the mother's age open.

The discriminating check is the parish on the register images of the 1905 and 1914 marriages already in the tree. If either was celebrated at Sacaca (San Luis de Sacaca), the hint is very likely right. A parish elsewhere in Potosí makes a namesake couple the live alternative, and a search of the Sacaca baptisms for other children of Inocencio and Antonia would decide it.
