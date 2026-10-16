# Inocente Lopez — death in September 1916, Suchitoto, El Salvador

**Source PID:** `L8GW-R6Y`
**Inocente Lopez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 11 June 1860 in Oratorio de Concepción, Cuscatlán; the tree carries an undated Death fact and no parents. Married Virginia Mendoza on 11 March 1885 at Oratorio de Concepción; children born 1884–1895 in Suchitoto and San Pedro Perulapán.

## Research question

> When and where did Inocente Lopez, born 11 June 1860 in Oratorio de Concepción, Cuscatlán, El Salvador, and married to Virginia Mendoza in 1885, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `L8GW-R6Y` with relatives). Nothing was
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

**Resolved: answerable, but differently.** The hint, a death entry in "El Salvador, Civil Registration, 1704-2001" for Inocente Lopez, died 13 January 1906, Suchitoto, Cuscatlán, mother Santos Lopez (`ark:/61903/1:1:QP7Z-BTQK`), is an infant and not this man. Inocente Lopez (L8GW-R6Y) died on 22 September 1916 at Suchitoto. In `expected-findings.json`:

- **f1** (required) is the 1916 death.
- **f2** (optional) is his parents, Matías López and Mauricia Carpio.
- **f3** (required, `"polarity": "avoid"`) is a guard against the 1906 death and the mother Santos Lopez.

**Why the hint is wrong.** The hint's index gives no age, spouse or civil status. Its entry, *P. nº 14*, registered 14 January 1906, begins at the foot of `ark:/61903/3:1:33S7-9TRK-36K` and continues at the top of `ark:/61903/3:1:33S7-9TRK-348`. There the register calls the deceased "varón, ladino, de diez y ocho días de nacido, hijo ilegítimo de Santos López", who died the day before of influenza in the Valle del Zapote.

- **Calibration.** The two other indexed entries on `…-348` match the index on name, named relatives (parents for Felicita Rivas, the wife for Vicente Casco) and date:
  - Felicita Rivas, daughter of Julián Rivas and Dolores Landaverde, died 13 January 1906 (`ark:/61903/1:1:QP7Z-BTQL`);
  - Vicente Casco, widower of Juana N., died 14 January 1906 (`ark:/61903/1:1:QP7Z-BTQT`).

  That licenses the reading for those fields only. The age of eighteen days rests on the genealogist's own reading of `…-348`, which is why `image_basis` is on.
- **The index confirms it without the image.** The same infant was independently indexed at his civil birth registration: Inocente de José López, born 28 December 1905 at Suchitoto, mother Santos López, no father named (`ark:/61903/1:1:QGF2-WRZP`). That makes him sixteen days old at death against the eighteen stated, a small slip in what the informant gave.
- **No source conflict.** The hint's `1:1:` id is not among the tree's cited sources.

**The real death.** A search of the civil registers for Inocente López with spouse Virginia Mendoza returned `ark:/61903/1:1:QPHJ-JVY1`: Ynocente Lopez Carpio, died 22 September 1916, death registered at Suchitoto, spouse **Virginia Mendoza**, parents Matías López and Mauricia Carpio (register image `ark:/61903/3:1:33SQ-GTRF-NTF`). It is not attached in the tree. A second index of the same death, `ark:/61903/1:1:655Y-1SYB` (image `ark:/61903/3:1:3QHK-1Q52-59S4-G`), gives the same parents, 23 September 1916, and a computed birth year of 1844. The two indexes disagree by one day, and nothing licensed settles which is right, so f1 accepts either day.

The identification rests on the indexes:

- **Name, wife and town.** It is the same name with the same wife, in the family's town; Alberto married there in May 1906.
- **No rival couple.** Every other Inocente López + Virginia Mendoza hit in the index is a record of this couple's children.
- **His mother's death.** Mauricia Carpio, wife of Matías López, died 27 October 1881 at San Pedro Perulapán (`ark:/61903/1:1:QP7K-XNNN`). That is where the couple's children Alberto (1886) and Luisa (1888) were born.

**One conflict is left unresolved.** The second index's computed 1844 birth disagrees with the tree's 11 June 1860 birth at Oratorio de Concepción, and that 1860 birth has no source attached in the tree. The genealogist made the identity call on 14 October 2026 on the spouse, parents and place, despite the age.

**The 1916 page reading is discarded.** An AI transcription (`dev/try-image-transcribe.ts`) of `…-NTF` failed calibration. It read the given name "Paulina" where the index has Rufina Borja Suares (`ark:/61903/1:1:QPHJ-JVY2`), and the surname "Candavende" where the index has Felipe Landaverde (`ark:/61903/1:1:QPHJ-JVYP`). Nothing from that reading is relied on here.

Retrieval was tool-assisted: `packages/engine/mcp-server/dev/try-record-read.ts`, `try-record-search.ts` and `try-image-transcribe.ts` against live FamilySearch. The identity judgement was the genealogist's.
