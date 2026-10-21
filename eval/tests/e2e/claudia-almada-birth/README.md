# Claudia Almada — birth about 1861, Buenos Aires, Argentina

**Source PID:** `G5RB-GL5`
**Claudia Almada is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth and an undated Death fact for her. Daughter of Gregoria Almada; married Alejandro Sequeira on 12 May 1879 at Nuestra Señora de la Merced, General Lavalle, Buenos Aires; mother of Lujana Juana Sequeira, baptized there on 19 August 1880.

## Research question

> When and where was Claudia Almada born, the daughter of Gregoria Almada who married Alejandro Sequeira on 12 May 1879 at Nuestra Señora de la Merced, General Lavalle, Buenos Aires, Argentina?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G5RB-GL5` with relatives). Nothing was
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

**Resolved 2026-10-19 — true match (outcome 1), a borderline call made with a
second genealogist's concurrence.** This fixture comes from a hint batch
(`filtered-list-samples-3.csv` row 34, `hint-samples.csv` row 16, flag
`adds_birth`, confidence 3). The hint is "Argentina, National Census, 1869"
(`ark:/61903/1:1:M4WC-C2Z`): Claudia Almada, Argentine, age 8, born
"Buenos Aires", enumerated at Ajó, the partido whose images are filed under
General Lavalle. The finding "born about 1861, Buenos Aires, Argentina" stands.
Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts`, spec
§3.6); the identity judgement is the genealogists'. Every conclusion below rests
on FamilySearch indexes; no page image was read.

**Baseline.** The tree's only record source for Claudia is her persona
`ark:/61903/1:1:XNDD-ZL1` on her daughter Lujana Juana's 19 August 1880 baptism
at General Lavalle, which gives her no age, birthplace or parents. Her marriage
and her mother come from the Computer-Generated Tree. Nobody in the tree holds
the census entry, so it is not a re-index of an attached source.

**The marriage records.** Her 1879 marriage to Alejandro Sequeira is indexed
three times in "Argentina, Buenos Aires, registros parroquiales, 1635-2017":

- the marriage investigation file of 10 May 1879 (`ark:/61903/1:1:X47K-ZPDV`);
- the marriage of 12 May 1879 at Nuestra Señora de la Merced
  (`ark:/61903/1:1:CTHW-9YZM`, re-indexed as `ark:/61903/1:1:QGRK-DM48`).

All three name her mother as Gregoria Almada, with no father, and the
investigation file and the re-indexed marriage give her birth year as 1860.
None gives a birthplace. The issue made this birthplace the
deciding check, and it is absent.

**No image reading is licensed.** The calibration rule needs two other indexed
entries on the same page:

- The investigation file's image (`ark:/61903/3:1:939D-GZ93-56`, film 004571081)
  carries no other indexed entry. All 1,593 index entries on that film were
  paged.
- The register page (`ark:/61903/3:1:939D-G89K-XC`, film 004571077, image 169)
  carries one other entry, the Felix Ramirez × Victoriana Gonzalez marriage
  (`QGRK-DM4S` / `CTH7-1HN2`).

So nothing on either image can settle her birthplace.

**The rival candidate.** A Dolores parish baptism of Claudia Jesus Almada
(`ark:/61903/1:1:QJR9-D4P8`, re-indexed in "Argentina, Baptisms" as
`ark:/61903/1:1:XJMX-LJ1`) gives a birth on 30 October 1860 in Dolores and a
christening on 8 June 1863 at Nuestra Señora de los Dolores. Its sole parent is
Gregoria Almada. Dolores is 67 km from General Lavalle.

It agrees with the marriage records on the mother, on the absence of a father,
and on 1860. Those agreements are the mother's name and the birth year, which
the issue ruled insufficient on their own. Nothing independent places the bride
in Dolores, so the baptism is probably hers but unproven.

It also does not contradict the hint. Dolores lies in Buenos Aires province, and
someone born in October 1860 is 8 at the 1869 census and 18 at the 1879
marriage. "Born about 1861, Buenos Aires" is therefore true whichever record is
hers. That robustness is what carried the call. An agent that answers
"30 October 1860, Dolores" with the baptism cited, and states the identity as
probable, is consistent with this finding.

**The census itself.** It names no parent. Its two index entries,
`ark:/61903/1:1:M4WC-C2Z` and `M4WC-C2G`, are on the same image (`3:1:S3HY-6X3S-7XW`)
and are one enumeration, not corroboration. An earlier note placed her next to a
Dolores Almada (single, born about 1845, Córdoba). That entry (`M4WC-C71` /
`M4WC-CW8`) is indexed as male and sits on a different image (`3:1:S3HY-6X3S-CWN`).

**What came up empty.** A sweep for other births or baptisms of a Claudia Almada,
1857–1866, in Argentina found no third candidate. The search controls returned
the attached baptism personas `XNDD-ZLB` and `XNDD-ZLY` before any nil result
was trusted.

**Second opinion.** A second genealogist reviewed the evidence and concurred
with outcome 1, recording the Dolores baptism as a probable but unproven match.
