# flynn-research-complete-no-proof

Patrick Flynn parentage research — all planned searches completed, exhaustive declaration in place, but no proof_summary has been written yet. Used by proof-conclusion tests that need the skill to write a new `proved`-tier proof from scratch.

Differs from `flynn-resolved` in three ways:

- **`proof_summaries`:** `[]` — `ps_001` removed so the skill must produce a new entry.
- **Added a fourth source (Irish Catholic baptism, 1845):** `src_005` provides direct + primary evidence of the father-child relationship, recorded by the priest who witnessed Patrick's baptism. The 1860 census does not provide primary information on relationships (the explicit relationship column was not introduced until 1880), so the baptism is the only source with primary information on the father identification. Per the Genealogical Proof Standard, at least one original source with primary information must support the conclusion — this scenario adds the baptism to make the `proved` verdict GPS-defensible alongside the corroborating indirect census evidence and the direct-but-secondary death certificate.
- **`q_001` rescoped to the father only:** Original wording asked about "parents" (plural). The fixture's existing evidence (1850/1860 census and 1908 death cert) only names Thomas. When the baptism was added, it also named the mother (Mary Brennan) as Catholic baptismal records always do — and a careful LLM correctly tier-downed the whole question because the mother's identification had only one corroborating source. Rescoping the question to "Who was the father?" matches the actual evidence scope and aligns with the test's intent (verifying `proved`-tier for paternal identification). Maternal identification would be a separate downstream question.

Everything else (project.status, q_001.exhaustive_declaration shape, plans, log entries 1–6 including negative probate log_006, conflict c_001, etc.) matches `flynn-resolved`. The exhaustive_declaration text is updated to reference four sources instead of three.

## Items added vs. flynn-resolved

- `sources[src_005]` — St. Mary's Catholic baptismal register, County Tipperary, Ireland (1845)
- `assertions[a_014]` — parent-child relationship, direct + primary, from src_005
- `log[log_007]` — search of NLI Catholic Parish Registers
- `person_evidence[pe_007, pe_008]` — links a_014 to I1 (Patrick) and I2 (Thomas)
- `questions[q_001].resolution_assertion_ids` — appends `a_014`
- `questions[q_001].exhaustive_declaration` — log_entry_ids appends `log_007`; justification/stop_criteria text updated for four-source picture
- `tree.gedcomx.json.sources[S5]` — `National Library of Ireland` catalog entry
- `tree.gedcomx.json.relationships[R1].sources` — appends `S5` reference

## Used by

- `proof-conclusion` positive test for the `proved` tier — the skill must write a new `proof_summaries` entry with `tier: "proved"`, justifying exhaustiveness from the populated `q_001.exhaustive_declaration` and reasoning across all four sources (including the negative probate result, `log_006`).

## Note on the probate negative result

The negative probate (`log_006`) doesn't contradict the parentage conclusion. It does affect what "reasonably exhaustive" looks like: with no estate proceedings to consult, the conclusion rests on four other independent sources. The `exhaustive_declaration.stop_criteria` reflects this explicitly.

## Related concern (for senior review)

`flynn-resolved` itself (the base scenario this was forked from) has the same three-source evidence shape but is described as `proved`. A strict GPS read of that scenario would tier down to `probable` for the same reason this fork needed extra evidence. If `flynn-resolved` is used by other tests that depend on it being `proved`-eligible, those tests may also need similar evidence added (or the validator made more permissive).
