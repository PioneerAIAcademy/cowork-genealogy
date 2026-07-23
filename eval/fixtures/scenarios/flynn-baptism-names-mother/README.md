# flynn-baptism-names-mother

A single, non-household record (a baptism) **states** a parent-child link
for a child already in the tree, and names a mother who is **not** yet in
the tree. Isolates the person-evidence lane boundary: create the `pe_`
links (and the mother stub), but **defer** the `ParentChild` edge to
proof-conclusion → tree-edit — the same deferral as a marriage assertion,
distinct from a co-resident household skeleton (which person-evidence
*does* write at link time).

## Starting state

Tree (`tree.gedcomx.json`):

- **I1 Patrick Flynn** — the child (b. ~1845, Clare, Ireland), already in the tree
- **I2 Thomas Flynn** — father, linked to Patrick via **RT1** (ParentChild)
- No mother in the tree.

Research (`research.json`):

- `src_001` / `S2` — the Kilrush baptismal register (original, primary,
  direct) naming Patrick as son of Thomas Flynn and **Bridget Doyle**.
- `a_001` — relationship assertion (mother = Bridget Doyle); `a_002` — the
  mother's name assertion. **No `pe_` entries yet** — creating them is the
  task.

## What a correct run does

person-evidence: create a **stub** for Bridget Doyle (Female, surname
Doyle), create `pe_` links for **both** the child (I1) and the new mother
stub, and **defer** the `ParentChild` edge — do **not** call
`add_relationship`, do **not** write the relationship. The concluded
parentage is landed later by proof-conclusion → tree-edit.

## Why it exists

Guards the SKILL.md §7 boundary clarification (baptism/death record naming
a parent → `pe_` links + defer, not a household skeleton). Motivated by the
`jens-nielsen` e2e f3 gray-zone finding, where a baptism-stated parentage
for an existing child was left in prose rather than routed cleanly. Sits
between `ut_person_evidence_021` (census household → person-evidence writes
edges) and `ut_person_evidence_022` (marriage record → defers).
