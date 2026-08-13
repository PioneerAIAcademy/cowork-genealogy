# flynn-fan-pivot

Patrick Flynn parentage research — all direct evidence searches exhausted, question still unresolved. Built for question-selection tests where FAN pivot (Priority 6) is the correct next step.

Extends `flynn-census-exhausted` by adding completed negative searches of the 1870, 1880, and 1900 censuses and of Schuylkill County church records. The timeline gap from 1860–1908 has now been fully investigated — Patrick Flynn was not found in any post-1860 census record in Schuylkill County or adjacent Pennsylvania counties. The proof summary remains at `probable`; no additional direct evidence has been located.

## State

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (parentage evidence, completed — 1860 census + death cert + 1870/1880/1900 census + probate + church-record searches)
- **Log:** 10 entries — 1850 ×3, 1860, death cert, 1870 negative, 1880 negative, 1900 negative, probate negative, church records negative
- **Timeline:** Patrick documented 1845 (birth), 1850 census, 1860 census, 1908 death. 1870/1880/1900 searched — not found. Gap remains but has been investigated.
- **Gaps:** Low-severity remaining gap (marriage, occupation) — the census-year gap, Schuylkill County probate and Schuylkill County church records have all been searched, negative
- **Proof summary:** `probable`

## Differs from `flynn-census-exhausted`

- **`plans[pl_002].items`:** Adds `pli_007`–`pli_010` (1880 census, 1900 census, probate, church records — all completed), and **redefines `pli_006`**: in `flynn-census-exhausted` it is the probate item, here it is the 1870 census search. Probate is retained, renumbered to `pli_009` — it is not new here.
- **`log`:** Adds `log_007`–`log_010` (1880 census, 1900 census, probate, church records — all negative), and **redefines `log_006`** from the probate negative to the 1870 census negative. 6 entries become 10.
- **`timelines[t_001].gaps`:** Census-year events removed from `expected_events`; severity downgraded to `low` since those years have been searched
- **`proof_summaries[ps_001].exhaustive_search_summary`:** Rewritten to name the 1870/1880/1900 census negatives alongside the probate (`log_009`) and church-record (`log_010`) negatives, so it lists the same searches as `questions[q_001].exhaustive_declaration.justification`. (`flynn-census-exhausted`'s summary names probate as `log_006`; here that search is `log_009`.)
- **Also differs, incidentally to the FAN-pivot setup:** `assertions` 13 → 6, `person_evidence` 6 → 4, `hypotheses` 0 → 1 (h_001), `project.updated` 2026-05-04 → 2026-05-10.

## Used by

- `question-selection` tests where FAN pivot is the correct next step — all planned direct searches are complete and unresolved, making associates/neighbors research the highest-value next action.
- Tests verifying that Priority 6 (fan_pivot) fires correctly after direct evidence is exhausted.
