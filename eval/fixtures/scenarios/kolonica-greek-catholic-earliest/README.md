# kolonica-greek-catholic-earliest

**Source:** Issue #3178, patron row 2273 (Kolonica, Slovakia locality-guide session)  
**Failure mode captured:** The locality-guide agent produced a guide for Kolonica that mentioned Greek Catholic records but gave only an approximate start date of ~1824, missing the earlier coverage documented in FamilySearch catalog entries 711474 and 1162429 (starting 1783 and 1758 respectively).

## Scenario

A patron asks for a locality guide for Kolonica, Slovakia. The catalog_search tool returns two Greek Catholic church vital-record (matrika) series for the area: one starting 1783 (catalog 711474, "Cirkevná matrika, 1783–1895") and one starting 1758 (catalog 1162429, "Cirkevná matrika, 1758–1896"). The agent should read those start dates from the fixture response and report them accurately, not substitute a rounded approximation.

## What the test checks

The agent must report the catalog results' actual start dates (1783 or 1758), name the FamilySearch catalog entries by number, and identify Kolonica as a Greek Catholic (Ruthenian/Rusyn) village in Snina District. Saying records exist "from around 1824" or similar rounded estimates when the fixture clearly shows 1783/1758 is the failure this test gates against.

## PII note

Subject is a placeholder person (no real individual). Kolonica is the real place name; keeping it is essential to the test since the fixture predicate matches on "~Kolonica".

## Caveats (verify before committing)

- The carve is the pre-failure state: no bad output is in the scenario, so the test reruns the skill fresh.
- The catalog fixture was constructed from the answer-key data for issue #3178 row 2273; verify the catalog IDs (711474, 1162429) against a live FamilySearch catalog lookup before landing.
- PII scrub: person A is a placeholder; no real identifiers present.
