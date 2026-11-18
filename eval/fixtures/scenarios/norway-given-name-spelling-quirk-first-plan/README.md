# Scenario: norway-given-name-spelling-quirk-first-plan

A first-plan scenario for issue #4516: the orchestrator has run locality-guide, so `localities` holds loc_001 for Norway, and its quirks carry a collection quirk taken from the FamilySearch Wiki (https://www.familysearch.org/en/wiki/Norway_Church_Records). `plans` is empty, so research-plan writes the first plan for q_001.

- **Subject:** Unna Halsteinsdatter (`I1`, female), born May 1745, Hestdal, Meland, Hordaland, Norway. Only her birth is in the tree.
- **q_001** (`in_progress`): Whom did Unna Halsteinsdatter (b. May 1745, Hestdal, Meland, Hordaland, Norway) marry, and when?
- **loc_001 quirk under test:** Norwegian name spellings were set by the recorder and vary between records (the wiki's example: the given name Sivert written as Syver, Sjur, Siver, Sifuer or Siffuer) — search given-name spelling variants, not just the tree's spelling, before concluding a nil. (FamilySearch Wiki: https://www.familysearch.org/en/wiki/Norway_Church_Records)

The subject is female so research-plan's military-records pre-work does not fire.

## Used by

- `eval/tests/unit/research-plan/plan-norway-given-name-spelling-quirk.json` (`ut_research_plan_q4n`)
