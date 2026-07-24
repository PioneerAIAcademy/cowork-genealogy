# flynn-household-skeleton

Minimal scenario for the person-evidence **"Household skeleton and edges"**
rubric dimension. A pre-1880 census household is already **extracted** in
`research.json` (assertions only — record-extraction is assertion-only); the
household members are **not yet minted** in the tree. person-evidence owns the
household skeleton and must build it.

## Starting state

`tree.gedcomx.json` — only the parent and the subject exist:

- **I2 Thomas Flynn** (b. ~1818, Ireland) — the in-tree parent, matched as the
  1850 household head.
- **I1 Patrick Flynn** (b. ~1845, Ireland) — the subject, already linked as
  Thomas's child (edge **R1**, sourced to the 1908 death certificate S3).

`research.json` — one 1850-census source (`src_001` → tree source **S1**) whose
seven assertions describe Thomas's household:

- `a_001` — head_of_household name (Thomas Flynn).
- `a_002`/`a_003`/`a_004` — **John Flynn**, child_1: name, birth (age 8 → ~1842,
  Ireland), and an **inferred** ParentChild relationship assertion
  (`evidence_type: indirect`, `informant_proximity: researcher`).
- `a_005`/`a_006`/`a_007` — **Bridget Flynn**, child_2: name, birth (age 6 →
  ~1844, Ireland), and the same inferred ParentChild relationship assertion.
- One `person_evidence` link (`pe_001`) binds the head assertion to Thomas (I2).

John and Bridget are **un-minted** — neither exists in `tree.gedcomx.json`.

## What the skill must do

1. **Mint each new member** (John, Bridget) via `materialize_facts`
   create-or-enrich, so each arrives carrying its sourced census facts (name +
   birth), not a name-only stub.
2. **Write the parent-child edges** Thomas→John and Thomas→Bridget via
   `tree_edit add_relationship`, each carrying a source-ref resolved from the
   relationship assertion's `source_id` (`src_001` → **S1**). A pre-1880 census
   parent-child edge is **indirect** (inferred from household position; no
   relationship column before 1880) → written at **lower ref quality** than the
   directly-stated death-cert edge R1 (quality 3).
3. **Dry-run `merge_warnings`** as a coherence gate over the pre-materialization
   household set **before** committing.
4. **Flag the absence of Patrick.** Patrick (I1) is in the tree as Thomas's
   child but does **not** appear in this 1850 household — an unexplained absence
   to surface as an identity question, never resolved by renaming/overwriting an
   existing tree person to match a record persona.

## Why a new scenario

No existing scenario has un-minted census siblings — `mid-research-flynn`
already has every child + edge built. This is the smallest household that leaves
the sibling-minting + edge-writing work undone for the skill to do.
