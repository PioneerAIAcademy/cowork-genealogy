# Dora Dobrotić — a son Jacobus baptised in 1871, Križovljan Radovečki, Croatia

**Source PID:** `K48B-4CP`
**Dora Dobrotić is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1841 at Veliki Lovrečan, Varaždin; the tree carries an undated Death fact. Wife of Franjo Korotaj (born about 1837); mother of Franja (christened 5 March 1855), Philippus (born 10 April 1863, christened at Križovljan Radovečki) and Antonius (born 1865, christened at Križovljan Radovečki).

## Research question

> Which children were born to Dora (Dorothea) Dobrotić, born about 1841 at Veliki Lovrečan, Varaždin, Croatia, and her husband Franjo Korotaj?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `K48B-4CP` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 7, `hint-samples.csv` row 228,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Croatia, Church Books, 1516-1994", an entry for Jacobus Korota, Roman Catholic, baptised 3 April 1871 at Križovljan Radovečki, son of Franciscus Korota and Dorothea Dobrotić. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Jacobus (1871) as her son, plus a `required` finding that the report documents
the rejection.

A strong candidate on its face. Both parents' names match the tree couple (Franciscus = Franjo; "Korota" is one letter short of Korotaj), the parish is the one where two of the couple's sons were christened in 1863 and 1865, and Dora would have been about 30 in 1871. The tree does not cite this entry, and none of its sources is dated after 1865, so it is not a re-index of anything already attached.

One oddity needs explaining before it is accepted. The image the entry points to is filed in a **Kotoriba death register for 1890–1917**, in Međimurje, not in a Križovljan baptism register. So the record may be a death entry that states the deceased's baptism date and parents, or the index may be attached to the wrong film. The discriminating check is to open the image linked from the hint record and confirm what kind of entry it is. If it is a baptism, read the parents' village (Lovrečan) on it. If it is a Kotoriba death, it still names the parents, but the finding should then also carry the death, and a Jacobus Korotaj dying in Kotoriba must be shown to be this couple's son rather than a namesake from another Korotaj household.
