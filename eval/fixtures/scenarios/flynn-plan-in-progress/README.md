# flynn-plan-in-progress

Patrick Flynn parentage research with a plan item still `in_progress`.
The death certificate search (pli_005) has not been completed yet.

Differs from `flynn-census-exhausted` in these ways:

- **`plans[pl_002].status`:** `active` (was `completed`).
- **`plans[pl_002].items[pli_005]`:** `status: "in_progress"` (was
  `completed`). The death certificate search has been initiated but
  not finished.
- **`log`:** `log_005` removed (the death cert search hasn't completed).
- **`sources`:** `src_004` removed (death cert source not yet captured).
- **`assertions`:** `a_011`, `a_012`, `a_013` removed (death cert
  assertions not yet extracted).
- **`person_evidence`:** `pe_005` removed (death cert person_evidence
  not yet created).
- **`hypotheses[h_001]`:** `supporting_assertion_ids` reduced to
  `["a_004", "a_010"]` (no `a_013` from death cert).
- **Everything else:** identical to `flynn-census-exhausted`.

## Used by

- `research-exhaustiveness` refuse-while-in-progress test: the skill
  must refuse to declare because pli_005 is still `in_progress`,
  regardless of whether the evidence so far might be sufficient.
