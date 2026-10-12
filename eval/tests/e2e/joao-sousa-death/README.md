# João Gomes de Sousa — death in December 1919, Câmara de Lobos, Madeira, Portugal

**Source PID:** `GLRZ-VRK`
**João Gomes de Sousa is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 13 October 1851 in Câmara de Lobos, Madeira; the tree carries an undated Death fact. Son of João Gomes de Sousa (1811–1890) and Maria Corrêa Henriques (died 1892); the tree marries him to Ana Augusta de Jesus on 30 April 1865 in Câmara de Lobos.

## Research question

> When and where did João Gomes de Sousa, born 13 October 1851 in Câmara de Lobos, Madeira, son of João Gomes de Sousa and Maria Corrêa Henriques, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GLRZ-VRK` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 20, `hint-samples.csv` row 698,
flags `adds_death,adds_burial`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Portugal, Registro Civil, 1437-2023", a death entry for João Gomes de Souza, son of João Gomes de Souza and Maria Barria Henriques, in Câmara de Lobos, Madeira; the entry is dated 14 December 1919 and the index gives the death date as "hoje" (today), with burial in Câmara de Lobos.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the December 1919 death, plus a `required` finding that the report documents
the rejection.

A strong candidate on the parents, silent on the person. The place is his home parish, the father's name matches the tree's João Gomes de Sousa (GPZT-LZN), and "Maria Barria Henriques" is very likely a misreading of the tree's Maria Corrêa Henriques: the tree's own index entries for her read "Porrea", "Carrea" and "Comea". A 1919 death would make him 68. None of the subject's 17 record citations is dated 1919: the dated civil-register ones are his 1865 marriage (`ark:/61903/1:1:X911-WXWP`), entries of 1888–1905 for his children, and one of 1961, so this is not a re-index of anything already in the tree.

The parent match does not single him out. The same couple had an older son João Antonio de Sousa (L2B6-R63, born 1839), whose death is also undated, and the index gives no age, spouse or marital status. The tree also has a problem of its own that points the same way: it marries the 1851 João to Ana Augusta de Jesus in April 1865, when he was thirteen, so it may already be merging the two brothers. The `adds_burial` flag adds a place with no date. The discriminating check is the register image linked from the hint record: a Portuguese civil death act states the deceased's age and marital status and names the spouse. An age near 68 settles it for the 1851 João; an age near 80 makes it João Antonio's death.
