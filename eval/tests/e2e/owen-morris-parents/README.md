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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 28, `hint-samples.csv` row 978,
flags `adds_father,adds_mother`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "England and Wales, Census, 1871", the household of John Morris, farmer, at Lower Llanbadarn-y-Croyddin, Cardiganshire, in which Owen Morris, aged about 12 and born at Llanbadarn-Fawr, is a farmer's son of John (born about 1818, Llanilar) and Dorothy (born about 1825, Llanfihangel).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming John and Dorothy Morris as his parents, plus a `required` finding that the report documents
the rejection.

A weak candidate, and the tree's own sources argue against it. Name and birth year match, and the hint's household is about ten miles from Borth, but two attached records disagree with it. The 1891 census already in the tree lists him as **"Owen Morris Junr"**, with **Owen Morris Senr**, a widowed retired gardener born about 1815 in Montgomeryshire, in the same household as his father. And the 1901 and 1911 censuses give his birthplace as Montgomeryshire (1911: Newtown), where the hint's boy was born at Llanbadarn-Fawr, Cardiganshire. Owen Morris is a very common Welsh name, so a second boy of the same age a few parishes away is unremarkable.

This leans towards outcome (b): the question is probably answerable from other records, with Owen Morris Senr as the father. The check that settles it is the 1861 census or Owen's 1882 marriage entry. Either should name his father, and either can confirm a Montgomeryshire birth. If it names Owen Morris, the hint is a different boy.
