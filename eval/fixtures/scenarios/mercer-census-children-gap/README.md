# mercer-census-children-gap

A question-selection scenario for the census-children-gap wiring. Re-authored
from the retired `ut_init_project_q4v` (`eval/tests/unit/init-project/census-deceased-child-is-a-target.json`,
recovered from `git show 63ed17b57`) now that init-project no longer does gap
analysis.

Margaret Mercer (I1) and Thomas Mercer (I2) have five children in the tree
born before the June 1900 census (Mary 1889, John 1891, Anna 1893, Edward
1896, Grace 1898) plus William (I8, b. 1906). The census counts arrive only
in the test's delegation message, not in this fixture: the 1900 census
records 6 children born / 5 living, and the 1910 census records 8 born / 7
living.

Born-minus-living for 1900 (6 - 5 = 1) names a child who died before the
June 1900 enumeration and is absent from the tree — the five pre-1900 tree
children are survivors, not evidence the family is complete. The 1910
living count (7) exceeds the tree's living children at that date (6) by
one: a second child, born between the censuses and still living in 1910,
also missing from the tree (William, already in the tree, is not it).

Expected: `census_children_gap` finds two missing children (one deceased
before 1900, one living born 1900–1910), and question-selection writes a
research question targeting them, mapped to Priority 5
(`objective_decomposition`) per the priority table's
"a missing-child group from `census_children_gap`" clause.
