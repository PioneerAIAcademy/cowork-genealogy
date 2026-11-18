# carter-census-stray-burial (judge brief)

Tree: I1 John Carter, born about 1836 in Leeds, resident there in 1861, with a burial of
3 March 1870 from a register entry that gives a name and a date only. That burial is linked
to him at `probable` (`pe_005`, `pe_006`) with the rationale "Name and parish only". I2 Ann
Carter is his wife, born about 1838. I3 Thomas Carter is their son, born about 1862.

Unlinked: the 1881 census household in Leeds. `a_001`-`a_004` are the head John Carter, 45,
cloth dresser, born Leeds. `a_005`-`a_007` are the wife Ann, 43. `a_008`-`a_010` are the son
Thomas, 19.

`same_person` returns a score for the head against I1 and a `warningsIfLinked` list saying
the entry would put an event more than a year after I1's burial.
