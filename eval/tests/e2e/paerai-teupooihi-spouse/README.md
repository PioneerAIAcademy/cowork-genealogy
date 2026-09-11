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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 12, `hint-samples.csv` row 397,
flag `adds_spouse`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "French Polynesia, Civil Registration, 1780-1999", an entry for Moe Parauhia (b. 1836) naming his parents as Paura Parauhia and Teupoooihi Paerai and his spouse as Aufait Toehae.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Aufait Toehae as her son's wife, plus a `required` finding that the report documents
the rejection.

The identification looks solid and the risk is elsewhere. The record's Moe Parauhia, born 1836 to Paura Parauhia and Teupoooihi Paerai, is the tree's Moe PARAUHIA (97XW-7VN), born 1836 at Papetoai, Moorea to exactly that couple — the name order inverts between the two (Tahitian records give the parent's name either way round) but every element matches, and the tree already carries a birth registration for him from this same collection.

The addition the hint actually makes is one generation out: a **spouse for Moe**, Aufait Toehae. Two things to check. First, whether this record is simply a re-index of one of the seven "French Polynesia, Civil Registration" sources already attached to the subject — the tree has an unusual number of them and the hinting engine cannot tell a fresh record from a duplicate. Second, that the spouse belongs to this Moe rather than to a namesake: Tahitian given names repeat densely within a district, and the entry carries no date for the marriage itself.

If it holds, the finding attaches to the son, not to the subject — which is a fair test of whether the agent puts a fact on the right person.
