# John Perry Witbeck's birth, death, and burial

**Source PID:** `MGRB-VP2`
**John Perry Witbeck is deceased.** (FamilySearch ToS requires all
committed e2e fixtures to be about deceased persons. Confirmed via the
issue author and the live tree's `living: false` flag; the snapshot's
living-person gate re-checked this across the whole tree at authoring
time.)

## Research question

> What are the birth date, death date, and burial date of John Perry
> Witbeck, and what evidence confirms each event in Schenectady County,
> New York?

## What was removed from the starting tree

- Removed fact 548652f1-ac14-4146-998a-0c5203e00397 on MGRB-VP2: Death 28 Feb 1819 Niskayuna, Schenectady, New York, United States
- Removed fact a99998b2-5c26-4a32-a637-4d4443c68591 on MGRB-VP2: Birth 10 Mar 1775 Albany, Albany, New York, United States
- Removed fact aafbe123-e2c5-4618-bd5c-64f769cafe16 on MGRB-VP2: Burial Niskayuna Reformed Church Cemetery Schenectady County, New York, USA
- Removed source 9XY1-SQC: John Perry Witbeck, "Find a Grave Index"
- Removed source MZGW-25R: John Perry Witbeek, "New York, Births and Christenings, 1640-1962"

The subject's Christening fact (15 Mar 1775, Albany) was deliberately
**left in** the starting tree as an anchor/near-miss data point — it's
close to but distinct from the birth date, so it doesn't hand the agent
the answer while still giving it a starting foothold in the right
record collection and era. The 12 remaining sources (christening/birth
records for his children, naming him as father, plus his marriage
record to Sarah Cragier) were also left in place — they're not evidence
of his own birth/death/burial and give the agent legitimate anchors
(spouse, children, residences) to work from.

## Expected difficulty

medium — three distinct facts must be recovered (birth, death, burial),
each from a different record type/collection than the retained
christening entry. Sources exist in searchable FamilySearch collections
("New York, Births and Christenings, 1640-1962" and "Find a Grave
Index"), so this should be recoverable via `record_search` /
`fulltext_search` without needing external documents, but requires the
agent to correctly distinguish this John Perry Witbeck (b. 1775, Albany)
from same-named relatives in the tree (a son Thomas, born 1817, is also
tracked, and several sources reference other Witbeck family members).

## Notes for reviewers

Originates from GitHub issue #760 ("Create e2e test for John Perry
Witbeck MGRB-VP2 (NewYork)"). If a run fails to recover the death or
burial date/place, check whether the agent confused the subject with
his son Thomas Witbeck (LCCV-YCQ) or another relative sharing the
Witbeck surname in the same Niskayuna/Schenectady church records — this
is a real-name-collision risk given how large and repetitive this family
line is (many duplicate fact ids in the raw FamilySearch data reflect
merged/duplicate person records upstream).
