# Fernando Suarez Franco — marriage in November 1891, Aguadas, Caldas, Colombia

**Source PID:** `GZ6S-8MW`
**Fernando Suarez Franco is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1866 in Antioquia, son of Juan de Dios Suarez and Manuela Franco; the tree carries an undated Death fact. His couple relationship with Maria Jesus Ramirez Henao has no marriage fact; their children Julia Rosa, Juan Esteban, Maria del Carmen and Ana Rosa were born 1896–1904 in Caramanta, Antioquia. A second marriage, to Rosaura Balesteros, is dated 19 April 1931 at Aguadas, Caldas.

## Research question

> When and where did Fernando Suarez Franco, born about 1866 in Antioquia and the son of Juan de Dios Suarez and Manuela Franco, marry Maria Jesus Ramirez Henao, the mother of his children baptized in Caramanta between 1896 and 1904?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GZ6S-8MW` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 6, `hint-samples.csv` row 189,
flag `adds_marriage`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Colombia, registros parroquiales y diocesanos, 1576-2019", a marriage entry of 11 November 1891 at the Inmaculada Concepción parish, Aguadas, Caldas, for Fernando Franco, son of Manuela Franco (no father named), and Maria de Jesus Ramirez, daughter of Luis Ramirez and Juana Henao. The register image is catalogued as the 1880–1898 marriage book of the Inmaculada Concepción parish of Salamina, Caldas, the town next to Aguadas.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the November 1891 marriage, plus a `required` finding that the report documents
the rejection.

A strong candidate on family names. The groom's mother, Manuela Franco, is the tree's mother; the bride's mother, Juana Henao, accounts for the second surname the tree gives her (Ramirez Henao); and the tree's own 1931 remarriage to Rosaura Balesteros (`ark:/61903/1:1:QGLM-JB3R`) is in the same town, Aguadas. A marriage in 1891 sits sensibly before the first child the tree has, baptized in Caramanta in 1896. None of the tree's sources is a marriage of this couple, so nothing in the tree is a re-index of this entry. `f2` (the bride's parents) is not required: the question asks for the marriage, but an agent that reads the entry should record them.

What is thin is the groom's surname: the entry calls him Fernando Franco, with only his mother named, which reads as a natural son, while the tree gives him a father, Juan de Dios Suarez, and the children's 1896–1900 baptisms the tree cites call him Suárez (once indexed Juárez). That is consistent with a man who later took his father's name, or with a different Fernando Franco. The tree's 1849 birth year for Maria Jesus cannot be right for a mother of children born 1896–1904, so an agent should not reject on her age. The check that would settle it is Julia Rosa's 1896 Caramanta baptism, already cited in the tree (`ark:/61903/1:1:6DDW-L7XF`): baptisms of that period normally name both sets of grandparents, and maternal grandparents Luis Ramirez and Juana Henao there would tie this bride to the tree's Maria Jesus.
