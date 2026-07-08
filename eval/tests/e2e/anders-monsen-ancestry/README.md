# Anders Monsen & Unna Halsteinsdatter — marriage (1786, Norway)

**Source PID:** `LKFW-9XH`

**Anders Monsen is deceased** (buried 8 January 1821, Manger parish, Hordaland, Norway). (FamilySearch ToS requires all committed e2e fixtures to be about deceased persons.)

## Research question

> When and where did Anders Monsen marry Unna Halsteinsdatter, and what does the marriage record show?

## What was removed from the starting tree

- The `Marriage` fact (date and place: 25 June 1786, Hamre parish church, Hordaland, Norway) from the `Couple` relationship between Anders Monsen (`LKFW-9XH`) and Unna Halsteinsdatter (`KZHH-VTX`) — the relationship itself is retained (empty `facts` array), since the question already names Unna as the spouse.
- The marriage-attesting source: `MWGF-FDS`, "Anders Monsen, 'Norway, Marriages, 1660-1926'" (ark `1:1:NW44-PM2`).

## What the starting tree contains

- Anders Monsen himself: birth (1759, Håtuft, Meland), christening (7 April 1759, Hamre kirke, Osterøy), death (1821, Åsebø), burial (8 January 1821, Manger).
- His parents, both fully identified and linked via `ParentChild`: Mons Monsen "Qvamme" (`LKFW-9ML`, b. 1724 Nedre Kvamme, christened 1 Oct 1724 Hamre kirke, d. 1779 Åsebø) and Anna Andersdatter (`LKFW-9QR`, b. 1739 Bjørnestad, christened 5 Apr 1739 Meland, d. 1805 Åsebø). These were the answer in a prior version of this fixture (parents/christening question) — they are now given context, not the tested finding.
- His spouse Unna Halsteinsdatter (`KZHH-VTX`) as a known person: birth (May 1745, Hestdal, Meland) and christening (27 May 1745, Hamre). The `Couple` relationship to Anders exists but carries no marriage fact.
- Three non-marriage sources: the christening record, the "Norway, Baptisms, 1634-1927" index entry, and the death/burial record.

Extended relatives not relevant to the marriage question (Mons's other marriages, Anna's parents, Anders's many siblings) were deliberately left out of the starting tree to keep it focused — see "Path 1" scope note below.

## Expected difficulty

Moderate — the marriage is indexed on FamilySearch in "Norway, Marriages, 1660-1926" (ark `1:1:NW44-PM2`), so the agent should find it via `record_search` rather than needing Digitalarkivet or other Norwegian-only archives. However, Norwegian patronymic naming (Anders Monsen = son of Mons; Unna Halsteinsdatter = daughter of Halstein) makes both names extremely common, so disambiguation rests on combining both spouses' names with the approximate 1786 date and Hordaland/Meland-area geography.

## Notes for reviewers

Two required findings: (f1) the marriage fact — Anders Monsen married Unna Halsteinsdatter on 25 June 1786 at Hamre parish church, Hordaland, Norway, and (f2) the source — the FamilySearch-indexed "Norway, Marriages, 1660-1926" collection entry that documents it. This fixture was rebuilt from a live `person_read` snapshot of `LKFW-9XH` (Path 1), replacing an earlier PID-less (Path 3) version of this fixture that tested Anders's parents and christening instead — that prior version's document-derived christening place (Håtuft farm) turned out to conflate the birth farm with the actual christening church (Hamre kirke, a different parish), which the live FamilySearch data corrects. The parents/christening facts from that prior version are now included as given context in the starting tree rather than being the tested answer.
