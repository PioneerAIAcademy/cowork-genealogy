The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

This is the `mid-research-flynn` state with two planned searches added:
`pli_007` on `pl_002`, and `q_003` with `pl_003` and its one item, `pli_008`.
Five sources, `src_005` to `src_009`, have no log entry (`log_entry_id` is
null) and no assertions. They were added after the logged searches and are
left unworked on purpose: that is the mid-research state, not a missing or
invented source.

`I3` Mary and `I4` James Flynn are name-only persons from earlier research.
Their links to `I2` Thomas (`R2`, `R3`) cite the St. Mary's baptismal registers
(`S5`), not a census. That is on purpose too.
