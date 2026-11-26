# Scenario: phipps-1860-cited-census

A project for the children of Benjamin Fairbanks Phipps, in the state **before
the 1860 census search**, rebuilt from the Phipps feedback session (issue #4667).

## State

- **Subject:** Benjamin Fairbanks Phipps (`I1`), b. 30 January 1816 Thompson,
  Windham, Connecticut, d. 16 August 1893 Thompson. His wife Mary L Childs
  (`I4`) and their marriage (`R1`) are in the tree.
- **The 1860 census is already cited on the subject.** `I1` carries `S4`,
  'Benj Phillips, "United States, Census, 1860"', whose url ends in
  `ark:/61903/1:1:MHR9-JWT`. `I4` carries `S61`, Mary S Phillips in the same
  entry. The record is indexed under the surname **Phillips**, not Phipps.
- **Plan:** `pl_001` / `pli_001`, the 1860 census for Thompson, in progress.
  The log is empty.

The tree is the session's starting tree cut down to `I1`, `I4`, `R1` and the
27 sources they cite. `starting-tree.gedcomx.json` is a copy of
`tree.gedcomx.json`.

## What it exercises

The 1860 search (`record-search-1860-census-phipps`) returns
`MHR9-JWT` as its first row, and the ranking fixture
(`rank-search-matches-phipps-1860`) flags it `attachedToSubject: true`,
`surnameNotOnSubject: true`, `candidateSurname: "Phillips"`. In the session the
agent logged that search `negative` and reported the household not found.
`research_log_append` now refuses a negative `record_search` entry whose rows
include a record the tree cites on the subject, so the search must be logged
`positive` or `partial` and the record reported.
