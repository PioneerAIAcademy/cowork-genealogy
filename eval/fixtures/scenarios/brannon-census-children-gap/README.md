# brannon-census-children-gap

A question-selection scenario for the census-children-gap wiring. Re-authored
from the retired `ut_init_project_wm7` (`eval/tests/unit/init-project/census-living-child-missing-at-both.json`,
recovered from `git show 63ed17b57`) now that init-project no longer does gap
analysis.

Ellen Brannon (I1) and Patrick Brannon (I2) have two children in the tree
born before the 1900 census (James 1892, Catherine 1895) plus Thomas (I5, b.
1904). The census counts arrive only in the test's delegation message: the
1900 census records 3 children born / 3 living, and the 1910 census records
4 born / 4 living.

Born equals living at both censuses, so there are no deceased children. The
1900 living count (3) exceeds the tree's living children at that date (2) by
one, and the 1910 living count (4) exceeds the tree's living children at
that date (3) by one — but it is the SAME living child in both deltas (born
before 1900, still alive in 1910), since only one birth (Thomas, already in
the tree) falls between the censuses. Guards against double-counting a
living-missing child once per census when it is really one missing child.

Expected: `census_children_gap` reports exactly one missing child (living,
born before 1900), not two, and question-selection writes a research
question targeting that one child, not a deceased-child question (there is
none) and not two separate living-child questions.
