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
- **Plan items:** Three additional plan items added — pli_007 later
  censuses and pli_009 naturalization with `status: "skipped"` and a
  rationale explaining why each was considered but not pursued, and
  pli_008 church records `completed` with a searched negative (log_007).
  Together these keep Claude from refusing to declare on the ground of an
  unsearched record type.
- **`log`:** one entry beyond `flynn-resolved` — `log_007`, the searched
  negative on pli_008 (see below).
- **Everything else** (sources, assertions, person_evidence, hypotheses,
  timelines, conflicts): identical to `flynn-resolved`.

## Used by

- `research-exhaustiveness` affirmative-declaration test: the skill
  evaluates q_001, determines all criteria are met, and writes
  `declared: true` with all seven `stop_criteria` keys populated.

## Why this scenario supports a genuine declaration

All seven log entries are present (three census searches, one death
cert, one probate negative, one baptismal-register negative). The plan
for q_001 (pl_002) has four items completed and two skipped with
documented rationales. The birthplace conflict (c_001) is resolved.
Three independent sources support the parentage conclusion. Both
negative results — probate and baptism — are documented. Overturn risk
is low.

**pli_008 is searched, not assumed away (#2269).** It previously sat
`skipped` on the rationale that "pre-1850 Irish Catholic parish records
for Schuylkill County are fragmentary and largely unavailable on
FamilySearch" — a planning-time assumption no search ever tested, and a
wrong one: St. John the Baptist, Pottsville (est. 1827) has continuous
registers across Patrick's birth window. The agent was right to decline
on it, which is what `ut_research_exhaustiveness_d5e` recorded as an
`xfail`. Reading the register and recording the negative (log_007) is
what makes the declaration defensible: the one record type that could
have supplied original, primary, direct evidence of the father was
looked for and is not there, so the conclusion rests on the three
converging sources — and that is exactly why ps_001 sits at `probable`
rather than `proved`. The `xfail` marker on `_d5e` is removed with this
change, per its own stated removal condition.
