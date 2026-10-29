# gaetjen-namesake-tied-marriage

The `gaetjen-namesake-confident-link` state (issue #3179, patron query 2593),
with the same two namesakes recorded on I1 Hermann Gaetjen, plus one more
extracted record: `src_003`, the 21 July 1913 San Francisco marriage of his
daughter Amelie Ottilie Gaetjen to William Chadwick Fralich ("California, County
Marriages, 1849-1957", XLXS-73D), which names the bride's parents as Hermann
Gaetjen and Amelia Nichols. The record is the second result family of the broad
survey in `log_005`, whose sidecar holds it, and the FamilySearch tree already
attaches it to I1, I3 and I4 (S8, S33, S48).

Assertions `a_020` (father of the bride, name), `a_021` (mother of the bride,
name), `a_022` to `a_024` (the bride: name, birth 1884, marriage) carry the
record's own persona ids. So do `a_025` and `a_026` (the bride as child of each
parent) and `a_027` (the father as the mother's spouse): the relationship
assertions `extraction_append` writes from the record's ParentChild and Couple
edges, with the values and `structured_value` it gives them. The parentage
is stated by those three, so the parents' name assertions belong to the parents
alone. No `person_evidence` exists yet.

**What it tests.** With a namesake recorded on I1, `research_append` refuses a
link from this record to I1 above `speculative` unless something in the record
ties it to him. Here something does: the mother of the bride is his wife I4,
Amelia Nichols, and the bride is his daughter I3. Linking the mother to I4 (or
the bride to I3) in the same call as the father, or before it, lets the
father's link to I1 stand at `probable` or `confident`. Linking the father alone
first is refused, and the refusal names that route.

`same_person` answers from hand-authored mocks (strong scores, since the tree
already attaches the record to all three), not live captures. Each mock answers
every assertion of this record scored against its tree person, so the other
side of each relationship assertion is answered too.
