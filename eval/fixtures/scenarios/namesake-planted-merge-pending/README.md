# mid-research-flynn-merge-pending

Extension of `mid-research-flynn` with a pending person merge plus a pending
sibling-create. Used by `tree-edit` tests that exercise the skill's two most
complex mutating operations (merge, create-person + relationship).

## What this scenario adds vs. mid-research-flynn

**New tree.gedcomx.json persons:**
- `I3` — synthetic stub "James Flynn" extracted from Patrick's 1880 census
  household (brother). Birth `~1849` Ireland.
- `I4` — FamilySearch tree person "James Patrick Flynn"
  (ark `https://familysearch.org/ark:/61903/4:1:KWCJ-JAM7`). Birth `~1848` in
  Branch Township from the parish baptismal register.
  **Conflicting birth year** with I3 — deliberate, to exercise the
  keep-BOTH-conflicting-facts behavior during merge.

**New research.json state supporting a merge:**
- `subject_person_ids: ["I1", "I3"]` — was `["I1"]`. Patrick + James are
  co-researched siblings.
- `pe_007` — person_evidence linking assertion `a_014` (1880 census brother
  mention) to person `I3`.
- `t_002` — timeline for `I3` with one event (1880 co-residence).
- `q_003` — research question about whether I3 ≡ KWCJ-JAM7.
- `ps_002` — proof_summary at `probable` tier, vehicle `argument`, narrative
  confirming the identity. **This is the proof gate that authorizes the merge.**

**New research.json state supporting a create-sibling:**
- `q_004` — research question about whether Mary Flynn is Patrick's sister.
- `a_016` — assertion drawn from the 1850 Schuylkill County census
  (`src_001`) where a 9-year-old female named Mary in Thomas Flynn's household
  is consistent with a daughter.
- `ps_003` — proof_summary at `probable` tier, vehicle `argument`,
  authorizing tree-edit to create Mary as a person and a ParentChild
  relationship from Thomas (I2). **Mary is NOT yet in tree.gedcomx.json** —
  that's what ut_010 creates.

## Tests using this scenario

- **`ut_tree_edit_006`** — merge I3 into I4 (full reference rewrite + keep
  both conflicting birth dates).
- **`ut_tree_edit_010`** — create Mary as person I5 + ParentChild Thomas → Mary
  per ps_003.

## Cross-references that a merge of I3 → I4 must rewrite

| File | Field | Pre-merge | Post-merge |
|------|-------|-----------|------------|
| research.json | `project.subject_person_ids` | `["I1", "I3"]` | `["I1", "I4"]` |
| research.json | `person_evidence[pe_007].person_id` | `"I3"` | `"I4"` |
| research.json | `timelines[t_002].person_ids` | `["I3"]` | `["I4"]` |
| tree.gedcomx.json | `persons[]` | I3 present | I3 deleted |
| tree.gedcomx.json | `persons[I4].facts` | one Birth (~1848) | two Birth facts kept (~1848, ~1849) — conflict-handling |
| tree.gedcomx.json | `persons[I4].names` | "James Patrick Flynn" + "James Flynn" AKA | name from I3 ("James Flynn") merged in if not duplicate |

After the merge, `validate_research_schema` should pass and no reference to
`I3` should remain anywhere in either file.
