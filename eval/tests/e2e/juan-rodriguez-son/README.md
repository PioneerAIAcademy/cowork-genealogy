# Juan Rodríguez Martínez — additional son buried 1801

**Source PID:** `9634-PS9`
**Juan Rodríguez Martínez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
16 November 1777, Pozuelo, Albacete, Spain; died buried 18 January 1855, San Bartolomé, Pozuelo, Albacete, Spain.

## Research question

> Did Juan Rodríguez Martínez and his wife Marcelina Garcia of Pozuelo, Albacete, Spain have a son also named Juan, who died in infancy in 1801, in addition to the seven children recorded in the tree (b. 1799-1822)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `9634-PS9` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-10 — outcome 2, answerable but differently.** The hint record is
genuine and this couple did have at least one son the starting tree does not record.
But the hint's citation points at the wrong person, and the register's given name is
not safe to assert on its own, so the finding was rewritten to claim only what the
records carry. Research was done through the MCP tools against live FamilySearch
(`record_search`, `record_read`, `image_transcribe`, `fulltext_search`).

**The hint's ark points at the father, not the child.** Issue #881 cites
`ark:/61903/1:1:VTJ3-PBV`, which is **Juan Rodriguez the father**, husband of Marcelina
Garcia. The buried child is `ark:/61903/1:1:VTJ3-PBJ` in the same record. Anyone
re-deriving this case should open the second ark.

**The transcription is correct, and infancy is documented rather than inferred.** The
register image (`ark:/61903/3:1:S3HY-691S-222`) carries the marginal heading *"Parbulo.
Juan hijo de Juan Rodriguez y Marcelina Garcia"* and the body entry *"…en diecisiete
dias del mes de Febrero de mil ochocientos y uno se enterro a ~~Fran~~ Juan parvb.o hijo
de Juan Rodriguez, y Marcelina Garcia"*. *Párvulo* is the register's own word for a child
dead before the age of reason. The entry gives no age, no birth date and **no
grandparents** — so on its own it cannot be pinned to this couple rather than to another
couple bearing the same two names.

**The couple is identifiable from their baptisms, not from this burial.** Nine baptisms
of a Juan Rodriguez / Marcelina Garcia couple survive in San Bartolomé, Pozuelo
(collection 1431011), and all nine name the identical four grandparents — paternal
Antonio Rodriguez of Pozuelo and Vicenta Martinez *de las Peñas*, maternal Francisco
Garcia and Maria de Corcoles of Pozuelo. That matches the starting tree exactly,
including R2's 1752 marriage at Peñas de San Pedro. No second couple of these names
appears bearing children in the parish.

**The tree is short by more than one child.** All seven children in the starting tree
match a parish baptism. Two further baptisms of the same couple are absent from the tree
entirely:

| child | baptised | ark |
|---|---|---|
| Antonio Josef | 21 December 1800 (born 20 December, 8pm) | `ark:/61903/1:1:N3M1-19Q` |
| Bartholomé Martín | 31 January 1809 (born 30 January) | `ark:/61903/1:1:N39M-S4K` |

A further son — a **surviving Juan** — appears only as a parent: the baptism of Victoriano
Rodriguez, 25 March 1854 (`ark:/61903/1:1:N3QG-6CP`), names his father Juan Rodriguez and
his paternal grandparents Juan Rodriguez and Marcelina Garcia. That Juan has no baptism
among the nine, which is direct proof that the parish index drops children of this
couple. The absence of a baptism for the 1801 infant is therefore not evidence against
him.

**Why the given name is not safe to assert.** Juana was born 6 May 1799 and Antonio Josef
on 20 December 1800 — nineteen and a half months apart. A third live birth between them
would need two consecutive intervals of about nine and three-quarter months, which is
below the floor for consecutive live births. So no son of this couple born after the
marriage date the tree carries could have been alive in February 1801 except Antonio
Josef, who was two months old, never appears again in any Pozuelo record, and has no
burial of his own. Two things cut the other way: the priest demonstrably fumbled this
entry's given name — he began "Fran", carried over from the preceding entry for Fran.co
Escamilla, and struck it out — and Spanish naming custom puts the paternal grandfather's
name on the first son, which Antonio Josef fits and a firstborn Juan does not. The
competing reading, that the párvulo is a genuine additional son whose baptism the index
drops, requires him to be born before the tree's marriage date.

**The marriage date could not be verified, and it is the pivot.** The tree's 4 August 1798
marriage (R1) carries **no source**. If it is early, a Juan born in the 1790s fits as a
párvulo of three to six with no difficulty at all. Searched and came up empty: the
parish's indexed marriages in collection 1431011 do not reach back to 1798 — the earliest
found for this family is Juana's own, 28 February 1821 (`ark:/61903/1:1:N3QT-Q18`) — and
`fulltext_search` over the Castilla-La Mancha corpus does not cover Pozuelo, Albacete,
returning Ávila, Valladolid and Cáceres against a Pozuelo place filter. No navigation
path to the neighbouring burial-register pages was available through `image_read` or
`image_search`, so a separate burial for Antonio Josef between 21 December 1800 and
10 February 1801 could be neither found nor ruled out. That is the one check that would
settle this outright, and it is the first thing to try with a filmstrip or DGS number in
hand.

**What the finding therefore claims, and why.** That the couple had at least one more son
than the tree records, buried as a párvulo on 17 February 1801, entered in the register as
Juan. That statement holds under **both** readings above — if the infant is Antonio Josef,
he is still a son the tree lacks — which is what makes it gradeable rather than a coin
flip. An agent that recovers the burial and reports the extra son should score it. One
that asserts a separate son Juan *and* keeps Antonio Josef as a further child has gone
past the evidence; one that reports no additional child has missed it.

**A dead end recorded so nobody repeats it.** The draft asked whether this burial could be
the same event as Francisco's christening of 4 December 1801. It cannot — the burial is
over nine months earlier. The real same-child candidate is Antonio Josef, christened
21 December 1800.

**Found while working, deliberately not encoded** (the starting tree is immutable, and
these are outside the research question): Vicenta (b. 26 October 1815) was buried
28 January 1818 aged two (`ark:/61903/1:1:VTJ3-TYK`); Francisca (b. 9 March 1822) was
buried 4 October 1846 (`ark:/61903/1:1:VTJQ-9DQ`); Marcelina Garcia, born about 1774, was
buried 6 October 1858 (`ark:/61903/1:1:N3Q5-RBL`); and the subject's own burial of
18 January 1855 is confirmed at `ark:/61903/1:1:VTJQ-SRM`, born about 1777.
