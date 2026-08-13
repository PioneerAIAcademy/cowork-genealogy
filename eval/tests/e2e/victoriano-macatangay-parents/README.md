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

**Resolved: true match.** The hint record —
Philippines, Catholic Church Records, 1520-2014: christening entry,
16 October 1915, Batangas City, for Miguel Macatangay Sisquinto, naming
parents Victorino Macatangay and Gabina Sisquinto, and (via indirect
grandparent-type relationship entries in the record) grandparents José and
Bernardina Cabrera
(https://familysearch.org/ark:/61903/1:1:6664-TBR7) —
does belong to Victoriano Macatangay (`GV6J-VZC`), and the three draft
findings (father José, mother Bernardina Cabrera, additional son Miguel)
are confirmed as written.

The record is unusually structured for this batch — rather than a simple
parent-child baptismal entry, it carries several
`http://familysearch.org/types/relationships/Grandparent` relationship
entries connecting José, Bernardina Cabrera, Domingo, and María Dapal
directly to the child Miguel, alongside the ordinary parent-child chain
through Victorino and Gabina. That structure raised a real question of
whether the record instead belonged to a different, similarly-named person
(`PM25-VHQ`) — enough that an earlier resolution attempt attached it there.
That attempt did not hold up: the confirming comparison is between the two
baptisms of Victoriano's own children — the 1905 baptism of Mariano
Macatangay (christened 26 March 1905) already attached to `GV6J-VZC` in the
tree, and this 1915 baptism of Miguel Macatangay Sisquinto — both in
Batangas City. Victorino, the father on both, matches Victoriano/`GV6J-VZC`
on every identifier available: the same accepted name spelling, the same
town, and the same wife-pairing already tied to his four other known
children, with nothing in either record pointing toward `PM25-VHQ` instead.
The wife's name "Gabina Sisquinto" also matches the tree's
"Gabina Singamuto"/"Gabina Sinquino" (the tree itself records two spellings
for her), the surname "Macatangay"/"Makatangay" matches, and the 1915 birth
fits neatly among the tree's six known children (1904-1929).
