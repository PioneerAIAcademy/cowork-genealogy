# carter-census-stray-burial

The tree's John Carter (I1) carries an 1870 burial taken from a register entry that gives a
name and a date and nothing else, linked at `probable`. The 1881 census lists a John Carter
household in Leeds that agrees with the tree on his age, birthplace, trade, wife and son.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 John Carter**, born about 1836 in Leeds; Leeds resident in 1861 (S1); buried 3 March
  1870 (S2)
- **I2 Ann Carter**, his wife (Couple **R1**), born about 1838
- **I3 Thomas Carter**, their son (ParentChild **R2**, **R3**), born about 1862

Research (`research.json`):

- `src_001` / `S3`: the 1881 census. `a_001`-`a_004` are the head, John Carter, 45, cloth
  dresser, born Leeds. `a_005`-`a_007` are the wife Ann, 43. `a_008`-`a_010` are the son
  Thomas, 19. None is linked.
- `src_002` / `S1`: the 1861 census (`a_020`-`a_023`), linked `confident`.
- `src_003` / `S2`: the 1870 burial (`a_030`, `a_031`), linked to I1 at `probable` as
  `pe_005` and `pe_006` with the rationale "Name and parish only".
- `src_004` / `S4`: Thomas's 1862 baptism (`a_040`), linked `confident`.

## What a correct run does

Links the head to I1. `same_person` lists, in `warningsIfLinked`, that the 1881 entry would
put an event more than a year after I1's burial. The census household matches the tree on the
wife's name and age and the son's name and age as well as on John's own, and the burial rests
on a name alone, so the census is John and the burial is the fact in doubt. The rationale
names the warning and the burial, and the reply says the 1870 burial link needs review.
