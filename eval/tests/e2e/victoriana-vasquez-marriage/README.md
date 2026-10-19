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

**Resolved: OUTCOME 2 (the answer is something else).** The hint is a true
identity match to tree person Victoriana Vasquez (`GFG9-7H4`), but the 9 January
1875 record is a **velación (nuptial blessing)**, not the couple's marriage. The
research question asks when and where Victoriana married Jose Cleofas Gutierrez;
the answer is **about 1859, at Huerta de San Juan, feligresía de San Pedro
Piedragorda** — not 9 January 1875. Two required findings: **f1** that the 1875
event is a velación, and **f2** the earlier (~1859) marriage.

**Indexed facts.** The hint `ark:/61903/1:1:JC8N-Y3P` ("Mexico, Marriages,
1570-1950") and its parish counterpart `ark:/61903/1:1:684J-DSBM` (bride persona
`684J-DSBS`, "Mexico, Jalisco, Catholic Church Records, 1590-2022") record the
9 Jan 1875 event, but index it only as a marriage naming only the couple.
Identity rests on the 1879 Degollado civil death registration
`ark:/61903/1:1:QGWN-N5CM`, whose index fields name María Victoriana Vázquez
Sandoval (d. 2 Sep 1879, Degollado) as **wife of Cleofas Gutiérrez** and
**daughter of Remigio Vázquez + María Bernarda Sandoval** — tying the husband and
parentage of `GFG9-7H4` to this couple. The marriage is corroborated by the
couple's children: daughter María Gregoria's 1879 death
(`ark:/61903/1:1:QGWJ-3HQ9`; parish burials `ark:/61903/1:1:684X-KYNG`,
`ark:/61903/1:1:684J-1Y17`) and daughter Silveria's 1900 marriages
(`ark:/61903/1:1:QG71-GYY1`, `ark:/61903/1:1:QGQT-KZY4`,
`ark:/61903/1:1:XQZ8-RJT9`), all naming Cleofas Gutiérrez + Victoriana Vázquez as
parents.

**Calibrated image-read facts (`image_basis: true`).** The register page image
`ark:/61903/3:1:9392-VB9H-51` shows the 9 Jan 1875 entry is a **velación**
("velados … velé solamente … acto de su velacion") and states the couple **"fueron
casados han dieziseis años, en la Huerta de San Juan, feligresía de San Pedro
Piedragorda"** (had been married sixteen years, at Huerta de San Juan). This
reading is licensed under the Step 1a two-entry check — two other indexed entries
on the **same image** match the reading on couple, parents and date:

- **Asencio × de León** (`ark:/61903/1:1:684J-LXF8`): index IntendedMarriage
  12 Jan 1875; groom's parents Ignacio Navo + Dolores Asencio, bride's mother
  Vicenta García — matches the right-page entry read.
- **Timoteo Rico × Virginia García** (`ark:/61903/1:1:684J-8WXW` /
  `ark:/61903/1:1:XQFP-JG15`): index marriage 8 Jan 1875; groom's parents
  José Mª Rico + Mª Isabel Chavolla, bride's parents Juan García + Mª Soledad
  Ruiz — matches the left-page entry read.

(The image is filed in the index under Degollado, but reads San Ignacio de los
Encinos, Parroquia de Ayo el Chico.)

**Inferences and limits.** The marriage year **~1859 is derived** from the
velación's "sixteen years" statement, not indexed; the **exact marriage date is
unknown**. The **original ~1859 marriage register was not located** (San Pedro
Piedragorda). **No baptism was found for either daughter**
(Silveria 1876, Gregoria 1878) — the children are evidenced by Silveria's 1900
marriages and Gregoria's 1879 death/burials, not by baptisms. The identity link
(`GFG9-7H4` = the woman in the 1879 death registration = the velación bride) is a
standard GPS correlation, strongly supported because her parents, her husband,
and the place coincide.

**Second opinion — pending senior-genealogist review.** Issue #3351 names two
deciding checks (the parish marriage entry naming the bride's parents, and a
Silveria Gutiérrez baptism); **neither was located** (the velación does not name
her parents, and no baptism was found). Identity instead rests on the 1879 death
registration, and the velación reclassification on the calibrated image read.
This reinterpretation is well-evidenced but more involved than a simple hint
adjudication, so the issue's second-opinion requirement **remains to be addressed
through senior-genealogist review. Sign-off is pending; no approver is named and
no agreement is claimed here until it actually occurs.**

**Retrieval** was read-only via the MCP `person_read` / `record_read` /
`record_search` / `image_transcribe` tools against live FamilySearch; the image
reading was calibrated per Step 1a (above), and the identity and event
judgements are the genealogist's.
