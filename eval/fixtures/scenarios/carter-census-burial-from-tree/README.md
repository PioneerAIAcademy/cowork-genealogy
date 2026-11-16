# carter-census-burial-from-tree

`carter-census-stray-burial` with one difference: the 1870 burial on John Carter (I1) came with
the tree. No record in this project backs it and no link was ever written for it.

## Starting state

Tree (`tree.gedcomx.json`, and the same in `starting-tree.gedcomx.json`):

- **I1 John Carter**, born about 1836 in Leeds; Leeds resident in 1861 (S1); buried 3 March
  1870 (S2), a fact the tree arrived with
- **I2 Ann Carter**, his wife (Couple **R1**), born about 1838
- **I3 Thomas Carter**, their son (ParentChild **R2**, **R3**), born about 1862

Research (`research.json`):

- `src_001` / `S3`: the 1881 census. `a_001`-`a_004` are the head, John Carter, 45, cloth
  dresser, born Leeds. `a_005`-`a_007` are the wife Ann, 43. `a_008`-`a_010` are the son
  Thomas, 19. None is linked.
- `src_002` / `S1`: the 1861 census (`a_020`-`a_023`), linked `confident`.
- `src_004` / `S4`: Thomas's 1862 baptism (`a_040`), linked `confident`.
- Nothing for the burial.

## What a correct run does

Writes no link. `same_person` lists, in `warningsIfLinked`, that the 1881 entry would put an
event more than a year after I1's burial, and says that burial came with the tree. Tree facts
are taken as correct while researching (lead, 2026-11-16), so the census head is not linked to
I1 and the household is withheld with him. The reply names the warning, says the burial is a
tree fact, and says the wife and son agree with the tree, so the burial is worth checking.
