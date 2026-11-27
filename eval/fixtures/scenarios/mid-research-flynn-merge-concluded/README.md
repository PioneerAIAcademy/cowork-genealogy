# mid-research-flynn-merge-concluded

`mid-research-flynn-merge-pending` with `q_003` and `q_004` resolved by the
proof summaries that conclude them, as proof-conclusion leaves a question when
it concludes at `probable`. Everything else — persons, assertions,
`person_evidence`, timelines, and `ps_002` / `ps_003` with no `claims` — is
byte-identical to the source scenario.

## Why it exists

In the source scenario both questions stay `in_progress` beside a `probable`
summary. `project_context` reads a summary on a still-open question as one
written while a gate blocked the conclusion, and reports the question
"concluded while blocked". tree-edit on Haiku 5.5 took that for an
unsettled identity and refused the work the summaries authorize (#4849:
ut_006 failed 4 to 5 runs in 10; ut_010 did not name ps_003 in 9 in 10).
A project whose questions are concluded does not carry that state.

Genealogist ruling (2026-11-26): a research question counts as answered at the
`probable` tier when the evidence adequately supports it, and its proof summary
keeps the remaining uncertainty. ps_002 does (the ~1848/~1849 birth-year gap,
put down to enumerator error) and ps_003 does (indirect evidence, the most
parsimonious reading), so both questions resolve.

## What differs from mid-research-flynn-merge-pending

| Question | Field | Source | Here |
|----------|-------|--------|------|
| `q_003` (I3 ≡ KWCJ-JAM7?) | `status` / `resolved` | `in_progress` / null | `resolved` / 2026-05-07 |
| `q_003` | `resolution_assertion_ids` | `[]` | `a_014`, `a_015` (ps_002's) |
| `q_003` | `search_stop` | empty | `question_answered`, `log_006`, `log_007` |
| `q_004` (Mary daughter of Thomas?) | `status` / `resolved` | `in_progress` / null | `resolved` / 2026-05-08 |
| `q_004` | `resolution_assertion_ids` | `[]` | `a_016` (ps_003's) |
| `q_004` | `search_stop` | empty | `question_answered`, `log_001` |

`ps_002` still carries no `claims`, so `project_context` still lists it as an
advisory `claims` owed finding, and `merge_tree_persons` still asks for a
justification before merging I3 into I4.

## Tests using this scenario

- **`ut_tree_edit_006`** — consolidates I3's names and facts onto I4 without
  deleting I3 (keep both conflicting birth dates).
- **`ut_tree_edit_010`** — create Mary as person I5 + ParentChild Thomas → Mary
  per ps_003.

The cross-reference table for a merge of I3 → I4 is the source scenario's.
