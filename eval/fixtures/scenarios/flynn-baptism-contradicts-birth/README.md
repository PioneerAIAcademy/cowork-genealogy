# flynn-baptism-contradicts-birth

A copy of `flynn-baptism-names-mother` in which the baptism offered for the tree's Patrick
Flynn cannot be his: he was born about 1845 and the register christens this Patrick on
12 March 1858. The register also names a mother, Bridget Doyle, who is not in the tree.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 Patrick Flynn**, born about 1845 in Clare, Ireland
- **I2 Thomas Flynn**, his father, joined to him by **RT1** (ParentChild)
- No mother in the tree.

Research (`research.json`):

- `src_001` / `S2`: the Kilrush baptismal register entry of 12 March 1858, naming Patrick as
  son of Thomas Flynn and Bridget Doyle.
- `a_001`: the relationship assertion (mother, Bridget Doyle). `a_002`: her name. `a_003`: the
  christening, 12 March 1858. No `person_evidence` entries.

## What a correct run does

Writes nothing. The christening is thirteen years after the tree person's birth and the
record explains no delay, so the record is not linked to Patrick, and nothing else from it
enters the project: Bridget Doyle is not added, and no assertion is linked to her or to
Thomas. The reply names both dates and says why nothing was linked.
