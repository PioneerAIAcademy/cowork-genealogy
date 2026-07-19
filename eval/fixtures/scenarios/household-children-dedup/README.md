# Scenario: household-children-dedup

A mid-research project whose **subject is a parent** (head of household), with
two children already recovered from a prior census — set up to test that a
*later* census does not spawn duplicate child personas.

- **I1** — George Tanner (subject / head of household).
- **I2** — Martha Tanner (wife).
- **I3, I4** — Anna and Samuel Tanner, two children already in the tree (from a
  prior census), each with ParentChild edges to both parents.
- **R1** Couple I1⇄I2; **R2–R5** the parent-child edges.

Used by `ut_record_extraction_020`: extracting a later census that repeats Anna
and Samuel and adds Ruth and Henry must go through `tree_edit
add_household_children` — which matches the in-tree parents and skips the
children already present — leaving George with exactly four children and no
duplicates. From the reese-children e2e run, where the subject-is-parent case
fell back to per-child `add_person`/`add_relationship` (no cross-record dedup)
and produced duplicate child personas across the 1910/1920/1930 censuses
(Selia/Delia, Whisfield/Whitager).
