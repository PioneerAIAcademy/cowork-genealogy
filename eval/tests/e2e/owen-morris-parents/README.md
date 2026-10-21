# Owen Morris — parents named as John and Dorothy Morris in the 1871 Cardiganshire census

**Source PID:** `GWWN-XP9`
**Owen Morris is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1859 in Montgomeryshire (the 1911 census says Newtown); a roller leather finisher in 1891 and an antique furniture collector by 1911, living at Cyfoeth-y-brenin (Borth), Cardiganshire. Married Ellen Elizabeth (born about 1864, Dolgellau, Merionethshire) in 1882; four children in the tree — Thomas Rowley (1890), George Trevor (1893), Gladys (1897) and Douglas Owen (1900). The tree names no parents for him.

## Research question

> Who were the parents of Owen Morris, born about 1859 (Newtown, Montgomeryshire, per the 1911 census), a roller leather finisher and later antique furniture collector in Cyfoeth-y-brenin (Borth), Cardiganshire, who married Ellen Elizabeth in 1882?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GWWN-XP9` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-10-21 (#3632): answerable, but differently (outcome 2). The hint is a different boy.**
The hint, `ark:/61903/1:1:V555-VPP`, is an Owen Morris aged about 12 in the 1871
census at Lower Llanbadarn-y-Croyddin, Cardiganshire, a farmer's son of John Morris
(b. ~1818 Llanilar) and Dorothy (b. ~1825 Llanfihangel), born at **Llanbadarn-Fawr,
Cardiganshire**. The tree person was born in **Montgomeryshire**, and the records
that place him there also name his father:

- **1891 census, Cyfoeth-y-brenin (Borth), Cardiganshire** (`ark:/61903/1:1:45VS-5PZ`,
  already attached to the tree): "Owen Morris Junr", b. ~1859 Montgomeryshire, roller
  leather finisher, wife Ellen Elizabeth, son Thomas Rowley; and in the same household
  "Owen Morris Senr" (`ark:/61903/1:1:45V3-6N2`), b. ~1815 Montgomeryshire, widowed,
  retired gardener, indexed as his father.
- **1871 census, Newtown, Montgomeryshire** (household `ark:/61903/1:1:KDDP-KL4`,
  son `ark:/61903/1:1:KDDP-KLH`): Owen Morris, b. ~1860 at Llandinam, Montgomeryshire,
  son of Owen Morris, b. ~1818 at Aberhafesp, widowed, labourer.
- **1901 and 1911 censuses** (on the tree): born Montgomeryshire; 1911 gives Newtown.

The father is widowed in both 1871 and 1891, and the son keeps the Montgomeryshire
(Newtown) birthplace from 1871 to 1911, so the 1871 Newtown boy is the tree person.
On that same census night the hint's boy was a Cardiganshire-born son of John Morris,
so the hint persona is not him (`hint.identity: different`). f1 now states the father,
Owen Morris (b. ~1815-1818, Aberhafesp); f2 guards against John and Dorothy Morris.
His mother is not identified: the father was already a widower in 1871.

**Searched and not found:** his 1882 marriage to Ellen Elizabeth (her maiden name is
unknown), which would have named his father directly.

Retrieval was tool-assisted (`record_read`, `record_search` against live FamilySearch);
the identity judgement was the genealogist's. The call rests on the indexes alone; no
image was read, so `image_basis` is off.
