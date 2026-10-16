# Mári Nagy — marriage in January 1875, Egyházasrádóc, Vas, Hungary

**Source PID:** `G549-JNM`
**Mári Nagy is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Wife of János Szőke (no dates); mother of István (1881), Terézia (1884), Julianna (1886), Ferenc (1889) and Anna (1891) Szőke, plus Szidonía and a second Anna with no dates. The tree records no places and cites no sources for anyone in the family.

## Research question

> When and where did Mári Nagy marry János Szőke, the father of her children István (born 1881), Terézia (1884), Julianna (1886), Ferenc (1889) and Anna (1891) Szőke?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G549-JNM` with relatives). Nothing was
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

**Resolved 2026-10-16: true match (outcome 1).** The hint record, `ark:/61903/1:1:6N3C-X3Y2`
("Hungary, Church Books, 1624-1950"), is the marriage of the tree's Mári Nagy (`G549-JNM`) and János
Szőke (`G54S-MLT`). It records Szöke János, indexed age 28 (so born about 1847), and Nagy Mária,
indexed born 1858, married 17 January 1875 at Egyházasrádóc, Vas. The register image is
`ark:/61903/3:1:939J-V2ZP-R` (microfilm 004660284, image 464). The genealogist made the identity call.
Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-*.ts`, spec §3.6). Every record
cited below was read directly, and the indexes alone settled it, so `image_basis` is off.

The hint came from a batch (`filtered-list-samples-3.csv` row 28, `hint-samples.csv` row 922, flags
`adds_birth,adds_marriage`, confidence 3) in which roughly half the hints are false matches. The batch
CSV lists the country as "Unknown" because the tree records no places. The tree still has no places
and no record sources: all eleven of its sources are FamilySearch Tree self-citations, and nothing on
FamilySearch is attached to the hint. So no tree source is a re-index of this entry, and the tree on
its own does not tie the family to Vas.

**What decided it: the children's baptisms.** "Hungary, Catholic Church Records, 1636-1895" holds
Egyházasrádóc baptisms naming parents János Szöke and Mária Nagy. They are on the same microfilm as the
marriage, and the indexes give years only:

| Child | Baptism | Ark | Tree |
|---|---|---|---|
| János | 1877 | `ark:/61903/1:1:XZ9V-TVD` | not in tree |
| Sándor | 1880 | `ark:/61903/1:1:XZ9V-R5P` | not in tree |
| István | 1881 | `ark:/61903/1:1:XZ9V-T18` | `G549-2W7`, born 1881 |
| Teréz | 1884 | `ark:/61903/1:1:XZ9V-TRB` | `G549-3PV` Terézia, born 1884 |
| Julianna | 1886 | `ark:/61903/1:1:XZ9V-JY7` | `G549-KL1`, born 1886 |
| Ferencz | 1889 | `ark:/61903/1:1:XZ9V-VMC` | `G54S-9HJ` Ferenc, born 1889 |
| Anna | 1891 | `ark:/61903/1:1:XZ9V-P9W` | `G549-NBC`, born 1891 |
| Anna | 1893 | `ark:/61903/1:1:XZ9V-PLZ` | `G549-TCX`, undated |
| Szidonia | 1895 | `ark:/61903/1:1:XZ9V-V6G` | `G549-BM3`, undated |

Every dated tree child matches a baptism by name and year in the parish where the marriage was
recorded. In order they run from 1877 to 1895, which fits a mother born about 1858: about 19 at the
first child and 37 at Szidonia. Vas civil registration continues the family: Szidonia was born
9 Dec 1895 (`ark:/61903/1:1:6JB3-6L88`) and died 10 Feb 1896 (`ark:/61903/1:1:6JYB-PPXJ`), a János
was born 27 May 1897 (`ark:/61903/1:1:6JBS-943Y`), and a Juliánna was born 16 May 1898
(`ark:/61903/1:1:6JB3-JYL4`). The 1877 János fits the Vas civil death of a János Szőke whose parents
are indexed as János Szőke and Mária Nagy, on 6 Apr 1898 at age 20 (`ark:/61903/1:1:6JY1-TCCM`).

