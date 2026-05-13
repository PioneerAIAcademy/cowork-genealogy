# flynn-resolved

Patrick Flynn parentage research, fully concluded. All planned searches completed; the parentage conclusion has reached `proved`.

Differs from `mid-research-flynn` in these ways:

- **`project.status`:** `completed` (was `active`).
- **`questions[q_001]`:** `status: "resolved"`, `resolved: "2026-05-04"`, `resolution_assertion_ids` populated, `exhaustive_declaration.declared: true` with full `stop_criteria` populated.
- **`plans[pl_002]`:** `status: "completed"` (was `active`).
- **`plans[pl_002].items[pli_006]`** (probate search): `status: "completed"` (was `in_progress`).
- **`log`:** adds `log_006` — probate search with negative outcome (no Thomas Flynn probate record in Schuylkill County 1870-1890).
- **`proof_summaries[ps_001].tier`:** `proved` (was `probable`).
- **`conflicts[c_001]`:** remains resolved — same as `mid-research-flynn`.
- **Everything else:** unchanged.

## Used by

- `project-status` tests where the skill must report on a completed project.
- `proof-conclusion` tests for a project at `proved` tier (the highest-confidence outcome).
- `question-selection` tests where all active questions are resolved — the skill should either propose a follow-on question (e.g., siblings, maternal line) or report "no open questions."
- Boundary tests verifying that skills meant for active research don't volunteer work on completed projects.

## Note on the probate negative result

The negative probate (`log_006`) doesn't contradict the parentage conclusion. It does affect what "reasonably exhaustive" looks like: with no estate proceedings to consult, the conclusion rests on three other independent sources. The `exhaustive_declaration.stop_criteria` reflects this explicitly.
