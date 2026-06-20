# flynn-fan-pivot

Patrick Flynn parentage research — all direct evidence searches exhausted, question still unresolved. Built for question-selection tests where FAN pivot (Priority 6) is the correct next step.

Extends `flynn-census-exhausted` by adding completed negative searches of the 1870, 1880, and 1900 censuses. The timeline gap from 1860–1908 has now been fully investigated — Patrick Flynn was not found in any post-1860 census record in Schuylkill County or adjacent Pennsylvania counties. The proof summary remains at `probable`; no additional direct evidence has been located.

## State

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (parentage evidence, completed — 1860 census + death cert + 1870/1880/1900 census negative searches)
- **Log:** 8 entries — 1850 ×3, 1860, death cert, 1870 negative, 1880 negative, 1900 negative
- **Timeline:** Patrick documented 1845 (birth), 1850 census, 1860 census, 1908 death. 1870/1880/1900 searched — not found. Gap remains but has been investigated.
- **Gaps:** Low-severity remaining gap (marriage, occupation, church records) — census-year gap has been searched
- **Proof summary:** `probable`

## Differs from `flynn-census-exhausted`

- **`plans[pl_002].items`:** Adds `pli_006`, `pli_007`, `pli_008` (1870, 1880, 1900 census searches, all completed)
- **`log`:** Adds `log_006`, `log_007`, `log_008` (1870, 1880, 1900 census searches, all negative)
- **`timelines[t_001].gaps`:** Census-year events removed from `expected_events`; severity downgraded to `low` since those years have been searched
- **`proof_summaries[ps_001].exhaustive_search_summary`:** Updated to mention the three additional negative census searches

## Used by

- `question-selection` tests where FAN pivot is the correct next step — all planned direct searches are complete and unresolved, making associates/neighbors research the highest-value next action.
- Tests verifying that Priority 6 (fan_pivot) fires correctly after direct evidence is exhausted.
