# Chresten Nielsen — additional daughter Birte (b. 1805)

**Source PID:** `KN3K-9Q3`
**Chresten Nielsen is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1760, of Bjerre, Vejle, Denmark; died not recorded in the tree.

## Research question

> Did Chresten Nielsen and his wife Birte Kirstine Sørensdatter of Tyrsted, Vejle, Denmark have a daughter named Birte, born 1805, in addition to their nine known children (b. 1791-1801)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `KN3K-9Q3` with relatives). Nothing was
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

**Resolved: true match.** Both parents' names match exactly (Chresten Nielsen and Birte Kirstine, the tree's spouse being christened "Birte Kirstine Sørensdatter"), the parish (Tyrsted, Vejle) matches every one of the couple's nine other children exactly, and a birth in 1805 fits neatly after the youngest child already in the tree (Rasmus, b. 1801, died in infancy) — a gap of four years, plausible for a couple married in 1790.

Beyond the original 1805 Tyrsted christening entry, a separate confirmation record for Birte Christensdatter independently names her parents as Birte Kirstine Sørensdatter and Christen Nielsen — the same couple (the patronymic-era spelling "Christen" is the same given name as "Chresten" elsewhere in this family's records) — and gives the same location. Two independent record types (baptism and confirmation), agreeing on both parents' names and place, is strong corroboration. The findings in `expected-findings.json` stand as transcribed.
