# yorkshire-1851-death-collection

**Source:** Issue #3178, patron row 2615 (Yorkshire 1851 death locality-guide session)  
**Failure mode captured:** The locality-guide agent described civil death registration for 1851 Yorkshire but did not name the specific free FamilySearch collection (col. 1473141, "England & Wales, Civil Registration Death Index, 1837–1915") returned by collections_search, nor the regional transcription site yorkshirebmd.org.uk returned by external_links_search.

## Scenario

A patron asks how to find a death record for someone who died in Yorkshire, England in 1851. The collections_search tool returns FamilySearch collection 1473141 and the external_links_search returns yorkshirebmd.org.uk. The agent should read those returns and name them specifically in its guide — not describe civil registration in general terms while ignoring the collection identifier and regional site the tools surfaced.

## What the test checks

The agent must (a) name FamilySearch collection 1473141 (the England & Wales Civil Registration Death Index) as a free, indexed online resource and (b) mention yorkshirebmd.org.uk as a regional transcription source for Yorkshire registration districts. Generic descriptions of England civil registration without these specifics is the failure this test gates against.

## PII note

Subject is a placeholder person. Yorkshire is the real place name; 1851 is the real year.

## Caveats (verify before committing)

- The carve is the pre-failure state: no bad output is in the scenario.
- The collections_search fixture (col. 1473141) and external_links fixture (yorkshirebmd.org.uk) were constructed from answer-key data for issue #3178 row 2615; verify the collection ID against FamilySearch before landing.
- PII scrub: person A is a placeholder; no real identifiers present.
