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

**Resolved: true match.** The birth registration of Zulema de Jesús Silva González (Entry 184, 1897 civil registration register, Colchagua) is confirmed from the index: both parents are named as Benjamín Silva Díaz and Clara González Pimienta, with birth date 12 November 1897 in the Pichilemu registration district, Colchagua. The compound surnames match the tree person across all known records for this family.

**Marriage record cross-check.** The marriage record names the groom's father's mother as Mercedes Díaz and the bride's mother as Antonia Pimienta, locking both compound second surnames to this specific family and ruling out coincidental name matches.
