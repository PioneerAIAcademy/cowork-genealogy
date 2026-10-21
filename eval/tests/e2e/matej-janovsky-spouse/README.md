# Matěj Janovský — a wife named Marie and a son baptised in 1874, Malšice, Bohemia

**Source PID:** `GMBS-DQZ`
**Matěj Janovský is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1843; the tree carries an undated Death fact. Married Kateřina Votýpková (born about 1847) on 27 October 1866 at Malšice, Tábor, Bohemia; the tree gives the couple no children. The tree attaches him as a son of Jan Janovsky and Anna Puncochar of Žabonosy and Radim, Kolín district.

## Research question

> Matěj Janovský, born about 1843, married Kateřina Votýpková at Malšice, Tábor, Bohemia on 27 October 1866. Who were his wife or wives, and which children were born to him?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GMBS-DQZ` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 8, `hint-samples.csv` row 239,
flags `adds_spouse,adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Czech Republic, Church Books, 1552-1981", a Malšice baptism entry for Josef Janovsky, born 25 January 1874 and baptised the next day, naming his father Matěj Janovský and his mother only as Marie, with no surname. Retrieval was tool-assisted (`dev/try-record-read.ts`).
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Marie as his wife and Josef (1874) as his son, plus a `required` finding that the report documents
the rejection.

The place fits exactly: the hint is a Malšice baptism and the subject married at Malšice in 1866, so this is the same parish and the same name. The tree does not already cite this entry or any 1874 record; the subject's only source is his 1866 marriage.

The mother's name is the problem. The tree's wife is Kateřina Votýpková, married seven years earlier, and the hint's mother is Marie. That leaves three readings: Kateřina died between 1866 and 1873 and Matěj remarried a Marie; a second Matěj Janovský lived in the parish; or the indexer took the wrong name from the entry. Czech baptism registers of this period name the mother with her own parents and give the family's house number, so the discriminating check is the baptism image linked from the hint record: the mother's maiden name and parents, and whether the house number matches the groom's on the 1866 marriage entry. If she is Kateřina daughter of Josef Votýpka, the hint is the right family with an index error and the "wife" finding becomes (b). A Malšice burial for Kateřina before 1874, or a second marriage entry for Matěj, would settle the remarriage reading.

One thing to note in passing: the 1866 marriage entry indexes the groom with an Anna Háková, while the tree's mother for him is Anna Puncochar of the Kolín district, some 80 km away. The tree's parents for Matěj may be a separate mis-attachment. That does not affect this question.
