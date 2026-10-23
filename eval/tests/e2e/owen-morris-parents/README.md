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
  retired gardener. The index's own relationship-to-head fields read Head (Owen Junr),
  Wife, Son and **Father** (Owen Senr): the census column itself names him as the
  head's father. (FamilySearch does not show the 1891 page image; the field was read
  from the index.)
- **1871 census, Newtown, Montgomeryshire** (household `ark:/61903/1:1:KDDP-KL4`,
  son `ark:/61903/1:1:KDDP-KLH`): Owen Morris, b. ~1860 at Llandinam, Montgomeryshire,
  son of Owen Morris, b. ~1818 at Aberhafesp, widowed, labourer.
- **1901 and 1911 censuses** (on the tree): born Montgomeryshire; 1911 gives Newtown.

The father is widowed in both 1871 and 1891, and the son keeps the Montgomeryshire
(Newtown) birthplace from 1871 to 1911, so the 1871 Newtown boy is the tree person.
On that same census night the hint's boy was a Cardiganshire-born son of John Morris,
so the hint persona is not him (`hint.identity: different`). f1 now states the father,
Owen Morris (b. ~1815-1818, Aberhafesp); f2 guards against John and Dorothy Morris.
His mother is not identified: the father was already a widower in 1871. The father's
earlier household is in the **1851 census** (`ark:/61903/1:1:SGDS-D7Z`): Owen Morris,
b. ~1817 at Aberhafesp (the same birthplace as in 1871), a farmer of 20 acres, married
to **Mary**, b. ~1815 at Llanwnog. Mary is a candidate mother only: she would have been
about 44 at Owen's birth, and nothing shows she was alive in 1859.

**f1 is not required (genealogist, 2026-10-22).** The 1891 census (`ark:/61903/1:1:45VS-5PZ`)
is attached to Owen in the starting tree and records Owen Morris Senr as the head's father,
so once a project extracts the subject's attached records it answers f1 without any research.
f2, rejecting the 1871 Cardiganshire hint, still needs research and stays required. The 1891
and 1911 censuses are listed as starting evidence in
`eval/tests/e2e/attached-evidence-allowlist.json`. This follows maria-bracero-marriage.

**Searched and not found:** his 1882 marriage to Ellen Elizabeth (her maiden name is
unknown), which would have named his father directly; and a 1861 census entry placing
a Montgomeryshire-born Owen, about 2, in a household with a father Owen. The 1861 search
did find an "Owen Morries", b. 1858 at Llanbadarn Fawr, at Llanilar, Cardiganshire
(`ark:/61903/1:1:M7DT-1CL`): almost certainly the hint's own boy ten years earlier,
which confirms a separate Cardiganshire Owen.

Retrieval was tool-assisted (`record_read`, `record_search` against live FamilySearch);
the identity judgement was the genealogist's. The call rests on the indexes alone; no
image was read, so `image_basis` is off.
