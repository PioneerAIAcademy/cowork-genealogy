# Kierstin Jonsdotter — a daughter Anna christened 1777 at Rättvik

**Source PID:** `K8LX-YMK`
**Kierstin Jonsdotter is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; wife of Anders Hansson, with two sons named Hans christened at Rättvik in 1771 and 1781.

## Research question

> Was the Anna christened 12 January 1777 at Rättvik, daughter of Anders Ersson and Kierstin Jöransdotter, a daughter of Kierstin Jonsdotter and Anders Hansson?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K8LX-YMK` with relatives). Nothing was
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

**Resolved 2026-09-24 (issue #2320): false match.** The hint is rejected.
`expected-findings.json` now carries a `"polarity": "avoid"` finding (Anna must
not be made a daughter of Kierstin Jonsdotter and Anders Hansson) paired with a
`required` finding that the report documents the rejection. Hint source:
`filtered-list-samples-2.csv` row 27, `hint-samples.csv` row 853, flag
`adds_daughter`, confidence 3.

**Retrieval was tool-assisted; the identity call was the genealogist's.**
Records were read with `dev/try-record-read.ts` and searched with
`dev/try-record-search.ts` (collection 1520594, "Sweden, Baptisms, 1611-1920",
birth place Rättvik, Kopparberg, Sweden).

**What decided it.** The patronymic mismatch alone did not decide it; the
hint's couple did. In the same index, Anders Ersson and Kierstin
Jöransdotter/Göransdotter (Jöran and Göran are one name) are a distinct,
recurring Rättvik household. Searching father Anders Ersson with mother Kierstin
Joransdr, 1760-1800, returns exactly four children:

| Child | Christened | Ark |
|---|---|---|
| Anna (the hint) | 12 Jan 1777 | `ark:/61903/1:1:VWH9-GL6` |
| Anders | 10 Sep 1779 | `ark:/61903/1:1:VWHS-WHD` |
| Margita | 31 May 1784 | `ark:/61903/1:1:VWH9-Z5T` |
| Kierstin | 1 Jul 1787 | `ark:/61903/1:1:VWH9-ZHD` |

Four separate index entries over ten years agree on both patronymics. They
include a son named for the father and a daughter named for the mother. That
is a family, not a one-off misreading of Anders Hansson and Kierstin Jonsdotter.
The same search for father Anders Hansson with mother Kierstin Jonsdr in
Rättvik, 1760-1800, returns no Anna at all.

**A caution for the tree, not for this fixture.** "Anders Hansson × Kierstin
Jonsdr" in Rättvik is itself more than one couple. The index has Brita
(3 May 1771, `VWH9-J4C`) seven months before the tree's Hans (9 Dec 1771), and
Johan (28 Sep 1781, `VWHS-H4B`) seven months after the tree's other Hans
(2 Mar 1781). The tree's two sons may therefore belong to two different
same-named couples. This does not rescue the hint: Anna still sits in the
Ersson/Göransdotter series. But an agent that notices it and flags the tree's
own sons is doing good work, not drifting.

**What is uncontrolled.** Every reading above comes from the one derivative
index, so this is index set against index, not register evidence. The Rättvik
birth register and husförhörslängder were **not** examined: the baptism index
entries carry no image link, and `volume_search` rejects "Rättvik, Kopparberg,
Sweden" as ambiguous (district / Lutheran parish / municipality), with no way to
choose between them. No image reading was made, so the issue #2831 calibration
check was not applicable. No farm/residence column was consulted. A reviewer
with access to the Rättvik husförhörslängd for c. 1775-1790 (FamilySearch,
Riksarkivet or ArkivDigital) could strengthen the call by finding the Ersson and
Hansson households on their farms. If that register showed Anna in the Hansson
household instead, this fixture must be re-adjudicated.
