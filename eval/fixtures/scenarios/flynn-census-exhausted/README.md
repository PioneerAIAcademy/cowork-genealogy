# flynn-census-exhausted

Patrick Flynn parentage research. The first plan for q_001 is complete (1850 + 1860 census + 1908 death certificate searched, sources captured, assertions extracted, birthplace conflict resolved), but the question itself is still `in_progress` and the proof summary is at `probable` — there's no active plan describing what to search next.

Differs from `mid-research-flynn` in these ways:

- **`plans[pl_002].status`:** `completed` (was `active`).
- **`plans[pl_002].items`:** the probate item (`pli_006`) has been removed entirely — it was never part of pl_002 in this scenario; the dev hasn't decided what to search next yet.
- **`questions[q_001].status`:** `in_progress` — same as `mid-research-flynn`.
- **`proof_summaries[ps_001].tier`:** `probable` — same as `mid-research-flynn`.
- **`conflicts[c_001]`:** resolved — same as `mid-research-flynn`.
- **Everything else** (log, sources, assertions, person_evidence, hypotheses, timelines): identical to `mid-research-flynn`.

## Used by

- `research-plan` tests where the skill must propose a NEW plan for `q_001` after the existing plan has been completed. Plausible plan items: probate records for Thomas Flynn, 1870/1880/1900 censuses to track Patrick post-1860, FAN research on Schuylkill County neighbors, naturalization records, Irish emigration manifests.
- `question-selection` tests asking "what should I research next?" when the active question's plan is complete but the question isn't fully resolved.
- Boundary tests verifying that `research-plan` proposes additional research rather than declaring the question resolved on the strength of three census/vital sources alone.

## Why census + death cert isn't enough for `proved`

Three independent sources support the parentage conclusion but research isn't yet exhaustive: probate records have not been searched (the most direct positive evidence a will could provide), and the post-1860 censuses haven't been examined to confirm Patrick remained in the same household into adulthood. A genuine "proved" tier requires either positive probate evidence or evidence that exhaustive search was conducted and turned up nothing contradicting.
