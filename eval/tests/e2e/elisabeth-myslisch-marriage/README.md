# Elisabeth Myslisch — marriage in February 1845, Oxhöft, West Prussia

**Source PID:** `KV1W-XVF`
**Elisabeth Myslisch is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, an undated Death fact, and no marriage; it also records her as Elisabeth Myslisz. Wife of Anton Netzel; children Elisabeth (christened 26 November 1845) and Valentin (christened 14 February 1847), both at Oxhöft, West Prussia. No person in this tree cites any record source.

## Research question

> When and where did Elisabeth Myslisch marry Anton Netzel, the parents of Elisabeth Netzel (christened 1845) and Valentin Netzel (christened 1847) at Oxhöft, West Prussia?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KV1W-XVF` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 11, `hint-samples.csv` row 407,
flags `adds_birth,adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Deutschland, Preußen, Westpreußen, Katholische und Lutherisch Kirchenbücher, 1537-1981", a marriage entry of 2 February 1845 at Oxhöft, Putzig, for Anton Netzel (born about 1808) and Elisabeth Desmer (born about 1805).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the February 1845 marriage to Anton Netzel, plus a `required` finding that the report documents
the rejection.

The geography tag is `PL`: Oxhöft is today Oksywie in Gdynia, Poland, following the corpus's Posen fixture, although the hint batch's country column says Germany and the collection is filed under Prussia.

A good fit on the groom, the place and the timing, with the bride's surname wrong. Anton Netzel is the tree's husband, Oxhöft is where both children were christened, and the first child's christening on 26 November 1845 falls almost ten months after this wedding — exactly what a first child of the marriage looks like. Against it, the bride is indexed as Desmer, not Myslisch or Myslisz, and a birth about 1805 would make her about 40 at the first child and 42 at the second: possible, but at the edge. A widow marrying under her late husband's surname would reconcile both — a 40-year-old bride is the usual shape of a remarriage, and Myslisch could be her maiden name — but nothing in the tree says she was widowed. The tree cites no record for anyone, so no existing source is a re-index of this event and there is no way to see where "Myslisch" came from; Netzel is not a rare name around Putzig, so a different Anton Netzel cannot be ruled out from the index.

The `adds_birth` flag is the bride's age at marriage turned into a birth year — real data, but it is the figure that strains against the 1845–1847 children. The discriminating check is the marriage register image linked from the hint record: a Catholic marriage entry of 1845 normally says whether the bride was a widow and gives her parents or maiden name. "Elisabeth Desmer, widow, née Myslisch" (or parents named Myslisch) would settle it as this couple; a spinster Desmer with other parents would make it a different marriage.
