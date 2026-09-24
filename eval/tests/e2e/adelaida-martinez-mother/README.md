# Adelaida Martinez — a mother named Dolores Bilares

**Source PID:** `GRS9-MCH`
**Adelaida Martinez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 25 December 1871 and christened 11 February 1872 at Dolores, Soriano, Uruguay; death not recorded in the tree.

## Research question

> Was Adelaida (Adela) Martínez, wife of Rufino Moreira of Dolores, Soriano, the daughter of Juan Martínez and Dolores Bilares, or of Juan Martínez and Josefa Segovia as the tree records?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `GRS9-MCH` with relatives). Nothing was
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

**RESOLVED — FALSE MATCH (Outcome c).** The hint (`ark:/61903/1:1:XS6N-1GXK`,
the Adela Martínez persona on an 1896 Rufino Moreira marriage) does **not**
belong to Adelaida (Adela Natividad) Martínez `GRS9-MCH`. Her mother is **Josefa
Segovia**, not Dolores Bilares.

**Her mother is settled by contemporaneous baptism.** Adelaida was baptized
11 February 1872 at Dolores (b. 25 December 1871). Both 1872 baptismal indexes
name her parents **Juan Martínez and Josefa Segovia** (`ark:/61903/1:1:F2BL-3XN`
and `ark:/61903/1:1:FLSQ-VWB`), and Josefa Segovia married Juan Martínez on
26 December 1866. A mother named at a child's own baptism outweighs one recited
on a marriage a quarter-century later.

**The date is not the disproof.** The hint is indexed "17 June 1879", which is an
artifact of the collection's start year ("Uruguay, registro civil, 1879-2020");
the record's own indexed coverage gives 17 June 1896, and the register image
reads the same. The real event is the **17 June 1896 civil marriage
registration** of Rufino Moreira and Adela Martínez at Villa de Dolores — not an
1879 event, and the impossibility of "1879 vs a subject born 1871" is **not**
what settles the match.

**The hint concerns a different Adela Martínez.** Both 1896 marriage records —
the church marriage of 9 April 1896 (`ark:/61903/1:1:XS61-CNF3`, already a tree
source) and the civil registration of 17 June 1896 (the hint) — describe a bride
**born about 1876** whose mother was named **Dolores** (indexed Vidal on the
church record, Bilares/Milans on the civil one), daughter of Juan Martínez. That
is a systematic, two-record disagreement with the subject's 1872 baptisms
(b. 1871, mother Josefa Segovia) — a different woman, not a lone indexing slip.
The independent second opinion (below) identifies her as **Valentina Adelaida
Martines (`9NDQ-JQ7`)**. Correcting the live tree's apparent conflation is **out
of scope** for this resolve-only fixture and was not done.

The father agreeing (Juan Martínez, a common name) and the shared surname, town
and 1896 year are the bait; the mother and the bride's birth year are the tell.

**Independent second opinion.** Isaac Boateng (an independent genealogist; not a
senior genealogist, and not the adjudicator) reviewed the evidence separately and
concluded that Adela Natividad Martínez `GRS9-MCH` (b. 25 Dec 1871, parents Juan
Martínez and Josefa Segovia) is a different woman from the 1896 Rufino-Moreira
bride, whom he identifies as Valentina Adelaida Martines `9NDQ-JQ7` (b. ~1875/76,
daughter of Juan Martínez and Dolores Milán); he recommends rejecting the hint
for `GRS9-MCH` and not merging the two women.

**Provenance.** Retrieval was tool-assisted via the genealogy MCP read tools
(`record_read`, `record_search`, `image_transcribe`); **no `dev/try-*.ts`
scripts were used.** The 17 June 1896 civil-registration image
(`ark:/61903/3:1:3Q9M-CS24-69RJ-5`) was examined and reads consistently with the
1896 civil marriage, but under the page cross-check rule it carried only one
other indexed entry, so that image transcription is **not licensed** and no
image-only field is relied upon: every load-bearing fact (the 1896 date, the
bride's ~1876 birth, and the mother named Dolores vs Josefa Segovia) rests on
FamilySearch **index** records (`XS6N-1GXK`, `XS61-CNF3`, `F2BL-3XN`,
`FLSQ-VWB`). The hint's own ark is not used as corroboration.
