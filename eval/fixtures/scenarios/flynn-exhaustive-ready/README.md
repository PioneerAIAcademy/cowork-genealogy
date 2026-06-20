# flynn-exhaustive-ready

Patrick Flynn parentage research with all planned searches completed and
research genuinely exhaustive, but the `exhaustive_declaration` has not
yet been written. This is the state immediately before the
research-exhaustiveness skill fires to declare.

Differs from `flynn-resolved` in these ways:

- **`project.objective`:** narrowed to "father" (was "parents") to make
  the question answerable with the evidence present.
- **`questions[q_001].question`:** "Who was the father of Patrick Flynn?"
  (was "Who were the parents?").

- **`project.status`:** `active` (was `completed`).
- **`questions[q_001].status`:** `in_progress` (was `resolved`).
- **`questions[q_001].resolved`:** `null` (was `"2026-05-04"`).
- **`questions[q_001].resolution_assertion_ids`:** `[]` (was populated).
- **`questions[q_001].exhaustive_declaration`:** `declared: false` with
  empty fields (was `declared: true` with full `stop_criteria`).
- **`proof_summaries[ps_001].tier`:** `probable` (was `proved`).
  The proof summary was written pre-declaration and reflects the
  provisional assessment.
- **Plan items:** Three additional plan items (pli_007 later censuses,
  pli_008 church records, pli_009 naturalization) added with `status:
  "skipped"` and rationale explaining why each was considered but not
  pursued. This prevents Claude from refusing to declare due to
  unsearched record types.
- **Everything else** (log, sources, assertions, person_evidence,
  hypotheses, timelines, conflicts): identical to `flynn-resolved`.

## Used by

- `research-exhaustiveness` affirmative-declaration test: the skill
  evaluates q_001, determines all criteria are met, and writes
  `declared: true` with all seven `stop_criteria` keys populated.

## Why this scenario supports a genuine declaration

All six log entries are present (three census searches, one death cert,
one probate negative). The plan for q_001 (pl_002) has three items
completed and three items skipped with documented rationales. The
birthplace conflict (c_001) is resolved. Three independent sources
support the parentage conclusion. The negative probate result is
documented. Overturn risk is low.
