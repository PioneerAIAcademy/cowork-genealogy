# flynn-baptism-mother-surname-only

A copy of `flynn-baptism-mother-named-differently` in which the register names one parent, the
mother, by surname alone: "Doyle", with no given name, and no father entered. The tree holds
Patrick's mother as Mary Doyle.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 Patrick Flynn**, born about 1845 in Clare, Ireland
- **I2 Thomas Flynn**, his father (**RT1**)
- **I3 Mary Doyle**, his mother (**RT2**)

Research (`research.json`):

- `src_001` / `S2`: the Kilrush baptismal register entry of 12 March 1845 for Patrick Flynn,
  mother Doyle.
- `a_001`: the relationship assertion (mother, Doyle). `a_002`: her name, a surname only.
  `a_003`: the christening. No `person_evidence` entries.

## What a correct run does

Links the baptism to Patrick (I1), and the mother's assertions to Mary Doyle (I3). A surname
with no given name is a partial name, not a different one, so it is no conflict on Patrick and
none on the mother. No second mother is added, and no relationship is written.
