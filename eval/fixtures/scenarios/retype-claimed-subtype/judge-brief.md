# retype-claimed-subtype (judge brief)

Tree: I1 Thomas Hughes, born 1862; I2 William Price. R1 is a ParentChild edge from William to
Thomas with no subtype, sourced to the 1871 census (S1).

Research: ps_001, at probable, claims William is Thomas's Step father, citing the census
household where William is head and Thomas is listed as his stepson. Both persons are linked to
those entries at confident.

Because a claim names Step for this pair, `tree_correct update_relationship` retyping R1 to Step
lands with no warning and needs no justification.
