# Olaya Guerrero — marriage in October 1768, Higüey, Dominican Republic

**Source PID:** `L17S-LBY`
**Olaya Guerrero is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1732 in Higüey; the tree carries an undated Death fact and no parents. Her couple relationship with Baltazar Guerrero has no marriage fact; their daughter Rosa was born 2 September 1769 in Higüey. The tree also gives her a second husband, Patraiar Guerrero, who shares the daughter Maria Guerrero Guerrero with Baltazar.

## Research question

> When and where did Olaya Guerrero, born about 1732 in Higüey, marry Baltazar Guerrero, the father of her daughter Rosa born in Higüey in September 1769, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `L17S-LBY` with relatives). Nothing was
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

**Resolved 2026-10-15 (issue #3330): the hint is a true match.** Adjudicated by Ikennaya1. The hint (`ark:/61903/1:1:XLLN-5JM`, "Dominican Republic, Marriages, 1743-1929", an index with no image) is the bride's persona of the 13 October 1768 Higüey marriage of Baltasar Guerrero, son of Gregorio Guerrero and Maria Ygnacia Garrido, and Olaya Vrtarte (Urtarte), daughter of Gregorio Vrtarte and Baltasara de Reyna. The tree's Baltazar already cites the groom's persona of the same entry (`ark:/61903/1:1:XLLN-5J3`).

The one obstacle was her surname: the tree's own sources call her Olaya Guerrero (Rosa's 1769 baptism, `ark:/61903/1:1:6D5T-HK71`; Maria's 1790 marriage, `ark:/61903/1:1:6R89-C6L3`, which names the parents "Patraiar Guerrero" and Olaya Guerrero). What settles it is the **29 May 1793 Higüey marriage of Bernardo Castañeda and "Balrasara Genero"** (`ark:/61903/1:1:6R89-44PS`, "Dominican Republic, Civil Registration, 1744-2019"), which names the bride's parents as **Baltasar Gerrero and Olaya Hurtarte**. That ties the 1768 bride's surname to Baltasar Guerrero's wife Olaya independently of the hint, in the same town, and the daughter carries the 1768 bride's mother's given name. The "Guerrero" in the 1769 and 1790 entries reads as the husband's surname written for the wife. Rosa's birth about 2 September 1769, eleven months after the wedding, fits.

**Searched and empty:** a Dominican Republic marriage of an Olaya to a Baltasar Guerrero other than the 1768 entry and the 1793 daughter's record; any other indexed record of an Olaya whose parents are a Gregorio and a Baltasara (only the hint returns); baptisms of children of a Baltasar Guerrero and an Olaya, 1765–1785, naming the mother's surname (none indexed with parents). What stays unproved: the 1793 bride Baltasara is not in the tree, and "Patraiar" in the 1790 index as Baltasar is a reading, not checked against the image.

**Retrieval** was tool-assisted (`record_read`, `record_search` through the engine, in Claude Code); the identity judgement is the genealogist's. The indexes settled it, so `image_basis` is not set. Rosa's 1769 baptism image (`ark:/61903/3:1:33S7-9RP9-RCC`) was transcribed to look for maternal grandparents and names none (mother "Olaya Guerrero"); that reading is **unlicensed** — the page's only other complete entry, Nicolasa (1 October 1769, daughter of Gregorio Rixo and Manuela Guerrero), is not in the FamilySearch index, so the two-entry check could not be met — and nothing here rests on it.
