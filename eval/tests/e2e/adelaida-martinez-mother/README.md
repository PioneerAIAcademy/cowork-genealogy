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

**RESOLVED — DIFFERENT ANSWER / CONFLATION (Outcome b).** The starting tree
conflates **two different women** of Dolores, Soriano, both daughters of a Juan
Martínez. The research challenge is to discover that conflation, not merely to
reject the hint:

- **Adela Natividad Martínez `GRS9-MCH`** — baptized 11 February 1872 (b. 25
  December 1871), daughter of Juan Martínez and **Josefa Segovia** (who married
  Juan Martínez 26 December 1866). Her mother is settled by her own two
  contemporaneous baptism indexes, `ark:/61903/1:1:F2BL-3XN` and
  `ark:/61903/1:1:FLSQ-VWB`.
- **Valentina Adelaida Martines** (FamilySearch person `9NDQ-JQ7`) — born about
  15 December 1875 (christened 19 January 1876), daughter of Juan Martínez and
  **Dolores Milan** (also indexed Vidal/Bilares). Her own baptism,
  `ark:/61903/1:1:FLSQ-1NP`, names her mother Dolores Milan. **She is the woman
  Rufino Moreira Cruz married in 1896**, and the hint (`ark:/61903/1:1:XS6N-1GXK`,
  the 17 June 1896 civil marriage) concerns her.

**Both 1896 marriage records describe the Dolores-mothered woman, not the 1871
baptism.** The 9 April 1896 church marriage's bride persona
(`ark:/61903/1:1:XS61-CNFW` — note: `XS61-CNF3` is the **groom's** persona) gives
the bride born about 1876 with mother Dolores Vidal; the 17 June 1896 civil
marriage gives mother Dolores. That is a systematic, two-record agreement on a
bride born ~1876 with mother Dolores — a different woman from the 1871-baptized
Adela Natividad (mother Josefa Segovia). The live FamilySearch tree already bears
this out: it holds `9NDQ-JQ7` as a separate person, couples Rufino to **both**
women (church 9 Apr to `GRS9-MCH`, civil 17 Jun to `9NDQ-JQ7`), and the hint
record is already attached to `9NDQ-JQ7` — the conflation made visible.

**Independent confirmation from 1914.** In her own later civil marriage — Adela
Martínez to Francisco Pilar Carmona at Gualeguaychú, Entre Ríos, 12 August 1914
(`ark:/61903/1:1:DMJK-BWMM`, already a tree source) — the bride is recorded born
about 1873, daughter of Juan Martínez and **Josefa Segovia**, with marital status
**single** (soltera). Had `GRS9-MCH` been Rufino Moreira's wife (married 1896;
Rufino died 1903) she would appear in 1914 as a **widow**, not single. Being single
in 1914 confirms she never married Rufino — so the 1896 Rufino marriage belongs to
the other, Dolores-mothered woman, independently of the two-baptism comparison.

**The correct resolution** is therefore that Rufino's 1896 wife was a distinct
woman — born about 1875/1876, daughter of Juan Martínez and a mother named Dolores
(Milan/Vidal/Bilares) — separate from `GRS9-MCH` (the 1871-baptized daughter of
Josefa Segovia), and the starting tree wrongly assigns `GRS9-MCH` the 1896 marriage
and children that belong to that other woman. **That distinct-woman-with-mother-
Dolores conclusion is the required finding.** The strongest form — identifying her
specifically as **Valentina Adelaida Martines** (`9NDQ-JQ7`, baptism
`ark:/61903/1:1:FLSQ-1NP`, mother Dolores Milan) — is not required for a match, and
the agent need not discover the exact PID. The hint's "Dolores" mother is real, but
it belongs to that woman, not to the 1871-baptized Adela Natividad. Correcting the
live tree (splitting the two women, moving the marriage and children to
`9NDQ-JQ7`) is **out of scope** for this resolve-only fixture and was not done;
`9NDQ-JQ7` appears here only as a reference, never as an evidence ark.

**Why the date is not the disproof.** The hint is indexed "17 June 1879", an
artifact of the collection's start year ("Uruguay, registro civil, 1879-2020");
the record's own indexed coverage and the register image both read 17 June 1896.
The impossibility of "1879 vs a subject born 1871" is not what settles the case —
the two distinct baptisms (Josefa vs Dolores) do. The father agreeing (Juan
Martínez, a common name), the shared surname, town and 1896 year are the bait; the
two mothers and the two birth years are the tell.

**Independent second opinion.** Isaac Boateng (an independent genealogist; not a
senior genealogist, and not the adjudicator) reviewed the evidence separately and
concluded that Adela Natividad Martínez `GRS9-MCH` (b. 25 Dec 1871, parents Juan
Martínez and Josefa Segovia) is a different woman from the 1896 Rufino-Moreira
bride, whom he identifies as Valentina Adelaida Martines `9NDQ-JQ7` (b. ~1875/76,
daughter of Juan Martínez and Dolores Milán); he recommends not merging the two
women. His identity-separation matches this resolution.

**Provenance.** Retrieval was tool-assisted via the genealogy MCP read tools
(`record_read`, `record_search`, `person_read`, `image_transcribe`); **no
`dev/try-*.ts` scripts were used.** The 17 June 1896 civil-registration image
(`ark:/61903/3:1:3Q9M-CS24-69RJ-5`) was examined but, under the page cross-check
rule, carried only one other indexed entry, so that image transcription is **not
licensed** and no image-only field is relied upon: every load-bearing fact rests
on FamilySearch **index** records (`FLSQ-1NP`, `XS61-CNFW`, `F2BL-3XN`,
`FLSQ-VWB`, `DMJK-BWMM`). The hint's own ark is not used as independent
corroboration.
