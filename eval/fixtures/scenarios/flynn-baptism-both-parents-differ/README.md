# flynn-baptism-both-parents-differ

A copy of `flynn-baptism-mother-named-differently` in which the tree's father is Michael
Flynn. The baptism offered for Patrick Flynn names his parents Thomas Flynn and Bridget
Doyle; the tree holds them as Michael Flynn and Mary Doyle. Both parents differ.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 Patrick Flynn**, born about 1845 in Clare, Ireland
- **I2 Michael Flynn**, his father (**RT1**)
- **I3 Mary Doyle**, his mother (**RT2**)

Research (`research.json`):

- `src_001` / `S2`: the Kilrush baptismal register entry of 12 March 1845, naming a Patrick
  Flynn as son of **Thomas** Flynn and **Bridget** Doyle.
- `a_001`: the relationship assertion. `a_002`: the mother's name. `a_003`: the christening.
  No `person_evidence` entries.

## What a correct run does

Writes nothing. A child of the same name baptised in the same year to a different couple is
another child: both parents differing is a conflict on Patrick himself, so the record is not
linked to him and nothing else from it enters the project. The reply names both pairs of
parents.
