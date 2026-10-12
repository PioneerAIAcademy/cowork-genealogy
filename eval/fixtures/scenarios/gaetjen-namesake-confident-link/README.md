# gaetjen-namesake-confident-link

Mined from issue #3179, patron query 2593 (Hermann Gaetjen, tree G9YD-NYZ; the
run's project folder was `p2593-gaetjen`). The state is the one the
person-evidence agent saw just before its failing link: both records extracted
(`src_001`, the 1875 San Francisco Great Register entry for "Hermann Gatjen",
age 21, naturalized 13 Aug 1875; `src_002`, the Germans to America index entry
for "Herm Gaetjen", b. 1854 Prussia, arrived New York 2 Jun 1871), the 14
assertions `a_001`–`a_014`, no `person_evidence`, no conflicts, and the tree as
`project_create` wrote it, with the two source descriptions (S50, S51) added.

**The bug it captures.** The agent ran `same_person` (near-certain scores on
name, age and city), linked all 14 assertions to I1 at `confident`, and
materialized an 1871 New York arrival and an 1875 naturalization onto him,
although its delegation warned that other Hermann Gaetjens lived in California,
I1's only birth fact is unsourced, and the arrival leaves only about four years
before a naturalization that then required five years' residence. A later
conflict and the run's own final reply called both records possible matches
only; the links and the tree facts stayed.

**Names are kept, not scrubbed.** Everyone here is deceased and the data is from
the public FamilySearch tree. The spelling variants (Gatjen, Gaetjen) and the
Bremen-vs-Prussia birthplace are the evidence the test turns on, so scrubbing
them would remove what is being graded. No patron details are included.

**Review before relying on this carve.** It is a best reconstruction of the
pre-failure state: the run's later sources (`src_003` onward) and its log
entries after `log_022` are dropped, and project and question statuses are reset
to active/open.
