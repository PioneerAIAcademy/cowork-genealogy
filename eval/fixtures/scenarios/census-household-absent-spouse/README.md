# census-household-absent-spouse

Scenario for the person-evidence **"Person minting and connecting edges"**
rubric dimension — specifically its *unexplained-absence* clause: "an existing
tree person unexplainedly absent from the record is FLAGGED as an identity
question — never renamed or overwritten."

Unlike `flynn-household-skeleton` (which pre-states the absent member both in
the log notes and in the test's user message), this scenario **never states the
absence anywhere**. The skill must *derive* it by comparing the head's tree
family against the record's roster.

## Starting state

`tree.gedcomx.json` — a married couple, no children yet:

- **I1 George Ackerman** (b. ~1818, Pennsylvania) — the 1860 household head.
- **I2 Catherine Ackerman** (b. ~1822, Pennsylvania) — George's wife, joined to
  him by the **Couple** relationship **R1** (sourced to an 1845 marriage record,
  **S2**). Catherine has **no death fact**, so nothing in the tree explains her
  being absent from a household George heads in 1860.

`research.json` — one 1860-census source (`src_001` → tree source **S1**) whose
seven assertions describe George's household:

- `a_001` — head_of_household name (George Ackerman); already linked to I1 by
  `pe_001`.
- `a_002`/`a_003`/`a_004` — **Henry Ackerman**, child_1: name, birth (age 9 →
  ~1851), and an **inferred** ParentChild relationship assertion
  (`evidence_type: indirect`, `informant_proximity: researcher`).
- `a_005`/`a_006`/`a_007` — **Margaret Ackerman**, child_2: name, birth (age 6 →
  ~1854), and the same inferred ParentChild relationship assertion.

Henry and Margaret are **un-minted**. There is **no assertion for Catherine** —
she is simply not in the record — and the log note, the citations, and (in the
test) the user message all describe only the head and the two children. Nothing
tells the skill Catherine is missing.

## What the skill must do

1. **Build the household** — link `a_001` → I1, mint Henry and Margaret via
   `materialize_facts` create-or-enrich (carrying their sourced census facts),
   and write the George→Henry / George→Margaret parent-child edges via
   `tree_edit add_relationship` with a source-ref at **lower** (pre-1880,
   indirect) quality. A `merge_warnings` dry-run is a plus, not required (no
   candidate record document is available — pre-extracted assertions only).
2. **Detect and flag Catherine's absence — unprompted.** George's tree wife
   (I2, via R1) does **not** appear among the 1860 personas. The skill must
   surface this on its own as an identity/research question — she may have died
   before 1860, been enumerated elsewhere, separated, or this "George Ackerman"
   may be a different man — **never** resolving it by renaming/overwriting
   Catherine or fabricating a persona for her.

## Why a new scenario

`flynn-household-skeleton` already covers the minting + edges, but it *hands* the
absent member to the skill (log note "Patrick is not enumerated in this
household"; `ut_021`'s prompt names his absence outright), so a run passes by
echoing the hint. No existing scenario forces the skill to *notice* an expected
member is missing. This is the smallest household that leaves that detection
undone.
