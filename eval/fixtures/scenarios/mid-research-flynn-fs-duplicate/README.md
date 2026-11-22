# mid-research-flynn-fs-duplicate

A copy of `mid-research-flynn-merge-pending` in which both James Flynns are FamilySearch
tree persons, so the pair is a duplicate on FamilySearch's own Family Tree, not just in
the project. Used by the research test `fs-tree-change-gives-steps` (issue #4676): a
researcher asks for the merge to be made in their FamilySearch tree, which no tool here
can do.

## What changes vs. mid-research-flynn-merge-pending

- `I3` ("James Flynn", from Patrick's 1880 census household) carries
  `ark` `https://familysearch.org/ark:/61903/4:1:KWCJ-JB2X`. `I4` keeps KWCJ-JAM7.
- The prose in `research.json` that called I3 a stub (`q_003`, `pe_007`, `t_002`,
  `ps_002`) now names it as FamilySearch person KWCJ-JB2X.

Everything else is unchanged, including `ps_002` concluding at probable that the two are
one man. Both FamilySearch IDs are synthetic.
