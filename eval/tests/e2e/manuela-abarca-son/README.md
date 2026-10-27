# Josefa Manuela Abarca Fallas — a son José Vidal born October 1899, San Juan de Dios, Desamparados, Costa Rica

**Source PID:** `G7XQ-GMG`
**Josefa Manuela Abarca Fallas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 12 June 1873 at Aserrí, San José; daughter of Rafael de Jesús Abarca Monge (died 1891) and Francisca de Jesús Fallas Alfaro (died 1900), whose family runs through Desamparados and Aserrí. Her marriage information with Juan García Calderón (born about 1862) is dated 30 December 1890 at the San José cathedral, and the civil marriage registration 15 January 1892; the tree's couple fact puts the marriage at Aserrí on 14 January 1892. The tree carries no children for the couple.

## Research question

> Josefa Manuela Abarca Fallas, born 12 June 1873 at Aserrí, San José, daughter of Rafael de Jesús Abarca Monge and Francisca de Jesús Fallas Alfaro, married Juan García Calderón by civil registration in January 1892. What children did Manuela and Juan have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `G7XQ-GMG` with relatives). Nothing was
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

**Resolved: TRUE MATCH** (adjudicated 2026-10-27; index/record-based, `image_basis: false`).
Retrieval was tool-assisted (MCP `record_read` / `record_search` / `person_read` /
`source_attachments`, and `image_transcribe` for the register page); the identity
judgement is the genealogists'.

**What the records establish (direct evidence).** The hinted civil birth
(`ark:/61903/1:1:QL6V-B2FY`) records **José Vidal García Abarca, born 22 October 1899 at
San Juan de Dios**, Desamparados, legitimate son of **Juan García** and **Manuela Abarca**.
His **baptism** two days later (`ark:/61903/1:1:NQ2L-5MY`, 24 Oct 1899, San Luis de Asserrí)
and his **death** as an infant (`ark:/61903/1:1:7XRW-KN6Z`, 28 Feb 1901, San José, residence
San Juan de Dios) name the same parents and give his surname as "García Abarca". The couple's
**marriage** — church **14 January 1891** at Aserrí (`ark:/61903/1:1:66DM-DGK8` /
`ark:/61903/1:1:66DM-DGK4`) and civil, marriage stated **14 January 1892** and **registered
15 January 1892** at San José (`ark:/61903/1:1:6KJJ-CFF4` / `ark:/61903/1:1:6KJJ-CFF3`) —
names the bride as **Manuela Abarca Fallas, daughter of Rafael Abarca and Francisca Fallas**,
and the groom as Juan García Calderón, son of Eugenio García and Manuela Calderón. (The
header above describes a San José cathedral entry on 30 December 1890; read against the tree's
own "información matrimonial" fact, this is the pre-ceremony marriage information recorded
ahead of the 14 January 1891 parish ceremony at Aserrí, with civil registration in January
1892 — an interpretation of the existing description, not a separately verified record.) The
**subject's own baptism** (`ark:/61903/1:1:NQ22-Z7Z`, 12 Jun 1873, San Luis de Asserrí) names
the same parents, Rafael Abarca and Francisca Fallas.

**The register image — read and calibrated.** The 1899 birth register page
(`ark:/61903/3:1:33S7-9THH-ZP3`) was OCR-transcribed. Two other indexed entries on the same
page were compared image-against-index and both matched on child, date and parents — no.
38254 Melida Salomé Díaz Mora (`ark:/61903/1:1:QL6V-GX7J`) and no. 38255 José Joaquín Jiménez
López (`ark:/61903/1:1:QL6V-249S`) — so the reading is licensed. The target entry (no. 38256)
confirms José Vidal as the legitimate son of a married Juan García and Manuela Abarca.
(The parents' San Juan de Dios residence is **not** taken from this image — the same-page
calibration does not license a residence; it is independently recorded in the birth index
and the death record above.) **Limitation:** this register names each parent by a single
surname and records no grandparents, so the image does **not** supply the mother's second
surname or her parents. It corroborates the birth but is not the discriminator — which is why
`image_basis` is **false**: the identity rests on the marriage and baptism index records
above, not on the image.

**Direct evidence vs. inference.** Direct: the records above. Inferential: (1) that the
short-surname José Vidal of the birth/baptism/death records is *this* couple's son — resting
on the parents' names, the San Juan de Dios residence, the child's "García Abarca" surname,
the family parish (San Luis de Asserrí), and his chronological fit within a single coherent
García Abarca sibling set. A FamilySearch index search for "García Abarca" children of a Juan
García × Manuela Abarca couple in San José province, 1890–1917, surfaced only this one family
and no competing couple; that search is **index-bounded, not exhaustive** — an unindexed
baptism, a variant-spelled name, or an event outside that window or province need not appear —
so the absence of a competitor is **supporting, not conclusive**. And (2) the duplicate-profile
identification below.

**Duplicate profiles.** The subject `G7XQ-GMG` (Josefa Manuela Abarca Fallas) and `GSJN-6X7`
(María Manuela Abarca Fallas) are judged the **same woman, duplicated**: identical parents
(`LRN1-QBJ` Rafael Abarca Monge + `LQRP-316` Francisca Fallas Alfaro), same name, birth 1873,
and each married a Juan García Calderón. The two profiles' marriage dates (14 Jan 1892 and
14 Jan 1891) correspond to the civil and church records of a single marriage: the same
four-parent set appears on both records, which is **best explained as one marriage recorded
in two systems** rather than two separate marriages — a well-supported conclusion, though not
independently proven. Juan García Calderón is likewise duplicated (`PDC2-5PM` = `GSJN-JH6`).
José Vidal (live-tree PID `GZ54-NLV`) and his siblings hang off the `GSJN-6X7` side, where the
hint is **already correctly attached**; the subject profile `G7XQ-GMG` has no children only
because it is the thin duplicate. (`GZ54-NLV` and `GSJN-JH6` are live FamilySearch PIDs; this
fixture's starting snapshot contains `G7XQ-GMG`, `GSJN-6X7` and `PDC2-5PM`, not those two.) The real-world correction is a **duplicate-profile merge**
(`G7XQ-GMG`↔`GSJN-6X7`, `PDC2-5PM`↔`GSJN-JH6`), after which the subject carries José Vidal;
the hint itself does not need re-attaching.

**Concurrence.** Resolved by the researcher; **Isaac Boateng** conducted an independent
genealogical investigation of the same question and reached the same conclusion — a true
match. **Revisit** if the baptism or marriage register images are later read and name the
mother's second surname or grandparents (converting the indirect child→couple tie to direct
evidence), or contradict the identification, or if a competing Juan García × Manuela Abarca
couple emerges.
