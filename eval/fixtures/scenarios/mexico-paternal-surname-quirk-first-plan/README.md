# Scenario: mexico-paternal-surname-quirk-first-plan

A first-plan scenario for issue #4516: the orchestrator has run locality-guide, so `localities` holds loc_001 for Mexico, and its quirks carry a collection quirk taken from the FamilySearch Wiki (https://www.familysearch.org/en/wiki/Improve_your_Search_Results_for_Hispanic_Ancestors_in_FamilySearch.org). `plans` is empty, so research-plan writes the first plan for q_001.

- **Subject:** María Guadalupe Hernández Ramírez (`I1`, female), born about 1895, Guadalajara, Jalisco, Mexico. Only her birth is in the tree.
- **q_001** (`in_progress`): Who were the parents of María Guadalupe Hernández Ramírez (b. about 1895, Guadalajara, Jalisco, Mexico)?
- **loc_001 quirk under test:** Although Mexicans use two surnames, most indexed records carry only the first (paternal) surname — search with the paternal surname alone; when the person is not found, search through the parents (a parent search with each parent's first surname, leaving out the child's name). (FamilySearch Wiki: https://www.familysearch.org/en/wiki/Improve_your_Search_Results_for_Hispanic_Ancestors_in_FamilySearch.org)

The subject is female so research-plan's military-records pre-work does not fire.

## Used by

- `eval/tests/unit/research-plan/plan-mexico-paternal-surname-quirk.json` (`ut_research_plan_q4m`)
