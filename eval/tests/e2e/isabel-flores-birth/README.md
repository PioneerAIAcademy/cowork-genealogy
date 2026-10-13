# Isabel Flores — birth in July 1880, San Pablo, Laguna, Philippines

**Source PID:** `GCNR-K3J`
**Isabel Flores is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her — no birth. Parents Apolonio Flores and Catalina Ortiz (undated). Husband Fermin Barleta, born 6 July 1878 and baptized in San Pablo City, Laguna; children Aproniano (1904), Cesario (baptized 29 February 1908) and Florentina (baptized 28 March 1911), all of San Pablo.

## Research question

> When and where was Isabel Flores born, the wife of Fermin Barleta (born 1878) and mother of Aproniano (1904), Cesario (1908) and Florentina (1911) Barleta of San Pablo, Laguna, Philippines?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GCNR-K3J` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 19, `hint-samples.csv` row 660,
flags `adds_birth,adds_christening`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Philippines, Catholic Church Records, 1520-2014", a baptism entry from the parish of San Pablo (Saint Paul the First Hermit), Laguna, for Isabel Flores, born 7 July 1880 and baptized 11 July 1880, daughter of Policronio Flores and Catalina Ortiz; it also names paternal grandparents Florentino Flores and María Gulaglay, maternal grandparents Antonio Ortes and Rita Gusmán, and godmother Paula Ortiz.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the July 1880 San Pablo baptism, plus a `required` finding that the report documents
the rejection.

A real candidate with one named conflict. For it: same parish as every baptism in the family, the mother is Catalina Ortiz exactly as in the tree, and a girl born in July 1880 is a natural wife for a man born in July 1878 who started having children in 1904. Against it: the tree's father is Apolonio, not Policronio, and that name comes from two separate entries — the maternal-grandfather lines on Cesario's 1908 baptism (`ark:/61903/1:1:66X7-T1CZ`) and Florentina's 1911 baptism (`ark:/61903/1:1:66NS-KNYT`), both indexed "Apolonio" with no surname. Neither is a re-index of this 1880 entry. The flags carry no `adds_father`, because the tree already has a father, so the hint was proposed despite the clash.

Two readings fit the evidence. Either the 1880 priest wrote Policronio and the later registers (or their indexers) shortened or garbled it, which is possible since both names end in "-onio"; or this Isabel is a cousin — another Flores couple whose wife was also a Catalina Ortiz — and the tree's Isabel was baptized elsewhere in the register. The discriminating check is the marriage entry of Fermin Barleta and Isabel Flores (San Pablo, about 1900–1903), which names the bride's parents and usually her age: a father named Policronio settles it for the hint; a father Apolonio, or an age well away from 1880, points to another baptism.
