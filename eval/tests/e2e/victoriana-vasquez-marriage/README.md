# Victoriana Vasquez — marriage in January 1875, Degollado, Jalisco, Mexico

**Source PID:** `GFG9-7H4`
**Victoriana Vasquez is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her, and no dates, places or sources for anyone in the family. Daughter of Remigio Vasquez and Bernarda Sandoval; wife of Jose Cleofas Gutierrez, with no marriage fact on the couple; mother of Silveria Gutierrez.

## Research question

> When and where did Victoriana Vasquez, daughter of Remigio Vasquez and Bernarda Sandoval, marry Jose Cleofas Gutierrez?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GFG9-7H4` with relatives). Nothing was
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

**Resolved: OUTCOME 1 (true match), on index evidence.** The 9 January 1875
Degollado marriage of José Cleofas Gutierrez and Victoriana Vázquez (hint
`ark:/61903/1:1:JC8N-Y3P`) **is** the marriage of tree person Victoriana Vasquez
(`GFG9-7H4`). The call does **not** rest on the two marriage-hint names alone
(the issue is explicit that would be insufficient); it rests on a separate
indexed record that ties this couple to her parentage.

**What decided it (indexed records, no images read):**

- **The marriage hint names only the couple.** The index entry
  (`ark:/61903/1:1:JC8N-Y3P`, "Mexico, Marriages, 1570-1950") and its parish
  counterpart (`ark:/61903/1:1:684J-DSBM`, bride persona
  `ark:/61903/1:1:684J-DSBS`, "Mexico, Jalisco, Catholic Church Records,
  1590-2022") carry no parents, ages, or residences — so on their own they only
  establish a Degollado couple of these two names.
- **The deciding record is the 1879 Degollado civil death registration**
  (`ark:/61903/1:1:QGWN-N5CM`, "Mexico, Jalisco, Civil Registration,
  1857-2000"). Its **index fields** record **María Victoriana Vázquez Sandoval**
  (born about 1841, died 2 September 1879, Degollado, Jalisco) as the **wife of
  Cleofas Gutiérrez** *and* the **daughter of Remigio Vázquez and María Bernarda
  Sandoval**. That single record connects **both** the husband **and** the
  parentage of the tree person — who is defined precisely as daughter of Remigio
  Vasquez + Bernarda Sandoval and wife of Jose Cleofas Gutierrez — to this
  couple in Degollado.
- **Corroboration:** the 1879 Degollado parish burials of María Victoriana
  Vázquez (`ark:/61903/1:1:684J-DSKS`, `ark:/61903/1:1:684V-3N76`, burial 5 Sep
  1879, b. ~1841), consistent with the death registration; and later Jalisco
  civil marriages of the couple's children naming Victoriana Vázquez + Cleofas
  Gutiérrez as parents (e.g. `ark:/61903/1:1:QGQR-T5DH`).

**Indexed evidence vs. inference.** Everything above is read from the
FamilySearch **index**, not from any page image. The *verified* facts are the
indexed record contents (the 1875 marriage; the 1879 death registration naming
husband + both parents in Degollado; the burials; the children's marriages). The
*inference* — standard GPS identity correlation — is that tree person `GFG9-7H4`
is the woman in the 1879 death registration and therefore the 1875 bride; it is
strongly supported because her parents, her husband, and the place all coincide
in that one record, and no competing Victoriana Vázquez with these exact parents
and this husband surfaced.

**No page images were examined (`image_basis: false`).** The marriage and death
records each carry a page image, but none was read; the identification is made on
indexed fields only, so no Step 1a image-calibration applies and nothing here is
presented as direct proof from an image.

**Searched and not found (not needed):** a Degollado baptism of a Silveria
Gutiérrez naming Cleofas Gutiérrez + Victoriana Vázquez as parents — the other
check the draft suggested — was searched for and **not** located. It is not
needed: the 1879 death registration already settles the identity.

**Retrieval** was read-only via the MCP `person_read` / `record_read` /
`record_search` tools against live FamilySearch; the identity judgement is the
genealogist's.
