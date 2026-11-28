# flynn-parentage-claim-unencoded

Fork of `flynn-parentage-found` (#3032 Stage 1b part 4c). Two changes:

- `ps_001` states its answer as a claim: `paternity`, Thomas Flynn (I2) as father of
  Patrick (I1), at `probable` (the scalar `tier` follows it down from `proved`).
- The tree no longer carries R1, the ParentChild edge that claim concludes.

So `project_context.owedFindings` lists an `encode` item for `ps_001/paternity`:
the claim stands at `probable` and no tree object carries it. Both questions are
resolved and the project is still `active`. The research router must send this
back to proof-conclusion to encode the claim before anything completes the project.

The parent scenario is left untouched because question-selection's 007 uses it.
