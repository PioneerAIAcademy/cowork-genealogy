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

**What the agent sees here.** `same_person` answers with the live pre-link
scores measured on 2026-10-12 (issue #3363), not the near-certain ones that run
saw after its own links were in place: 0.43 (confidence 3) for the register
persona, and no match (0.006) for the arrival. The two namesakes the delegation
names are recorded in `namesakes` on I1: `ns_001`, the Hermann born 1873 who was
naturalized in San Francisco in 1900 and died there in 1957 (five of his records,
from `log_005`), and `ns_002`, the Herman born 1827 who died in Butte County in
1899 (his death record, also from `log_005`). With a row on I1, `research_append` refuses a link to I1
above `speculative` unless something in its record ties it to him, and neither
record names his wife or children.

**Names are kept, not scrubbed.** Everyone here is deceased and the data is from
the public FamilySearch tree. The spelling variants (Gatjen, Gaetjen) and the
Bremen-vs-Prussia birthplace are the evidence the test turns on, so scrubbing
them would remove what is being graded. No patron details are included.

**Review before relying on this carve.** It is a best reconstruction of the
pre-failure state: the run's later sources (`src_003` onward) and its log
entries after `log_022` are dropped, and project and question statuses are reset
to active/open.
