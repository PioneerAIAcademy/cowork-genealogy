# gaetjen-naturalization-interval

A copy of `gaetjen-namesake-confident-link` (mined from issue #3179, patron
query 2593; see that scenario's README for the carve) for issue #3969: the
arrival-to-naturalization interval check, graded apart from the namesake gate.

**What changed from the mined carve.** `namesakes` is emptied: `ns_001` (the
Hermann born 1873, naturalized San Francisco 1900) and `ns_002` (the Herman born
1827, died Butte County 1899) are removed. With a namesake row on I1,
`research_append` caps every link from these records at `speculative`, and the
interval would decide nothing. `log_005` and its results file still list those
men's records; they are search history, not namesake rows, and nothing reads
them as a cap. Nothing else is changed.

**The case.** `src_002` (Germans to America index) has Herm Gaetjen, born 1854
in Prussia, arriving at New York on 2 June 1871 (`a_014`). `src_001` (1875 San
Francisco Great Register) has Hermann Gatjen, 21, naturalized 13 August 1875 in
the California 4th District Court (`a_007`). That is about four years and two
months, against the five years' residence the 1802 act required, so on these
two records the earliest lawful date is June 1876. Nothing in the project shows
Hermann's earlier residence, a U.S. Army discharge, or a naturalized father.
`log_006` does list "Herman Gotjen, Hamilton, Butte, 1869" among other Great
Register hits. It is not Hermann: a registered voter in 1869 was at least 21,
and the same note assigns the Butte cluster to the Herman born 1827. `log_019`
also names a "Hermann Gatjen naturalized New York 1876", another man.

**What the agent sees.** `same_person` answers as in the source scenario: 0.43
(confidence 3) for the register persona, and no match (0.006) for the arrival.
So a run may stub the arrival rather than link it to I1. The test reads the
shortfall from whichever entry carries `a_007` or `a_014`, on I1 or on a stub,
or from the final reply when the run writes neither and asks first.

**Names are kept, not scrubbed**, as in the source scenario: everyone here is
deceased and the data is from the public FamilySearch tree.
