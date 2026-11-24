# retype-claimed-subtype

A small project for the retype rule (Decision 32 of `docs/plan/conclusion-tree.md`):
an edge whose subtype a claim names can be retyped with no justification.

- `I1` Thomas Hughes, born 1862; `I2` William Price.
- `R1` — an untyped ParentChild edge, William → Thomas, sourced to the 1871 census (`S1`).
- `ps_001` (probable) carries one claim: William is Thomas's **Step** father, citing the census
  household (`a_001` William, head; `a_002` Thomas, stepson), both linked at confident.

## Tests using this scenario

- **`ut_tree_edit_021`** — retype R1 to Step; the claim names that subtype, so it lands with no
  justification and the reply names the claim.
