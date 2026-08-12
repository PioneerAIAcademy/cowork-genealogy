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

**Resolved: true match, with a re-cited birth record (re-adjudicated under issue #1346).**

The daughter is real and the parentage holds. Her 1819 confirmation entry
(`ark:/61903/1:1:QG8V-2DDT`) independently names her parents as Birte Kirstine
Sørensd and Christen Nielsen — the same couple (the patronymic-era spelling
"Christen" is the same given name as "Chresten" elsewhere in this family's
records) — and carries the birth year 1805. A birth in 1805 fits neatly after
the youngest child already in the tree (Rasmus, b. 1801, died in infancy) — a
gap of four years, plausible for a couple married in 1790.

**What changed and why.** The original resolution leaned on "two independent
record types (baptism and confirmation), agreeing on both parents' names and
place." Only the confirmation half survives. The christening citation
(`ark:/61903/1:2:W6M7-SWMM`, transcribed as a 6 Oct 1805 Tyrsted christening)
is **fabricated** — a live `record_read` returns a United States WWI Draft
Registration Card for Myrtle B Jackson (b. 1876, Colorado), nothing to do with
this family. It has been removed as a source, and the day/month/place christening
claim it alone supplied has been dropped from the finding.

The specific birth date and place — **3 August 1805, Dallerup** — is now sourced
to a directly-read original church book: the 1805 Dallerup parish register ("Anno
1805"), row `Aug.3 | Dallerup | Birte | Chresten Nielsen og Birte Kirstine`,
FamilySearch DGS `007226375`, image `00232`. The confirmation record carries only
the birth *year*, so this image reading is what establishes the day, month, and
parish. A `fulltext_search` scoped to image group 007226375 for Birte / Dallerup /
Tyrsted returned zero results — the volume is not full-text indexed, so no
resolvable `ark:/61903/3:1:...` exists for the page; it is cited by image ID. The
literal-ark requirement (issue #970) is satisfied by the confirmation record's
`ark:/61903/1:1:QG8V-2DDT`.