The 1907 Vas civil marriage of Teréz Szőke (born 1884) to József Vámos (`ark:/61903/1:1:6JB9-NM3N`)
names her parents as János Szőke and **Mári Nagy**, the tree's own spelling of the mother's name. That
record links the tree's form of the name to this Vas family.

**Anna 1891 and Anna 1893 are two daughters, not a discrepancy.** The tree has an Anna born 1891
(`G549-NBC`) and an undated Anna (`G549-TCX`). The index has a separate baptism for each: 1891
(`XZ9V-P9W`, film image 423) and 1893 (film images 428–429). The 1891 Anna was presumably dead by the
time the 1893 child was given the same name, but no burial for her was found. The 1893 baptism appears
as two index records, Anna `XZ9V-PLZ` on image `ark:/61903/3:1:939J-V28N-2` and Anna
`XZ9V-VCJ` on image `ark:/61903/3:1:939J-V282-Z`, and they are one entry. The two consecutive film
images are the same register page photographed twice, and each was indexed once. Both images carry the same run of neighbouring 1893 entries in the same order (Szombat Katalin
`XZ9V-PL4`/`XZ9V-VCX`, then Anna Szöke, then Takács Mária `XZ9V-PL6`/`XZ9V-VC2`). Earlier in the 1893
listing the same duplication repeats under other series (Horváth Lajos `XZ9V-P29`/`XZ9V-PL5`, Kovács
József `XZ9V-P2Q`/`XZ9V-PLY`). So the repeated Annas do not point to twins or a second couple.

**Second-couple check.** Within Egyházasrádóc, apart from the doubly photographed 1893 page, there is
one baptism per child, spaced 1877–1895 with no two in the same year. The indexes give years only, so
closer spacing between 1880 and 1881 cannot be checked from them. A search for marriages of János
Szőke/Szöke to Mária Nagy anywhere in Hungary, 1860–1900, returned two church marriages: this one and
Dunapataj, Pest-Pilis-Solt-Kiskun, 16 Sep 1895 (`ark:/61903/1:1:6N3H-31C8`). Dunapataj is too late
for these children, and its groom is indexed born 1864, not 1847. That search found the hint record, which shows it was not filtering it out. The
other János Szőke × Mária Nagy families the indexes hold are outside Vas: Gyöngyöstarján (Heves),
Hajdúszovát, Szeghalom, Izsák and Debrecen. The Anna Szőke who died 6 Dec 1895 aged 2
(`ark:/61903/1:1:6N71-1HR8`) belongs to the Gyöngyöstarján couple, not this one.

**Searches that could not be used.** Searches that put Szöke as the child's surname, with János Szöke
and Mária Nagy as father and mother filters (with and without `--type birth`, 1875–1900), failed a
positive control: they returned none of the known Egyházasrádóc baptisms. Their empty results are
therefore not evidence of absence and were not relied on. The baptisms above come from searching János
Szőke/Szöke with spouse Mária Nagy, which did return them.

**Open question, not evidence against the match.** A Vas civil death of Ferencz Szőke, whose parents
are indexed as János Szőke and Mária Nagy, on 2 Jun 1897 gives his age as 5 (`ark:/61903/1:1:6JY1-Z6YV`). That points to
a birth about 1892, not the 1889 baptism. Either the indexed age is wrong or there was a second,
unindexed Ferencz. An Anna Szöke whose parents carry the same names, who died at Felsőcsatár, Vas, on 30 Mar 1902
aged 8 (`ark:/61903/1:1:6JY1-CBVL`) was not tied to this family either way.

`expected-findings.json` keeps the marriage as f1 with the hint's ark. Its description no longer
carries the spouses' estimated birth years (1847 and 1858), so a report is graded on the marriage
date and place the research question asks for. The judge scores every component of a `fact` finding
(`eval/harness/e2e/judge_prompt.md`), and the tree has no birth for Mári to check an estimate against.
