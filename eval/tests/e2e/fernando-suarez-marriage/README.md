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

**Resolved: TRUE MATCH (index-only).** The 11 November 1891 marriage at the Inmaculada Concepción parish, Aguadas, Caldas, of Fernando Franco and Maria de Jesus Ramirez (hint record `ark:/61903/1:1:QG2B-LVHQ`) is the marriage of the tree's Fernando Suarez Franco (`GZ6S-8MW`) and his wife Maria Jesus Ramirez Henao. The identity is settled on **two independent FamilySearch indexes**, with no image reading.

**What decided it.** The marriage index names the bride Maria de Jesus Ramirez's parents as **Luis Ramirez and Juana Henao**, and the groom's mother as **Manuela Franco** (no father given). Julia Rosa's 1896 Caramanta baptism (`ark:/61903/1:1:6DDW-L7XF`), **already attached to the tree** as a source on `GZ6S-8MW`, independently names — in its own FamilySearch index, not from the image — the child's maternal grandparents as **Luís Ramírez and Juana Henao** (an exact match to the 1891 bride's parents) and her paternal grandparents as **Juan de Dios Juárez** (an indexing variant of Suárez) **and "Manue la" Franco** (an indexing split of Manuela Franco). The maternal-grandparent match ties the tree's Maria Jesus to the 1891 bride; the paternal pair supplies the father the marriage index omitted, so the chain closes without the register image.

**The Franco/Suárez surname difference is explained, not a conflict.** The 1891 marriage indexes the groom matronymically as "Fernando Franco" — mother Manuela Franco, no father — which on its own reads as a natural son. The baptism five years later gives the same man his father's name, "Fernando Suárez," son of Juan de Dios Suárez and Manuela Franco, which is what the tree carries. Same distinctive four-grandparent set across two independent records resolves the gap.

**Event place.** Kept as the record's own Marriage fact states it: **Inmaculada Concepción, Aguadas, Aguadas, Caldas, Colombia**. The register *image volume* is catalogued under the Inmaculada Concepción parish of **Salamina** (the neighbouring town), but that is the volume's cataloguing location, not the event place the record gives — so Aguadas stands (cf. PR #2911, use the record's stated place).

**Supporting context.** The tree's own 1931 remarriage to Rosaura Balesteros (`ark:/61903/1:1:QGLM-JB3R`) is in the same town, Aguadas; a marriage in 1891 sits sensibly before the first child baptized in Caramanta in 1896; and none of the tree's existing sources is a marriage of this couple, so nothing in the tree is a re-index of this entry. The tree's 1849 birth year for Maria Jesus cannot be right for a mother of children born 1896–1904 and is not a basis to reject. `f2` (the bride's parents) is not required: the question asks for the marriage, but an agent that reads the entry should record them.

**Second opinion.** Genealogist Isaac Boateng independently reviewed and concurred: a true match — Fernando Suárez Franco married María Jesús Ramírez Henao on 11 November 1891 in Aguadas; the original record calls him Fernando Franco because he was identified as the natural son of Manuela Franco, and the daughter's later baptism connects both parents and all four grandparents, strongly supporting the identification. The concurrence is on the same index-only evidence; it introduces no image-derived claim.

**Retrieval** was read-only via the MCP `record_read` tool against live FamilySearch (the hint marriage and the 1896 baptism); the identity judgement is the genealogist's. No image was read, so `fixture.json` carries `image_basis: false` and the Step 1a image-calibration rule does not apply.
