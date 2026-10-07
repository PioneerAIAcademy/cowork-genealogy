# research-unregistered-census-conflicts

Mined from a Cowork project on 2026-10-07 (Family Tree MHGK-WT7, Jonathan Barker, b. about 1819 England, of Jasper and Smith Counties, Mississippi). The research was on q_001, which asks where Jonathan was in the 1850 census. The 1850, 1860 and 1880 censuses and the 1845 and 1866 state censuses were all extracted and linked, and they disagree on two facts. The wife Elizabeth's birthplace is England in 1850 (a_007) but Alabama in 1860 and 1880 (a_023, a_044). The daughter Sarah Martha's birthplace is Alabama in 1850 (a_011) but Mississippi in 1860 (a_027). The person-evidence rationale on pe_026 even says "to be resolved in conflict-resolution". Even so, `/research` went on to exhaustiveness and proof-conclusion. The exhaustive declaration said the discrepancies were "flagged for conflict-resolution", ps_001 was written at Probable, and `conflicts[]` stayed empty for the rest of the run. A third discrepancy, Jonathan's birth year (about 1819–1821 against about 1811 in the 1870 census), came up later under q_002 and was never registered either. The routing table's "Evidence conflicts present" row requires `conflict-resolution` first.

- **Objective / question:** q_001 (1850 census household). It is open and not declared exhaustive.
- **Plan:** pl_001. Items pli_001, pli_005 and pli_006 are `completed`; the fallbacks pli_002 to pli_004 are `skipped`.
- **Log:** log_001 (1850 census), log_002 (1860–1880 censuses) and log_003 (Mississippi state censuses). All are positive and all are extracted. The sidecars in `results/` are trimmed to the records the sources cite.
- **Assertions:** a_001 to a_049, every one linked in `person_evidence` (persons I1 to I5).
- **Conflicts / hypotheses / proof_summaries / evaluations:** empty.

## This is a constructed carve, not the literal pre-failure state

The case folder is the post-run state. It has 44 log entries, a second question (q_002, immigration), two proof summaries and three hypotheses. Everything after log_003 was removed, along with its sources, assertions, links and tree persons (I6 to I10). Tree facts and relationships that cite only later sources (S7 and up) were removed too. Assertions a_062 and a_063, which add 1880 detail from log_015, were dropped because they came later. q_001 was reset to `open` with no exhaustive declaration. The case predates the 2026-09-18 `evidence_type` → `record_basis` rename, so assertions were migrated with the engine's own mapping (`src/utils/record-basis.ts`). The operator dated the failure "around log_028". However, q_001's exhaustive declaration cites only log_001 to log_003, and ps_001's supporting assertions all come from them, so this carve sits at the q_001 decision point. **Verify the carve before relying on the test.**

## PII

Jonathan Barker and his household are deceased, public Family Tree persons, and the exact birthplaces in conflict are the finding under test. Names, places and years are kept, as for a recorded e2e run. The scrub is best-effort, so review it before committing.
