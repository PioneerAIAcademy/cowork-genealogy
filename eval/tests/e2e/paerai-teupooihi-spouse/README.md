# Paerai Teupooihi — her son Moe Parauhia's wife, Aufait Toehae

**Source PID:** `LCX2-LKN`
**Paerai Teupooihi is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; married Parauhia Paura at Moorea in 1830, with four children born there between 1831 and 1847.

## Research question

> Whom did Moe Parauhia, son of Parauhia Paura and Paerai Teupooihi of Moorea, marry?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LCX2-LKN` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**RESOLVED 2026-09-21 — true match.** This fixture came from a hint batch
(`filtered-list-samples-2.csv` row 12, `hint-samples.csv` row 397,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
false matches. This one is true, so `f1` (Moe Parauhia married Aufait Toehae) is
kept as transcribed, with an independent corroborating ark added.

**Hint record:** `ark:/61903/1:1:D71K-H96Z` — a "French Polynesia, Civil
Registration, 1780-1999" marriage entry. The ark cited on the card is the
mother's persona on that entry; the entry's principal persona is Moe Parauhia
(`ark:/61903/1:1:D71K-H9W2`).

**The evidence that decided it.** The hint record names the principal as Moe
Parauhia, born 1836, with parents Paura Parauhia and Teupoooihi Paerai, married
to Aufait Toehae, and records an 1860 marriage at Teaharoa, Moorea. The parents
match the tree couple — Parauhia Paura (`LCX2-L8S`) and Paerai Teupooihi
(`LCX2-LKN`), the name order inverting as Tahitian records allow — and the birth
year matches the tree's Moe PARAUHIA (`97XW-7VN`, b. 1836, Papetoai, Moorea), so
the principal is unambiguously this Moe. The finding attaches to the son, not to
the subject.

The spouse is corroborated independently, meeting both bars the card set:

1. A **second, independent index entry on a different register image** —
   `ark:/61903/1:1:D955-NRW2` ("Entry for Moe Parauhia and Aufaite Toehae",
   image `3:1:3Q9M-CSS4-PSVY`, household `1:2:48ZK-KGT2`) — records the same 1860
   marriage at Teavaro, Moorea. The hint sits on a different image
   (`3:1:3Q9M-CSS4-P343`, household `1:2:46ZP-Y8ZM`), so this is not a re-serving
   of the same index ARK.
2. The hint record itself carries the discriminators the card asked for: an 1860
   marriage date, a Moorea place, and parents matching `LCX2-L8S`/`LCX2-LKN`.

A third line agrees: the live tree already carries the spouse as a distinct
person, Aufait/Afaite Toehae (`L6RB-3B4`, b. 1834 Paea, d. 6 Dec 1887 Teaharoa,
Moorea), married to Moe c. 1860 at Teavaro.

**Correcting the draft's stated risk.** The draft flagged that "the entry
carries no date for the marriage." Read on FamilySearch, both the hint and the
corroborating entry carry an 1860 marriage date and a Moorea place — the "no
date" was an index-summary artifact, not the record. The namesake risk (dense
Tahitian given names) is answered by the parent-anchored principal, the second
image, and the fleshed-out tree spouse; no record was found placing this Moe
with another wife.

**Re-index check.** The seven "French Polynesia, Civil Registration" sources in
the starting tree are all subject-titled entries for Raitui and Teuratau
Parauhia — none for Moe, none carrying a spouse — so the hint is not a re-index
of them. It is a sibling of Moe's own already-attached marriage source
(`D955-NRW2`), the same 1860 event on a different image, which is why the live
tree already reflects the spouse even though the subject-centric snapshot does
not: the spouse is one relationship-hop beyond the subject, outside the
snapshot's reach, so fixture integrity (`starting == unstripped`) is unaffected.

**One honest gap for the next reader.** The independent corroborating entry
(`D955-NRW2`) indexes only Moe and his spouse, not Moe's parents; the
parent-anchor rests on the hint record and the live-tree parent links. This is
the same shape the `susanna-szljacsan-spouse` true match accepted.

Reviewed and signed off by Solomon Baidoo, 2026-09-21.
