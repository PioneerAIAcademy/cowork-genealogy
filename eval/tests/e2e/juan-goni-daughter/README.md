# Juan José Goñi — daughter Martina Eulalia Goñi (m. 1872, Elizondo)

**Source PID:** `G18D-QZW`
**Juan José Goñi is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of Elizondo, Baztán, Navarra.

## Research question

> Did Juan José Goñi and his wife Francisca de Goñi of Elizondo, Navarra have a daughter, Martina Eulalia Goñi, who married Francisco Casimiro Yriarte in 1872?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G18D-QZW` with relatives). Nothing was
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

**Resolved: true match.** Martina Eulalia Goñi was a daughter of Juan José
Goñi and Francisca de Goñi, and she married Francisco Casimiro Yriarte at
Elizondo on 10 Sep 1872.

The 1872 marriage index (`ark:/61903/1:1:C9D5-X6W2`) does **not** carry the
call on its own, and a resolution resting on it would not be safe: it gives
the bride's father as a bare "Juan Jose" with no surname, and Goñi is a common
Baztán surname. What decides it is Martina Eulalia's own christening —
10 Dec 1845, Elizondo, in "España, registros parroquiales y diocesanos,
1307-2005" (`ark:/61903/1:1:664D-73X6`), the same collection the tree already
cites for the known daughter Engracia Ygnacia. That collection indexes
**grandparents**, so the comparison is on four names rather than two:

| | Martina Eulalia, chr. 1845 | Engracia Ygnacia, chr. 1840 (`ark:/61903/1:1:664F-CCKG`) |
|---|---|---|
| Father | Juan José, indexed "Gonz" | Juan José Goñi |
| Mother | Francisca Goñi | de Francisca Goñi |
| Paternal grandparents | Juan and Martina Urtasun | Juan and Martina Urta |
| Maternal grandparents | Santiago and María Bautista Ytzea | Santiago and María Bautista Yteca |
| Godmother | Engracia Goni | Engracia Goni |

Four further christenings to the same couple in the same register carry the
same grandparent set: Juan Bautista 1844 (`ark:/61903/1:1:664D-BN3Y`), Lucio
José 1850 (`ark:/61903/1:1:664X-T9CT`), Santiago Nicasio 1853
(`ark:/61903/1:1:664F-K5Y6`), Martín José Sotero 1856
(`ark:/61903/1:1:66H2-BVGK`). A sixth sibling sits in the separate
"España, bautismos, 1502-1940" index rather than this register and carries the
same grandparent set: Miguel Francisco Crisanto Goni Goni, chr. 25 Oct 1858
(`ark:/61903/1:1:H6WT-W93Z`), naming Juan and Martina Urtasun with Santiago and
Maria Bautista Itcea. It was surfaced by the e2e agent's own run, not by this
adjudication. The father's surname is garbled differently in
several of them — "Gonz" in 1845, "Gómez" in 1844, "Ju? José Goni" in 1850 —
so a surname mismatch in this run of entries is a transcription artefact of
one hand, not evidence of a second family. The 1844 entry was read
specifically to test the namesake hypothesis, since a genuine second "Juan
José + Francisca" couple at Elizondo would surface there; its grandparents are
the same couple's, so it is another son, and no namesake couple appeared in
the register at all.

Ages and sequence hold: born Dec 1845, married Sep 1872 at 26, first child
Juana Tomasa christened 22 Aug 1873 at Elizondo
(`ark:/61903/1:1:H6WW-Z5T2`, re-indexed as `ark:/61903/1:1:66H2-K9PB`), whose
entry again names the mother's parents as Juan José and Francisca Goñi. She is
named for her paternal grandmother, Martina Urtasun, as the Baztán naming
pattern predicts.

The caution about the tree's existing "Juan Jose in entry for Juan Bautista
Apezteguia" source is settled and is **not** a duplicate of the hint: that is
Engracia Ygnacia's own marriage, 13 May 1873 to Juan Bautista Apezteguia
(`ark:/61903/1:1:C9DL-1Z2M`) — a date the live tree carries on Engracia's own
Couple relationship. Different daughter, different groom, different year. The
four Apezteguia-Goni baptisms on the tree person are that marriage's children.

Search note for anyone re-deriving this: the 1845 christening cannot be found
by searching the surname "Goñi", because this collection indexes the couple's
children with a **given name only** and no surname (Engracia Ignacia, Juan
Bautista, Martina Eulalia, Lucio José, Santiago Nicasio, Martín José Sotero
are all indexed surname-less). It surfaces on a parent-name search — father
"Juan José", mother "Francisca Goñi", place Elizondo, collection 1784529.

Note for the corpus: the batch CSV labels this row Cuba, and so does the live
tree — Engracia Ygnacia's Birth fact carries `standard_place` "Elizondo, La
Habana, Cuba" while her Christening carries "Elizondo, Baztan, Nafarroa,
Spain". That is the tree's own bad standardization and is left alone here. The
person and the records are Navarrese throughout; nothing about the research is
Cuban.
