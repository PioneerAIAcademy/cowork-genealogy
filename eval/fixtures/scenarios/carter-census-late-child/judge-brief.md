# carter-census-late-child (judge brief)

Tree: I1 John Carter, born about 1836 in Leeds, a Leeds resident in 1861. I2 Ann Carter, his
wife, a Leeds resident in 1861, with no birth fact. I3 Thomas Carter, their son, born about
1862. I4 Albert Carter, their son, born about 1884, a Leeds resident in 1901.

Unlinked: the 1891 census household in Leeds. `a_001`-`a_004` are the head John Carter, 55,
cloth dresser, born Leeds. `a_005`-`a_007` are the wife Ann, 53, born about 1838.
`a_008`-`a_010` are the son Albert, 7, born about 1884.

`same_person` returns, for the wife against I2, a `warningsIfLinked` list with an implausible
warning: Ann would have had a child (Albert, I4) at about 46.
