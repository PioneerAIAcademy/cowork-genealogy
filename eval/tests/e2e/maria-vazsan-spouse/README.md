# Maria Vázsan — husband and daughter named on a 1900 Bojnice baptism

**Source PID:** `LJTH-GRX`
**Maria Vázsan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Baptised 10 January 1853 at Bojnice (Hungarian Bajmóc), Prievidza district, Slovakia; the tree carries an undated Death fact. Daughter of Ignatius Vázsan (about 1805–1881) and Anna Prividzer (about 1825–1875). Anna appears twice in the tree, as `LJTH-GRN` and `LJTW-6YB`. The tree also has a half-sister, another Maria Vazsan, baptised in 1832, and seven other siblings and half-siblings baptised at Bojnice from 1835 to 1851. The tree gives her no spouse or children, and her only source is her own baptism.

## Research question

> Whom did Maria Vázsan, baptised 10 January 1853 at Bojnice (Bajmóc), Slovakia, daughter of Ignatius Vázsan and Anna Prividzer, marry, and what children did the marriage produce?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LJTH-GRX` with relatives). Nothing was
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
(`filtered-list-samples-4.csv` row 24, `hint-samples.csv` row 811,
flags `adds_spouse,adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Slovakia, Church and Synagogue Books, 1592-1935", the baptism of Maria Czibula at Bojnice on 9 June 1900, daughter of János Czibula and Maria Vázsan. The index gives the mother no age and no parents.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming János Czibula as her husband, plus a `required` finding that the report documents
the rejection.

A weak candidate. The name and parish match exactly: Vázsan is a rare surname, and the subject was baptised in the same parish. The problem is age. Born in 1853, she would have been **47** at a June 1900 birth. That is possible but rare, and it would make Maria Czibula a last child. The likelier reading is that the mother is a younger Maria Vázsan, perhaps a niece born in the 1870s to one of the subject's brothers (János, b. 1849; Jósef, b. 1843). The tree does not carry that generation, so it would not show her. The half-sister Maria (b. 1832) is ruled out by age. None of the tree's sources is this baptism, and no Czibula appears anywhere in the tree.

The discriminating check is the Czibula–Vázsan marriage. Find the marriage of János Czibula and Maria Vázsan in the Bojnice registers, probably 1875–1899. Hungarian-era Catholic marriage entries give the bride's age and parents. A bride born about 1853 to Ignatius Vázsan and Anna Prividzer makes this a true match. A bride born in the 1870s, or one with other parents, makes it the wrong Maria. Earlier Czibula baptisms with this mother would also show when the marriage began. A run of births ending in 1900 fits the subject; a first child near 1900 does not.
