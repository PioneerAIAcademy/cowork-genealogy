# flynn-baptism-mother-named-differently

A copy of `flynn-baptism-names-mother` in which the tree already holds Patrick Flynn's mother
as Mary Doyle, and his baptism names her Bridget Doyle.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 Patrick Flynn**, born about 1845 in Clare, Ireland
- **I2 Thomas Flynn**, his father (**RT1**)
- **I3 Mary Doyle**, his mother (**RT2**)

Research (`research.json`):

- `src_001` / `S2`: the Kilrush baptismal register entry of 12 March 1845, naming Patrick as
  son of Thomas Flynn and **Bridget** Doyle.
- `a_001`: the relationship assertion (mother, Bridget Doyle). `a_002`: her name. `a_003`: the
  christening. No `person_evidence` entries.

## What a correct run does

Links the baptism to Patrick (I1): name, date, place and father agree. The mother's place in
the record is the place I3 holds in the tree, and a person has one mother, so her assertions
are linked to I3 at `speculative` with the two given names stated in
`core_identifier_conflict`. No second mother is added, and no relationship is written.

`a_004` is the relationship assertion for the father (child of Thomas Flynn) and `a_005` his name,
so the project holds both parents the register names.
