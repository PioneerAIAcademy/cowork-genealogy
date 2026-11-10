# yorkshire-1851-death-collection

**Source:** Issue #3178, patron row 2615 (Yorkshire 1851 death locality-guide session)  
**Failure mode captured:** The locality-guide agent described civil death registration for 1851 Yorkshire without naming the FamilySearch death index collection returned by collections_search or the regional index returned by external_links_search.

## Scenario

A patron asks how to find a death record for someone who died in Yorkshire, England in 1851. The collections_search fixture (measured live 2026-11-04) returns 167 England-level collections, including 2285341 "England and Wales, Death Registration Index 1837-2007" and 1473016 "England, Deaths and Burials, 1538-1991". The external_links_search fixture (same date) returns 122 links, including http://www.yorkshirebmd.org.uk/ ("Yorkshire Births Marriages & Deaths Indexes").

## What the test checks

The guide must (a) name collection 2285341 by number or exact title as an indexed source for an 1851 death and (b) name Yorkshire BMD as a regional index. Generic descriptions of England civil registration without these specifics are the failure this test gates against.

## PII note

Subject is a placeholder person. Yorkshire is the real place name; 1851 is the real year.

## Caveats

- The carve is the pre-failure state: no bad output is in the scenario.
- An earlier version of these fixtures held invented collection IDs (1473141, 1526471, 1538418), invented record counts and three invented links. All four fixtures are now live captures.
- PII scrub: person A is a placeholder; no real identifiers present.
