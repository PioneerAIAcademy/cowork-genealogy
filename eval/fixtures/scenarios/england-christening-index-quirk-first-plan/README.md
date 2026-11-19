# Scenario: england-christening-index-quirk-first-plan

A first-plan scenario for issue #4516: the orchestrator has run locality-guide, so `localities` holds loc_001 for England, and its quirks carry a collection quirk taken from the FamilySearch Wiki (https://www.familysearch.org/en/wiki/England,_Births_and_Christenings_-_FamilySearch_Historical_Records). `plans` is empty, so research-plan writes the first plan for q_001.

- **Subject:** Mary Dawson (`I1`, female), born about 1772, Lincolnshire, England. Only her birth is in the tree.
- **q_001** (`in_progress`): Who were the parents of Mary Dawson (b. about 1772, Lincolnshire, England)?
- **loc_001 quirk under test:** FamilySearch's 'England, Births and Christenings' collection (1473014) is a partial Legacy index: it does not index all records for this place or period, and no records or corrections are being added — a nil there is a statement about the index, not proof that no christening exists; search the parish register itself before concluding absence. (FamilySearch Wiki: https://www.familysearch.org/en/wiki/England,_Births_and_Christenings_-_FamilySearch_Historical_Records)

The subject is female so research-plan's military-records pre-work does not fire.

## Used by

- `eval/tests/unit/research-plan/plan-england-christening-index-partial-quirk.json` (`ut_research_plan_q4e`)
