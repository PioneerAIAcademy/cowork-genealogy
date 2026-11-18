# Scenario: germany-call-name-quirk-first-plan

A first-plan scenario for issue #4516: the orchestrator has run locality-guide, so `localities` holds loc_001 for Germany, and its quirks carry a collection quirk taken from the FamilySearch Wiki (https://www.familysearch.org/en/wiki/Germany_Naming_Customs). `plans` is empty, so research-plan writes the first plan for q_001.

- **Subject:** Anna Margaretha Bauer (`I1`, female), born 1792, Württemberg, Germany. Only her birth is in the tree.
- **q_001** (`in_progress`): Who were the parents of Anna Margaretha Bauer (b. 1792, Württemberg, Germany)?
- **loc_001 quirk under test:** German children baptised with two or more given names were often called by the second in daily life (the wiki's example: Johann Christoph and Johann Friedrich were usually called Christoph and Friedrich) — search later records under the second given name alone as well as the full baptismal name. (FamilySearch Wiki: https://www.familysearch.org/en/wiki/Germany_Naming_Customs)

The subject is female so research-plan's military-records pre-work does not fire.

## Used by

- `eval/tests/unit/research-plan/plan-germany-call-name-quirk.json` (`ut_research_plan_q4g`)
