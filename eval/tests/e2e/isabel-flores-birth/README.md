# Isabel Flores — birth in July 1880, San Pablo, Laguna, Philippines

**Source PID:** `GCNR-K3J`
**Isabel Flores is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her — no birth. Parents Apolonio Flores and Catalina Ortiz (undated). Husband Fermin Barleta, born 6 July 1878 and baptized in San Pablo City, Laguna; children Aproniano (1904), Cesario (baptized 29 February 1908) and Florentina (baptized 28 March 1911), all of San Pablo.

## Research question

> When and where was Isabel Flores born, the wife of Fermin Barleta (born 1878) and mother of Aproniano (1904), Cesario (1908) and Florentina (1911) Barleta of San Pablo, Laguna, Philippines?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GCNR-K3J` with relatives). Nothing was
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

**Resolved: TRUE MATCH (index-only).** The 1880 San Pablo baptism of Isabel Flores (hint record `ark:/61903/1:1:666Y-8VPJ`) is the birth record of the tree's Isabel Flores (`GCNR-K3J`), wife of Fermin Barleta. She was born 7 July 1880 and baptized 11 July 1880 at San Pablo (Saint Paul the First Hermit), Laguna, daughter of Policronio/Apolonio Flores and Catalina Ortiz.

**What ties it together — the parents' 1877 marriage.** The marriage of **Apolonio Flores and Catalina Ortiz**, 5 February 1877, San Pablo (`ark:/61903/1:1:XWM9-CGG8`, index), is the record that connects the 1880 baptism to the tree:

- **The mother correlates strongly as the same Catalina Ortiz.** The 1877 marriage names the bride Catalina Ortis as daughter of **Antonio Ortis and Rita Gusman**; the 1880 Isabel baptism names the maternal grandparents as **Antonio Ortes and Rita Gusmán**. Both grandparents agree, allowing for spelling — a strong indication of the same Catalina Ortiz.
- **The father is very likely the same man**, recorded as **Apolonio** in his own 1877 marriage — the name the tree and the children's baptisms carry — with mother **Maria Gulaylay**, matching the 1880 baptism's paternal grandmother **Maria Gulaglay** (a rare, distinctive surname). So the 1880 register's "**Policronio**" is the minority reading against Apolonio in the 1877 marriage and the 1908 and 1911 baptisms, and is best explained as a scribal variant. (The paternal grandfather likewise varies, Fulgencio in 1877 vs Florentino in 1880 — a secondary scribal slip; the grandmother anchors the line.)

Taken together, this points to the 1880 Isabel being a daughter of Apolonio Flores and Catalina Ortiz — the tree's Isabel's parents. It is corroborated by two of Isabel's children's baptism indexes, which name her parents as Apolonio and Catalina Ortiz: Cesario 1908 (`ark:/61903/1:1:66X7-T1CZ`) and Florentina 1911 (`ark:/61903/1:1:66NS-KNYT`). (The couple's first child, Aproniano, is dated about 1904 from later records; no 1904 baptism index was located for this analysis.)

**Competing candidate excluded and alternatives searched.** The other Barleta × Isabel(a) Flores couple — Apolinario Barleta and Isabela Flores, married 1871 (`ark:/61903/1:1:XWMQ-426F`), parents of Rufina (b. 1874) — is an earlier generation and ruled out. A search of San Pablo baptisms 1865–1895 found **no other Flores child of Catalina Ortiz**, so there is only one Isabel baptism; no childhood burial of the 1880 Isabel was found (San Pablo burials of the era are sparsely indexed). The chronology fits: born July 1880, a plausible wife for Fermin Barleta (b. July 1878), with their first child about 1904 per later records.

**Why not the marriage of Fermin and Isabel.** That marriage (San Pablo, ~1900–1903) would have been the most direct discriminator, but it is **not indexed**, and its register volume (image group `007771115`) is **image-restricted (HTTP 403)** — it could not be read. The identification does not depend on it.

**The resolution is index-only; the image was a non-load-bearing cross-check.** Every fact relied on here is in the FamilySearch **index**, including the father's name "Policronio" and the grandparents' names on the 1880 baptism, so `fixture.json` sets `image_basis: false`. As a cross-check the 1880 baptism image (`ark:/61903/3:1:3Q9M-CSM6-4HJJ`) was read once and agreed with the index on the Isabel entry's child, baptism date and father; two other entries on the same page — **Isabelo Aquino** (`ark:/61903/1:1:666Y-8VPW`) and **Tranquilina Estrellado** (`ark:/61903/1:1:666Y-8VGJ`) — were compared against the index per Step 1a and agreed on child, father and date. The image's **additional** details — the grandparents' spellings (e.g. Ortis/Guzman) and a "difunta" (deceased) note for Rita Gusmán and María Gulaglay — are **not** licensed by the Step-1a check and are **not** used; the grandparent names in this write-up are taken from the index.

**Retrieval** was read-only via the MCP `record_read` / `record_search` / `image_transcribe` tools against live FamilySearch; the identity judgement is the genealogist's.
