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

**Resolved: answerable, but differently.** The hint, a death entry in "El Salvador, Civil Registration, 1704-2001" for Inocente Lopez, died 13 January 1906, Suchitoto, Cuscatlán, mother Santos Lopez (`ark:/61903/1:1:QP7Z-BTQK`), is an infant and not this man. Inocente Lopez (L8GW-R6Y) died in September 1916 in the jurisdiction of Suchitoto; the records disagree on the day (20, 22 or 23 September). In `expected-findings.json`:

- **f1** (required) is the September 1916 death. It accepts any one of 20, 21, 22 or 23 September 1916 as a single day, or September 1916. Of those, only 20, 22 and 23 September are dates an index gives as his death date; 21 September is the burial date in the church index.
- **f2** (optional) is his parents, Matías López and Mauricia Carpio.
- **f3** (required, `"polarity": "avoid"`) is a guard against the 1906 death and the mother Santos Lopez.

**Why the hint is wrong.** The hint's index gives no age, spouse or civil status. Its entry, *P. nº 14*, registered 14 January 1906, begins at the foot of `ark:/61903/3:1:33S7-9TRK-36K` and continues at the top of `ark:/61903/3:1:33S7-9TRK-348`. There the register calls the deceased "varón, ladino, de diez y ocho días de nacido, hijo ilegítimo de Santos López", who died the day before of influenza in the Valle del Zapote.

- **Calibration.** The two other indexed entries on `…-348` match the index on name, named relatives (parents for Felicita Rivas, the wife for Vicente Casco) and date:
  - Felicita Rivas, daughter of Julián Rivas and Dolores Landaverde, died 13 January 1906 (`ark:/61903/1:1:QP7Z-BTQL`);
  - Vicente Casco, widower of Juana N., died 14 January 1906 (`ark:/61903/1:1:QP7Z-BTQT`).

  That licenses the reading for those fields only. The age of eighteen days rests on the genealogist's own reading of `…-348`, which is why `image_basis` is on.
- **The index confirms it without the image.** The same infant was independently indexed at his civil birth registration: Inocente de José López, born 28 December 1905 at Suchitoto, mother Santos López, no father named (`ark:/61903/1:1:QGF2-WRZP`). That makes him sixteen days old at death against the eighteen stated, a small slip in what the informant gave.
- **No source conflict.** The hint's `1:1:` id is not among the tree's cited sources.

**The real death.** A search of the civil registers for Inocente López with spouse Virginia Mendoza returned `ark:/61903/1:1:QPHJ-JVY1`: Ynocente Lopez Carpio, died 22 September 1916, death registered at Suchitoto, spouse **Virginia Mendoza**, parents Matías López and Mauricia Carpio (register image `ark:/61903/3:1:33SQ-GTRF-NTF`). It is not attached in the tree. A second index of the same death, `ark:/61903/1:1:655Y-1SYB` (image `ark:/61903/3:1:3QHK-1Q52-59S4-G`), gives the same parents, 23 September 1916, and a computed birth year of 1844. The two civil indexes disagree by one day. No licensed reading of either civil register image exists (see "The first civil register image" and "The second civil register image" below; the AI reading of the first is discarded), so it is not established which of the two dates is his death date, or whether either is a registration date.

The identification rests on the indexes:

- **Name, wife and town.** It is the same name with the same wife, in the family's town; Alberto married there in May 1906.
- **No rival couple.** Every other Inocente López + Virginia Mendoza hit in the index is a record of this couple's children.
- **His mother's death.** Mauricia Carpio, wife of Matías López, died 27 October 1881 at San Pedro Perulapán (`ark:/61903/1:1:QP7K-XNNN`). That is where the couple's children Alberto (1886) and Luisa (1888) were born.

**The birth year is left unresolved.** The second civil index's computed 1844 birth, which the church index (`ark:/61903/1:1:6ZN7-Q5R4`) also gives, disagrees with the tree's 11 June 1860 birth at Oratorio de Concepción, and that 1860 birth has no source attached in the tree. The genealogist made the identity call on 14 October 2026 on the spouse, parents and place, despite the age.

**The church death record.** A Suchitoto church death record is indexed in "El Salvador, Catholic Church Records, 1655-1977" (`ark:/61903/1:1:6ZN7-Q5R4`). Its index gives Ynocente Lopez a death on 20 September 1916 and a burial on 21 September 1916, with birth 1844, spouse Virginia Mendoza and parents Matias Lopez and María N. Those index values are what f1 relies on.

**The death date is unresolved.** The church index gives a death on 20 September; the civil indexes give 22 and 23 September. The church index also names his mother María N., where the civil indexes give Mauricia Carpio. Nothing settles the day, so f1 accepts any one of 20, 21, 22 or 23 September 1916 as a single day, or September 1916. 21 September is the church index's burial date, not a date any index gives as his death date.

**The image reading is unlicensed.** The genealogist read the entry from the image (`ark:/61903/3:1:33SQ-GR3Z-2X2`, folio 36, first entry on the left-hand "Debe" page). Under `docs/e2e-testing-guide.md` Step 1a that reading is unlicensed, and nothing in f1 rests on it:

