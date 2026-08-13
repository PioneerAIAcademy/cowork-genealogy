# Victoriano Macatangay — parents and additional son Miguel (b. 1915)

**Source PID:** `GV6J-VZC`
**Victoriano Macatangay is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Who were the parents of Victoriano Macatangay of Batangas, Philippines, and did he and his wife Gabina Sisquinto have a son named Miguel, born 1915, in addition to their six known children?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GV6J-VZC` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 26, flags `adds_father`/`adds_mother`/`adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Philippines, Catholic Church Records, 1520-2014: christening entry, 16 October 1915, Batangas City, for Miguel Macatangay Sisquinto, naming parents Victorino Macatangay and Gabina Sisquinto, and (via indirect grandparent-type relationship entries in the record) grandparents José and Bernardina Cabrera. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the record is unusually structured for this batch — rather than a simple parent-child baptismal entry, it carries several `http://familysearch.org/types/relationships/Grandparent` relationship entries connecting José, Bernardina Cabrera, Domingo, and María Dapal directly to the child Miguel, alongside the ordinary parent-child chain through Victorino and Gabina — a reviewer should confirm which persons are genuinely Victoriano's parents versus his wife's, since the indirect grandparent links could reflect a merged or over-linked FamilySearch index rather than a single clean source. In favor: the wife's name "Gabina Sisquinto" matches the tree's "Gabina Singamuto"/"Gabina Sinquino" (the tree itself records two spellings for her), the surname "Macatangay"/"Makatangay" matches, and a 1915 birth fits neatly among the tree's six known children (1904-1929).
