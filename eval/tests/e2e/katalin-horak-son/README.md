# Katalin Horák — additional son János (b. 1844)

**Source PID:** `LDSJ-SXL`
**Katalin Horák is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Katalin Horák and her husband István Banyári of Kľak, Nová Baňa, Slovakia have a son named János, baptized 1 September 1844?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `LDSJ-SXL` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 20, flag `adds_son`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Slovakia, Church and Synagogue Books, 1592-1935: baptismal entry, 1 September 1844, Kľak, Nová Baňa, naming parents István Banyári and Káti Liskovics. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard naming the 1844 János baptism, plus a `required` finding that the report documents the rejection.

**Strong reason to doubt this match**: the mother's surname in the hint record is "**Liskovics**", which bears no resemblance at all to the subject's tree surname "**Horák**" — a materially weaker name link than almost any other record in this batch (most others are routine spelling variants of the same surname). The father's name "István Banyári" does match the tree spouse's name, and the parish (Kľak) and era (a son baptized 1844, one to two years before the tree's existing son István, christened 1846) are both plausible. This fixture is a strong candidate for outcome (c) (false match — likely a different woman married to a same-named István Banyári in the same small parish, given how common the surname Banyári appears to be there) but is left as a recover-type draft finding pending the genealogist's review.
