# Scenario: flynn-record-matching-extracted

`flynn-record-matching` with its three structured records fully extracted: the
state person-evidence is handed in production, where the extractor has already
written each record person's facts as assertions. Tree, log, sources and
`results/` sidecars are the same as `flynn-record-matching`.

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland. The tree also holds
  Thomas (`I2`) and Mary (`I3`) Flynn as his parents.
- **Assertions `a_001` to `a_004`** are the ones `flynn-record-matching`
  carries, under the same ids.
- **Assertions `a_005` to `a_026`** are the rest of what the records state, in
  the fact set `extraction_append` writes for them:
  - `MXHY-TP4`, 1850 census, Thomas Flynn household — Patrick (`child_1`,
    `P1`): sex, birth 1845 Ireland, residence 1850 Branch Township, child of
    Thomas, child of Mary. Thomas (`father`, `P2`) and Mary (`mother`, `P3`):
    name, sex, residence, and Thomas as spouse of Mary.
  - `CFLT-9K2`, baptism — Patrick (`principal`, `CP1`): sex, birth 1845
    **Germany**, residence 1850 Branch Township.
  - `VRNT-7M3`, 1850 census, Thomas **Flinn** household — Patrick (`child_1`,
    `VP1`): sex, birth 1845 Ireland, residence 1850 Branch Township, child of
    Thomas. Thomas (`father`, `VP2`): name, sex, residence.
  - `FTXT-Q88`, the will, has no structured persona and keeps its one
    assertion, `a_004`.
- No `person_evidence` yet.

## What it exercises

person-evidence scoring a record person with `same_person` and weighing the
score against the record's own facts, when those facts are in `research.json`
as they are after extraction. Tests of other skills use `flynn-record-matching`.

## Starting tree

`starting-tree.gedcomx.json` is a copy of `tree.gedcomx.json`: all three persons
pre-exist the research and none carries a source ref.
