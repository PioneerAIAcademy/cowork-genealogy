# Clara González Pimienta — a daughter Zulema de Jesús born November 1897, Pichilemu, Colchagua, Chile

**Source PID:** `GJVV-FHW`
**Clara González Pimienta is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 31 July 1867 and christened 2 August 1867 at Pumanque, Colchagua; daughter of Cayetano González Padilla and Antonia Pimienta Valenzuela. She married Benjamín Silva Díaz in 1894, and the tree carries two sons, both civil birth registrations in Colchagua: Saúl Antonio Silva González (born 18 September 1894) and Manuel Jesús Silva González (born 27 December 1895). Her parents' family is centred on Pumanque and Nancagua.

## Research question

> Clara González Pimienta, born 31 July 1867 at Pumanque, Colchagua, married Benjamín Silva Díaz about 1894, and two sons are known: Saúl Antonio (born 18 September 1894) and Manuel Jesús (born 27 December 1895), both registered in Colchagua. What other children did Clara and Benjamín have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GJVV-FHW` with relatives). Nothing was
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

**Resolved: true match.** The birth registration of Zulema de Jesús Silva González (Entry 184, 1897 civil registration register, Colchagua) was confirmed by reading the original image (`ark:/61903/3:1:939K-PNQ3-4`). The image shows the father's name as "Benjamín Silva y Díaz" and the mother's as "Clara González y Pimienta de Silva" — the same compound surnames seen across all five records for this family. The birth date "doce de Noviembre" (12 November 1897) and stated birth place "Aguada de San Antonio" are clearly legible. The declarant is Benjamín Silva, identified as the child's father and described as "known to the official" — the same phrase used in prior registrations for this family.

**Calibration (licensed).** Two other entries from the same civil registration register (Cáhuil, Colchagua, 1895–1896) were read and cross-checked against their FamilySearch index entries:
- Entry 12 (Juan Francisco Bernabé Silva González): birth date 27 December 1895, father Benjamín Silva Díaz, mother Clarisa González Pimienta de Silva — image matched index exactly.
- Entry 13 (Manuel Jesús Silva González): birth date 27 December 1895, same parents — image matched index exactly.

Both matched, licensing the reading of Entry 184 for child name, parents and date.

**Marriage record cross-check.** The marriage record names the groom's father's mother as Mercedes Díaz and the bride's mother as Antonia Pimienta, locking the compound surnames to this specific family and ruling out coincidental name matches.

**Place note.** The image states "Aguada de San Antonio" as the birth place, within the Pichilemu registration district, Colchagua. The FamilySearch index wrongly standardises this as "Petorca, Aconcagua"; the correct jurisdiction is Colchagua (now O'Higgins). The finding uses "Aguada de San Antonio, Colchagua, Chile" as stated in the record.
