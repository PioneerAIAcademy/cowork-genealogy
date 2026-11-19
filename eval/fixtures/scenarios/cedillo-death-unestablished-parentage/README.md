# Cedillo death: two same-named candidates, parentage not yet established

Carved from feedback bundle `feedback-2026-10-30T07-56-13-719275Z.zip` (the
`nicolasa-cedillo-death` website run, issue #4042). Nicolasa Cedillo (GJG6-F2L) is
deceased.

## Starting state

- `tree.gedcomx.json`: the run's `starting-tree.gedcomx.json`, verbatim. Nicolasa
  (I1) has an undated Death fact and **no parents**. Her husband Santiago Cedillo
  (I9, GJG6-74S) is linked by a Couple relationship and has no death date. Seven
  children, baptised 1899–1914.
- `research.json`: the run's project and question `q_001` (when and where did she
  die), set back to `active`/`open`, with one plan `pl_001` and one item `pli_001`.
  Every other section is empty: no sources, assertions or log entries.

**Changed from the run:** the run's `pli_001` searched Camasca, 1914–1943, which
excludes the 1945 death. Here `pli_001` covers Santa Lucía, Intibucá, 1919–1968
(Honduras Civil Registration, collection 2135627), where the family's civil
registrations are, so the death search reaches both candidates.

## What the death search returns

`record-search-cedillo-nicolasa-death` is the run's first death search
(`results/log_001.json`), verbatim: 14 results, with both women scored
identically. The ranking is withheld because I1 has no dated or placed fact
(`rank-search-matches-cedillo-withheld`), as it was in the run.

| Record | Who | Born | Parents | Spouse |
|---|---|---|---|---|
| `X7FS-6T4L`, `X7FM-RFHS`, `X7KG-W4V1` | Ma Nicolasa Cedillo, d. 21/22 May 1943, Santa Lucía | 1868 | mother Julia Cedillo (`X7FM-RFHS`) | Santiago Cedillo, no status stated |
| `X7FM-YRGN`, `X7LQ-QZVH` | Maria Nicolasa Cedillo, d. 12 Feb 1945, Santa Lucía | 1875 | Ventura Cedillo + María Jesús Amaya | none named |
| `X7LS-KMLK` | Santiago Cedillo, d. 4 Dec 1918, Santa Lucía | 1870 | Valentín Cedillo + Patrocia Márquez | Nicolasa Cedillo |

Also in the results: two of her children's records naming her as Santiago's wife
(`X7FS-X3LL`, `X7LS-8L8G`) and unrelated namesakes (`X7JJ-K94N`, b. 1956;
three Nicolasa Alvarado Cedillos).

## The answer, and what settles it

She is the **1945** woman. The 1904 civil birth of her daughter Maria Dolores at
Santa Lucía (record `X7FS-K2SV`, fixture `record-read-cedillo-x7fs-k2sv`) names
Nicolasa's parents as **Ventura Cedillo + Jesús Amaya**, matching the 1945 death,
and Santiago's parents as **Valentín Cedillo + Patricia Márquez**, matching the
1918 death. That record spells her "Patrocia": a clerk's spelling of the same
name, as the father and surname agree. The 1943 woman's mother is Julia Cedillo.

The 1943 record names a spouse Santiago but does not say he was alive, so the
1918 death alone does not disprove it. Parentage decides, and parentage is not in
the project at the start: the subject has no parents in the tree and no assertion
names them. A run must not rule out either woman on parents it has not
established.

## Fixtures

`record-search-cedillo-nicolasa-death`, `rank-search-matches-cedillo-withheld`,
`record-read-cedillo-x7fs-6t4l` and `record-read-cedillo-x7fm-yrgn` (the run's
`log_022`, `log_023`), `record-read-cedillo-x7ls-kmlk` (from its `log_001`
entry; the run never read it) and `record-read-cedillo-x7fs-k2sv` (from the run's
`results/log_026.json`).
