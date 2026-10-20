# Maria Dorothea Stockburger — a son Andreas Mayer baptised at Sankt Georgen in September 1812

**Source PID:** `9DQM-45L`
**Maria Dorothea Stockburger is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No birth or death date in the tree; it carries an undated Death fact. Wife of Johann Georg Meyer (Maier, Mayer), who appears in the tree twice, as `9D31-B4G` and `9DQM-45F`. Mother of Magdalena, born 5 March 1817 and baptised at Sankt Georgen im Schwarzwald (Oberkirnach), who married Christian Bäuerle in 1837, and of Anna Maria, born 9 November 1821 at Oberkirnach, Amt Villingen, who married into the Weisser family and died 2 September 1900.

## Research question

> What children did Maria Dorothea Stockburger, wife of Johann Georg Meyer and mother of Magdalena (born 5 March 1817) and Anna Maria (born 9 November 1821), both baptised at Sankt Georgen im Schwarzwald, Baden, have besides these two?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `9DQM-45L` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 1, `hint-samples.csv` row 49,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Germany, Births and Baptisms, 1558-1898", a baptism entry for Andreas Mayer, born and baptised 5 September 1812 at Sankt Georgen, naming his parents as Johann Georg Mayer and Maria Dorothea Stokburger. The index also carries a death date of 29 February 1852 for him, with no place.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Andreas (born 1812) as her son, plus a `required` finding that the report documents
the rejection.

A strong candidate. Both parents' names match the tree couple, and the date falls five years before the eldest child the tree knows. The tree's own index entry for the daughter Anna Maria's 1821 baptism, in the same collection, uses the identical place string ("Sankt Georgen, Freiburg, Baden") and likewise carries a later death date. That looks like the same register, annotated by the same hand. "Freiburg" in that string is the administrative region, not the city: Sankt Georgen im Schwarzwald lies in Regierungsbezirk Freiburg, and the tree's own church-book entries place the family at Oberkirnach in that parish. The hint record is not among the subject's or her children's sources, and no Andreas is in the tree.

The residual risk is a second couple of the same names in the parish. Mayer is common, and the tree already holds Johann Georg twice, so it has not been tidied. The discriminating check is the 1812 entry on the register image: the father's residence and occupation should match the Oberkirnach entries of 1817 and 1821. A different hamlet, or a father described as someone else's son, would separate the two couples.
