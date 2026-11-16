# carter-census-late-child

The tree's John and Ann Carter have a son Albert (I4), born about 1884. Ann's own birth is not
known: the 1861 census entry gives her name and her age is not legible. The 1891 census lists
their household with Ann aged 53, which makes her about 46 at Albert's birth.

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 John Carter**, born about 1836 in Leeds; Leeds resident in 1861 (S1)
- **I2 Ann Carter**, his wife (Couple **R1**); Leeds resident in 1861 (S1); no birth fact
- **I3 Thomas Carter**, their son (ParentChild **R2**, **R3**), born about 1862
- **I4 Albert Carter**, their son (ParentChild **R4**, **R5**), born about 1884 and a Leeds
  resident in 1901 (S5)

Research (`research.json`):

- `src_001` / `S3`: the 1891 census. `a_001`-`a_004` are the head, John Carter, 55, cloth
  dresser, born Leeds. `a_005`-`a_007` are the wife Ann, 53. `a_008`-`a_010` are the son
  Albert, 7. None is linked.
- `src_002` / `S1`: the 1861 census (`a_020`-`a_023`), linked `confident`.
- `src_004` / `S4`: Thomas's 1862 baptism (`a_040`), linked `confident`.

## What a correct run does

Links all three. `same_person` lists, for the wife against I2, an implausible warning: with the
census age, Ann would have had a child at about 46. That is unlikely and possible. The head and
the son match the tree on name, age and place, and the census names her as the head's wife, so
she is linked to I2 and the rationale names the warning and says why it does not change who
she is.
