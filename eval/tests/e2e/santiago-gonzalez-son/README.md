# Santiago Gonzalez — additional son Manuel (b. 1915)

**Source PID:** `G6MR-VHF`
**Santiago Gonzalez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Santiago Gonzalez and his wife Petra Tumbaco of Guayaquil, Ecuador have a son named Manuel de Jesus, born 1915, in addition to their two known daughters (b. 1921 and 1934)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G6MR-VHF` with relatives). Nothing was
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

**RESOLVED — false match.** This fixture came from a hint batch
(`filtered-list-samples.csv` row 15, flag `adds_son`, confidence 3) in which
roughly half the hint records are false matches. After review the genealogist
ruled this one a **false match**: the hinted son should NOT be added to the
tree.

The evidence: the hint (`ark 8DNC-SB6Z`) is only the *Santiago Gonzalez
father-persona* of a single Ecuadorian cemetery entry for Manuel de Jesus
Gonzalez Tumbaco (b. 1915, d. 5 Dec 1985). The two arks a reviewer might take
for corroboration — `8DNC-SBZM` (the deceased) and `8DNC-SBN2` (mother "Petita
Tumbaco") — are the other two personas of that **same one record** (same
citation, same image waypoint `3QHV-D3C4-M7WX`), not independent sources. So
the entire case rests on one record.

What decided it: the mother is recorded as **"Petita Tumbaco"**, which is a
*distinct given name*, not a documented variant of the tree wife's name
**"Petra"** (Petra is the feminine of Peter; Petita is not the same name).
Manuel does not appear among the tree person's recorded children, and no
independent record ties him to this couple. The superficial pulls the other
way — surname "Tumbaco" and father "Santiago Gonzalez" match, the children's
compound surname "Gonzalez Tumbaco" fits Ecuadorian paterno+materno naming, and
b. 1915 would slot Manuel in ahead of the two known daughters (1921, 1934) — but
a single cemetery record with a mismatched mother's name is not enough to add a
child, and nothing else was found to close the gap.

`expected-findings.json` therefore carries a `required` `polarity: "avoid"`
guard against asserting Manuel as Santiago's son (f1). Documenting the
rejection as a durable negative conclusion (f2) is credited but **not
required**: a run that correctly declines the hint but reports the rejection
only in chat — without persisting a negative conclusion the final
tree/research cannot durably represent — still passes on f1 alone. f2 gates
nothing; it is bonus credit for the good-practice write-up.