- **Only one indexed neighbour is on the target page.** Ricardo García (`ark:/61903/1:1:6ZN7-Q5R8`) was read as 23 September 1916, son of Salomé García and Angela Evora, and agrees with the index on child, father, mother and date. The page's two other entries, Ramón de Jesús (son of Higinio Iraheta and Felicita Recinos) and Miguel Ángel (son of Angelina Henrriquez), both dated 23 September 1916, have no death or burial entry in the index. Searches by name, parents and 1916 on 1 November 2026 found only unrelated baptisms. Step 1a needs two indexed neighbours on the page.
- **The facing page does not count.** Marcos de Dolores Melgar (`ark:/61903/1:1:6ZN7-Q5R5`), on the right-hand page of the same image, agrees with the index on child, father, mother and date, but he is not on the target page. The genealogist first read his age as about six and a half years; "año y medio" came from a model reading of the image.
- **The order was wrong.** The neighbouring entries were read after the target entry, not before it as Step 1a asks, and after their index values had been seen.

The reading is kept here as context only:

> En Suchitoto a veintiuno de Septiembre de mil novecientos dieciseis murio Inocente Lopez de setenta y dos casado con Virginia Mendoza hijo legitimo de Matias Lopez y Maria N; murio anoche de fiebre en El Molino. — De orden Superior, Evaristo Sanchez.

It suggests why the index reads as it does. The entry is dated 21 September and says he died "anoche", the night before. Every entry on the folio says *murio* and none mentions burial, and the page is stamped by the Gobernación Política of Cuscatlán. So the index's "burial" date is probably the date the entry was written. Because the reading is unlicensed, that is an interpretation, not evidence.

**The first civil register image.** The genealogist examined the layout of the image behind the first civil index, `ark:/61903/3:1:33SQ-GTRF-NTF`, to identify the entries and their positions on the two facing pages.

- **Layout.** The target, entry 382, is on the right-hand page, and entry 381 (Dolores) is above it on that same page. Entries 379 (Rufina Borja) and 380 (Felipe Landaverde) are on the facing left-hand page. Besides the target, only entry 381 is on the target's page.

No reading of this image is licensed under Step 1a, and nothing in f1 rests on it. Entry 381's index record (`ark:/61903/1:1:QPHJ-JVYY`) is linked to this image, but it is the only indexed entry on the target's page, and Step 1a needs two. Entries 379 and 380 also have index records linked to this image (`ark:/61903/1:1:QPHJ-JVY2`, `ark:/61903/1:1:QPHJ-JVYP`), but they are on the facing page, which, as for the parish image, is not treated as the target's page.

**The second civil register image.** The genealogist examined the image behind the second civil index, `ark:/61903/3:1:3QHK-1Q52-59S4-G`, personally. Their own reading:

- **Heading and opening.** The entry is headed "P. N. 382". Its opening line begins "En Suchitoto á veinti… de Sept…"; the day and the year were not legible to them.
- **Identity.** The first line names "Ynocente Lopez", and what appears to read "Virginia Mendoza" follows just below. They could not confirm the other details.
- **Death wording.** Not legible enough for them to vouch for.
- **Layout.** On the 3QHK image they examined, the target's page is the right-hand page: entry 381 (Dolores) is at the top and entry 382, the target, below it. The facing left-hand page holds entries 379 (Rufina Borja) and 380 (Felipe Landaverde). Besides the target, only entry 381 is on the target's page.

That reading is unlicensed under `docs/e2e-testing-guide.md` Step 1a, and nothing in f1 rests on it. The reason is the page, not who read it: only one other entry, 381, shares the target's page, and this register's index holds no record for it (its only index record, `ark:/61903/1:1:QPHJ-JVYY`, belongs to the first civil register). Step 1a needs two indexed neighbours on the same page.

Machine transcripts of this image are separate tool output, not the genealogist's reading, and are not relied on. FamilySearch's full-text transcript and an AI transcription (`image_transcribe`) both read the opening as "a veintitrés de Septiembre de mil novecientos diez y seis" and the death wording as "murió anoche a las ocho", and supply further identity details (age, occupation, parents, informant). None of these is the genealogist's observation.

What stays open is the day of death, and what the dates and "anoche" in the church and civil entries each mean.

**The 1916 page reading is discarded.** An AI transcription (`dev/try-image-transcribe.ts`) of `…-NTF` failed calibration. It read the given name "Paulina" where the index has Rufina Borja Suares (`ark:/61903/1:1:QPHJ-JVY2`), and the surname "Candavende" where the index has Felipe Landaverde (`ark:/61903/1:1:QPHJ-JVYP`). Nothing from that reading is relied on here.

Retrieval was tool-assisted: `packages/engine/mcp-server/dev/try-record-read.ts`, `try-record-search.ts` and `try-image-transcribe.ts` against live FamilySearch. The identity judgement was the genealogist's. The church death record's image was read by the genealogist on familysearch.org; its index and the neighbouring entries' index records were retrieved with the MCP `record_read` and `record_search` tools. The second civil register image was examined by the genealogist; its image group (`113701001`) was found with `volume_search`, and its full-text transcript was retrieved with `fulltext_search`.
