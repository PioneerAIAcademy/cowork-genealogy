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

**Resolved: false match.** This hint does not belong to Victoriano Macatangay
(GV6J-VZC). The christening record's grandparent-relationship entries name
José Macatangay and Bernardina Cabrera as grandparents of the child Miguel —
and those two names are already recorded, on FamilySearch, as the parents of
a *different* existing tree person, PM25-VHQ, a distinct "Victorino/Victoriano
Macatangay." That match is exact where GV6J-VZC's is nonexistent: GV6J-VZC
has no parents on file at all, and a direct review of his own FamilySearch
profile (Vitals and Sources tabs) found Birth and Christening both unfilled,
with none of his 16 attached sources (1920-1949) naming a parent. No fresh
search of the Philippines Catholic Church Records collection was run for this
fixture — the negative evidence is the absence of any parent claim on his
existing profile, not an executed search that came back empty.

The record itself (ark:/61903/1:1:6664-TBR7) is unusually structured for this
batch — rather than a simple parent-child baptismal entry, it carries several
`http://familysearch.org/types/relationships/Grandparent` entries connecting
José, Bernardina Cabrera, Domingo, and María Dapal directly to the child
Miguel, alongside the ordinary parent-child chain through Victorino and
Gabina. That structure is what makes the mismatch visible: FamilySearch's own
matching resolves the grandparent links to PM25-VHQ's already-documented
parents, not to GV6J-VZC. The surface-level similarities that made this hint
plausible — "Gabina Sisquinto" matching the tree's "Gabina
Singamuto"/"Gabina Sinquino," the "Macatangay"/"Makatangay" surname, and a
1915 birth fitting among GV6J-VZC's six known children (1904-1929) — turn out
to describe a second, same-named "Victoriano Macatangay" (PM25-VHQ), not this
fixture's subject.
